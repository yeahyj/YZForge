import { AudioSource, isValid, Node } from 'cc';
import { Assets, destroyNode } from '../assets/asset-manager';
import { AssetKey } from '../assets/asset-types';
import { ClockDriver } from '../core/clock-driver';
import { invariant, OperationCancelled, reportError } from '../core/errors';
import { Scope } from '../core/scope';
export type AudioChannel = 'bgm' | 'sfx' | 'voice' | (string & {});
export interface AudioOptions {
    readonly channel?: AudioChannel;
    readonly loop?: boolean;
    readonly volume?: number;
}
export interface PlaybackHandle {
    readonly active: boolean;
    readonly ended: Promise<'ended' | 'stopped'>;
    stop(): Promise<void>;
    pause(): void;
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
/** Pool sources, never fire-and-forget one-shots whose clip lifetime cannot be observed. */
export class AudioManager {
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
    constructor(
        parent: Node,
        private readonly assets: Assets,
        private readonly clock: ClockDriver,
        owner: Scope,
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
    async play(key: AssetKey<'AudioClip'>, owner: Scope, input: AudioOptions = {}): Promise<PlaybackHandle> {
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
    playBgm(
        key: AssetKey<'AudioClip'>,
        owner: Scope,
        input: Omit<AudioOptions, 'channel'> = {},
    ): Promise<PlaybackHandle> {
        return this.play(key, owner, { ...input, channel: 'bgm' });
    }
    setVolume(channel: AudioChannel | 'master', value: number): void {
        this.validVolume(value);
        if (channel === 'master') this.master = value;
        else {
            this.validateChannel(channel);
            this.levels[channel] = value;
        }
        for (const voice of this.playing) this.applyVolume(voice);
    }
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
    setMuted(muted: boolean): void {
        this.muted = muted;
        for (const voice of this.playing) this.applyVolume(voice);
    }
    /** Call from the host's first user gesture; Cocos owns platform audio-unlock integration. */
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
