import type { AssetKey } from '../assets/asset-types';

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
/** 使用者期限内的播放能力；所有者结束时停止并释放。 */
export interface AudioAccess {
    /**
     * 播放音频，自动绑定当前期限。
     * @param key 生成的 AudioClip 资源键。
     * @param options 通道、循环及音量；默认 sfx、不循环、音量 1。
     * @returns 可暂停或提前停止的句柄。
     */
    play(key: AssetKey<'AudioClip'>, options?: AudioOptions): Promise<PlaybackHandle>;

    /** 在用户点击等手势内调用，尝试恢复平台允许播放的音频。 */
    resumeFromGesture(): void;
}
