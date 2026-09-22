import { AudioSource, isValid, Node } from 'cc';
import { Assets, destroyNode } from '../assets/asset-manager';
import { AssetKey } from '../assets/asset-types';
import { ClockDriver } from '../core/clock-driver';
import { invariant, OperationCancelled, reportError } from '../core/errors';
import { Scope, Lifetime } from '../core/scope';
/**
 * 音频通道名：内置 bgm 背景音乐、sfx 音效、voice 语音，也可使用 AppOptions.audioChannels 中声明的通道。
 */
export type AudioChannel = 'bgm' | 'sfx' | 'voice' | (string & {});
/**
 * 单次播放选项；实际音量为总音量 × 通道音量 × 本次音量，静音时输出为 0。
 */
export interface AudioOptions {
    /**
     * 通道，默认 sfx；bgm 采用单首替换策略，其他通道可并行播放。
     */
    readonly channel?: AudioChannel;
    /**
     * 是否循环；bgm 默认 true，其他通道默认 false。循环播放需 stop 或由所有者结束。
     */
    readonly loop?: boolean;
    /**
     * 本次播放音量，0～1，默认 1；不会修改通道或总音量。
     */
    readonly volume?: number;
}
/**
 * 一次托管播放的句柄，可暂停、继续、停止并观察结束。owner 取消时也会停止并归还音频引用。
 */
export interface PlaybackHandle {
    /**
     * 播放任务是否仍存活；暂停时仍为 true，停止或自然结束后为 false，不等同于当前扬声器正在发声。
     */
    readonly active: boolean;
    /**
     * 播放结束结果：自然结束为 ended，手动停止、被替换或所有者取消为 stopped。
     * 所有者取消时可能先报告 stopped，不能用它判断全部资源清理已完成；需要等待主动清理时调用 stop。
     */
    readonly ended: Promise<'ended' | 'stopped'>;
    /**
     * 停止本次播放并清理其子 Scope；可重复调用。
     * @returns 本次清理结束时完成的 Promise。
     */
    stop(): Promise<void>;
    /**
     * 手动暂停，保留播放句柄和音频引用；回到前台不会自动解除手动暂停。
     */
    pause(): void;
    /**
     * 解除手动暂停；应用在前台时恢复播放，在后台时等待回到前台。已结束的句柄不会重新播放。
     */
    resume(): void;
}
type Playing = {
    source: AudioSource;
    scope: Scope;
    channel: AudioChannel;
    volume: number;
    pausedByHost: boolean;
    pausedByUser: boolean;
    stopped: boolean;
    stop(): Promise<void>;
};
/**
 * 托管音频播放、声部复用、BGM 替换和音量。
 * 每次播放绑定 Scope，避免节点或 UI 已结束却遗留声音及资源引用。
 */
export class AudioManager {
    /** 创建绑定使用期限的播放入口；不创建新管理器，音量设置仍由应用统一维护。 */
    in(owner: Lifetime): ScopedAudio {
        return new ScopedAudio(this, owner);
    }
    private readonly root: Node;
    private readonly free: AudioSource[] = [];
    private readonly playing = new Set<Playing>();
    private readonly loading = new Set<Scope>();
    private readonly levels: Record<string, number> = Object.assign(Object.create(null), { bgm: 1, sfx: 1, voice: 1 });
    private muted = false;
    private master = 1;
    private bgmSequence = 0;
    private bgm?: Playing;
    private pendingBgm?: Scope;
    private accepting = true;
    private readonly scope: Scope;
    private readonly stopState: () => void;
    /**
     * 由 App 创建音频管理器。
     * @param parent - 音频根节点的父节点。
     * @param assets - 共享资源服务。
     * @param clock - 前后台状态来源。
     * @param owner - 应用所有者。
     * @param maxVoices - 最大并发声部数，正整数，默认 16。
     * @param channels - 额外通道及初始音量，值为 0～1。
     */
    constructor(
        parent: Node,
        private readonly assets: Assets,
        private readonly clock: ClockDriver,
        owner: Lifetime,
        private readonly maxVoices = 16,
        channels: Readonly<Record<string, number>> = {},
    ) {
        invariant(
            Number.isInteger(maxVoices) && maxVoices > 0,
            'AUDIO_VOICE_LIMIT_INVALID',
            'maxVoices must be a positive integer',
        );
        for (const [name, level] of Object.entries(channels)) {
            invariant(
                /^[a-z][a-z0-9-]*$/.test(name) && !['master', 'constructor', 'prototype'].includes(name),
                'AUDIO_CHANNEL_INVALID',
                name,
            );
            this.validVolume(level);
            this.levels[name] = level;
        }
        this.root = new Node('AudioRoot');
        parent.addChild(this.root);
        this.scope = owner.child('audio');
        this.stopState = clock.onStateChange(() => {
            for (const voice of this.playing) {
                if (clock.background && !voice.pausedByUser && voice.source.playing) {
                    voice.source.pause();
                    voice.pausedByHost = true;
                } else if (!clock.background && voice.pausedByHost) {
                    voice.pausedByHost = false;
                    if (!voice.pausedByUser) voice.source.play();
                }
            }
        });
    }
    /**
     * 按生成的音频资源键加载并播放，音频引用跟随 owner 的播放子 Scope。
     * @param key - AudioClip 资源键。
     * @param owner - 播放所有者；界面音效可以用 show.scope，常驻音乐需更长的所有者。
     * @param input - 通道默认 sfx，音量默认 1；bgm 默认循环，其他通道默认不循环。
     * @returns 可暂停和停止的 PlaybackHandle；后台创建的播放会等待回到前台。
     * @throws FrameworkError 通道未声明、音量无效、声部达到上限或应用正关停。
     * @throws OperationCancelled owner 取消或较新的 BGM 请求替代本次请求；资源加载失败也会拒绝。
     * @example
     * const sound = await this.ctx.audio.play(clickAudioKey, show.scope);
     * // 需要提前停止时：await sound.stop();
     */
    async play(key: AssetKey<'AudioClip'>, owner: Lifetime, input: AudioOptions = {}): Promise<PlaybackHandle> {
        owner.signal.throwIfAborted();
        invariant(this.accepting, 'APP_STOPPING', 'Audio is shutting down');
        const channel = input.channel ?? 'sfx';
        this.validateChannel(channel);
        this.validVolume(input.volume ?? 1);
        const scope = owner.child(`audio:${key.id}`);
        this.loading.add(scope);
        const sequence = channel === 'bgm' ? ++this.bgmSequence : 0;
        if (channel === 'bgm') {
            if (this.pendingBgm) void this.pendingBgm.close().catch(reportError);
            this.pendingBgm = scope;
        }
        try {
            const clip = await this.assets.load(key, scope);
            scope.signal.throwIfAborted();
            invariant(this.accepting, 'APP_STOPPING', 'Audio is shutting down');
            if (channel === 'bgm' && sequence !== this.bgmSequence)
                throw new OperationCancelled('A newer BGM request won');
            invariant(
                this.playing.size < this.maxVoices || (channel === 'bgm' && this.bgm),
                'AUDIO_VOICE_LIMIT',
                `Maximum simultaneous audio voices: ${this.maxVoices}`,
            );
            if (channel === 'bgm' && this.bgm) await this.bgm.stop();
            scope.signal.throwIfAborted();
            invariant(this.accepting, 'APP_STOPPING', 'Audio is shutting down');
            if (channel === 'bgm' && sequence !== this.bgmSequence)
                throw new OperationCancelled('A newer BGM request won');
            let source = this.free.pop();
            if (!source) {
                const node = new Node('Voice');
                this.root.addChild(node);
                source = node.addComponent(AudioSource);
            }
            source.clip = clip;
            source.loop = input.loop ?? channel === 'bgm';
            source.playOnAwake = false;
            let resolve!: (status: 'ended' | 'stopped') => void;
            const ended = new Promise<'ended' | 'stopped'>((yes) => {
                resolve = yes;
            });
            let stopping: Promise<void> | undefined;
            const voice: Playing = {
                source,
                scope,
                channel,
                volume: input.volume ?? 1,
                stopped: false,
                pausedByHost: this.clock.background,
                pausedByUser: false,
                stop: () => finish('stopped'),
            };
            const cleanup = () => {
                if (voice.stopped) return;
                voice.stopped = true;
                off();
                source!.node.off(AudioSource.EventType.ENDED, naturalEnd);
                source!.stop();
                source!.clip = null;
                this.playing.delete(voice);
                if (this.bgm === voice) this.bgm = undefined;
                if (isValid(source!, true)) this.free.push(source!);
            };
            const finish = (reason: 'ended' | 'stopped'): Promise<void> => {
                if (stopping) return stopping;
                cleanup();
                stopping = scope.close().then(() => {
                    resolve(reason);
                });
                return stopping;
            };
            const naturalEnd = () => {
                void finish('ended').catch(reportError);
            };
            let off = () => {};
            off = scope.signal.onAbort(() => {
                cleanup();
                resolve('stopped');
            });
            scope.defer(cleanup);
            source.node.on(AudioSource.EventType.ENDED, naturalEnd);
            this.playing.add(voice);
            if (channel === 'bgm') {
                this.bgm = voice;
                this.pendingBgm = undefined;
            }
            this.applyVolume(voice);
            if (!this.clock.background) source.play();
            return Object.freeze({
                get active() {
                    return !voice.stopped;
                },
                ended,
                stop: voice.stop,
                pause: () => {
                    if (!voice.stopped) {
                        voice.pausedByUser = true;
                        source!.pause();
                    }
                },
                resume: () => {
                    if (!voice.stopped) {
                        voice.pausedByUser = false;
                        if (!this.clock.background) source!.play();
                    }
                },
            });
        } catch (error) {
            if (this.pendingBgm === scope) this.pendingBgm = undefined;
            await scope.close();
            throw error;
        } finally {
            this.loading.delete(scope);
        }
    }
    /**
     * 播放背景音乐，等新音频就绪后停止旧 BGM；多次并发请求以最后一次为准。
     * @param key - 背景音乐资源键。
     * @param owner - 音乐所有者，应覆盖希望持续播放的业务阶段。
     * @param input - 可选 loop 和 volume，分别默认 true、1；通道固定为 bgm。
     * @returns 新 BGM 的播放句柄；旧句柄结束为 stopped。
     */
    playBgm(
        key: AssetKey<'AudioClip'>,
        owner: Lifetime,
        input: Omit<AudioOptions, 'channel'> = {},
    ): Promise<PlaybackHandle> {
        return this.play(key, owner, { ...input, channel: 'bgm' });
    }
    /**
     * 修改通道或总音量，并立即更新存活的播放任务。
     * @param channel - master 表示总音量，其余须为已声明的通道。
     * @param value - 0～1 的有限数值；不会自动保存到本地。
     * @throws FrameworkError 音量无效或通道未声明。
     */
    setVolume(channel: AudioChannel | 'master', value: number): void {
        this.validVolume(value);
        if (channel === 'master') this.master = value;
        else {
            this.validateChannel(channel);
            this.levels[channel] = value;
        }
        for (const voice of this.playing) this.applyVolume(voice);
    }
    /**
     * 读取保存的音量设置，不乘其他音量因子，也不受当前静音状态影响。
     * @param channel - master 或已声明通道。
     * @returns 0～1 的音量值。
     */
    getVolume(channel: AudioChannel | 'master'): number {
        if (channel === 'master') return this.master;
        this.validateChannel(channel);
        return this.levels[channel];
    }
    private validateChannel(channel: string): void {
        invariant(
            Object.prototype.hasOwnProperty.call(this.levels, channel),
            'AUDIO_CHANNEL_UNKNOWN',
            `Declare audio channel in AppOptions: ${channel}`,
        );
    }
    /**
     * 切换全局静音，保留各级音量数值及播放进度。
     * @param muted - true 静音，false 恢复按各级音量输出；不自动持久化设置。
     */
    setMuted(muted: boolean): void {
        this.muted = muted;
        for (const voice of this.playing) this.applyVolume(voice);
    }
    /**
     * 在玩家点击等真实交互回调中调用，尝试恢复前台中非手动暂停的声音。
     * 平台音频解锁仍由 Cocos 和运行平台处理，此调用不保证绕过平台自动播放限制。
     */
    resumeFromGesture(): void {
        for (const voice of this.playing)
            if (!voice.pausedByUser && !this.clock.background && !voice.source.playing) voice.source.play();
    }
    private applyVolume(voice: Playing): void {
        voice.source.volume = this.muted ? 0 : this.master * this.levels[voice.channel] * voice.volume;
    }
    private validVolume(value: number): void {
        invariant(
            Number.isFinite(value) && value >= 0 && value <= 1,
            'AUDIO_VOLUME_INVALID',
            'Volume must be in [0, 1]',
        );
    }
    /**
     * @internal
     * App 关停时停止接受播放、结束加载和声音，并销毁音频节点池。
     * @returns 全部音频清理完成的 Promise。
     */
    async close(): Promise<void> {
        this.accepting = false;
        this.stopState();
        this.bgmSequence++;
        await Promise.all(Array.from(this.loading).map((scope) => scope.close()));
        await Promise.all(Array.from(this.playing).map((voice) => voice.stop()));
        await this.scope.close();
        this.free.length = 0;
        await destroyNode(this.root);
    }
}

/** 本次显示或业务流程的音频入口；所有者结束时停止播放并归还资源。 */
export class ScopedAudio {
    /** @internal 通常通过 show.audio 或 app.audio.in(owner) 取得。 */
    constructor(
        private readonly manager: AudioManager,
        private readonly owner: Lifetime,
    ) {}
    /**
     * 播放音频，自动绑定当前期限。
     * @param key 生成的 AudioClip 资源键。
     * @param options 通道、循环及音量；默认 sfx、不循环、音量 1。
     * @returns 可暂停或提前停止的句柄。
     */
    play(key: AssetKey<'AudioClip'>, options?: AudioOptions): Promise<PlaybackHandle> {
        return this.manager.play(key, this.owner, options);
    }
    /** 在用户点击等手势内调用，尝试恢复平台允许播放的音频。 */
    resumeFromGesture(): void {
        this.manager.resumeFromGesture();
    }
}
