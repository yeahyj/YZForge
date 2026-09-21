import { FrameworkError } from './errors';
/**
 * 平台时钟适配合同，区分设备 UTC 时间、单调计时及前后台状态。
 * 供 TimeService 和清理截止控制使用，业务时间功能优先访问 ctx.time。
 */
export interface ClockDriver {
    /**
     * 读取设备 UTC 毫秒时间戳，可受用户修改系统时间影响，不代表可信服务器时间。
     */
    deviceNowMs(): number;
    /**
     * 读取单调计数，单位毫秒；用于测量同一 epoch 内的耗时，起点任意，不能格式化为日期。
     */
    monotonicMs(): number;
    /**
     * 单调计时连续区间的编号。若恢复后无法证明计数连续，应增加编号，使旧测量失效。
     */
    readonly epoch: number;
    /**
     * 应用是否处于后台；由平台事件更新，不等同于某个 UI 是否隐藏。
     */
    readonly background: boolean;
    /**
     * 平台是否明确保证单调计数跨后台持续有效；不确定时必须为 false。
     */
    readonly continuesInBackground: boolean;
    /**
     * 请求一次将来的唤醒，供内部重新检查截止时间；允许提前或延后发生，调用方应重新核对时钟。
     * @param callback - 唤醒回调。
     * @param afterMs - 希望等待的毫秒数。
     * @returns 取消这次唤醒的函数；不保证后台按时执行。
     */
    wake(callback: () => void, afterMs: number): () => void;
    /**
     * 订阅前后台或连续性状态变化，不是每秒回调。
     * @param callback - 状态改变后读取驱动最新字段的同步函数。
     * @returns 取消订阅的函数。
     */
    onStateChange(callback: () => void): () => void;
}
/**
 * 默认平台驱动，设备日期取 Date.now，耗时取真实单调计数。
 * 不使用 Date.now 冒充单调时钟；微信等平台由 createPlatformClock 适配。
 */
export class SystemClockDriver implements ClockDriver {
    private hidden = false;
    private generation = 0;
    private readonly listeners = new Set<() => void>();
    private readonly readMonotonic: () => number;
    /**
     * 创建平台驱动并检查单调时间可用性。
     * @param continuesInBackground - 是否明确保证跨后台连续，默认 false。
     * @param readMonotonic - 可选单调毫秒读取函数；默认使用 performance.now。
     * @throws FrameworkError 缺少真实单调时钟或计数不是有限毫秒数。
     */
    constructor(
        /**
         * 是否声明后台期间单调计时连续，默认 false；该声明应来自经过验证的平台实现。
         */
        readonly continuesInBackground = false,
        readMonotonic?: () => number,
    ) {
        if (readMonotonic) this.readMonotonic = readMonotonic;
        else {
            if (
                typeof performance === 'undefined' ||
                typeof performance.now !== 'function' ||
                performance.now === Date.now
            )
                throw new FrameworkError(
                    'MONOTONIC_CLOCK_UNAVAILABLE',
                    'Supply a platform ClockDriver; a Date.now shim is not a monotonic clock',
                );
            this.readMonotonic = performance.now.bind(performance);
        }
        if (!Number.isFinite(this.readMonotonic()))
            throw new FrameworkError('MONOTONIC_CLOCK_INVALID', 'Clock source must return finite milliseconds');
    }
    /**
     * 当前单调区间编号；默认在后台恢复前台时递增，使旧服务器时间锚点过期。
     */
    get epoch(): number {
        return this.generation;
    }
    /**
     * 最近一次 setBackground 设置的前后台状态，初始为 false。
     */
    get background(): boolean {
        return this.hidden;
    }
    /**
     * 返回 Date.now 的 UTC 毫秒时间戳；不进行服务器校时。
     */
    deviceNowMs(): number {
        return Date.now();
    }
    /**
     * 返回平台单调毫秒数，只用作同一 epoch 内的耗时差值。
     */
    monotonicMs(): number {
        return this.readMonotonic();
    }
    /**
     * 设置一次内部唤醒，实际等待被限制到 0～60000 毫秒；较长目标由调用方再次检查及续约。
     * @param callback - 定时器回调。
     * @param afterMs - 希望等待的毫秒数。
     * @returns 清除此定时器的函数；不是业务“到某日期”接口。
     */
    wake(callback: () => void, afterMs: number): () => void {
        const timer = setTimeout(callback, Math.min(60000, Math.max(0, afterMs)));
        return () => clearTimeout(timer);
    }
    /**
     * 接收平台前后台事件，状态改变时同步通知监听者。
     * @param hidden - true 进入后台，false 回到前台；不能保证后台计时连续时，恢复会增加 epoch。
     */
    setBackground(hidden: boolean): void {
        if (hidden === this.hidden) return;
        this.hidden = hidden;
        if (!hidden && !this.continuesInBackground) this.generation++;
        for (const callback of Array.from(this.listeners)) callback();
    }
    /**
     * 登记状态变化回调，注册时不立即调用。
     * @param callback - 快速同步回调，应避免抛错。
     * @returns 取消监听的函数。
     */
    onStateChange(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }
}
/**
 * @internal
 * 按前台有效耗时控制一次清理截止，不依赖设备日期或 TimeService 是否已经关停。
 * @param clock - 底层时钟。
 * @param durationMs - 前台累计毫秒数；后台暂停累计，计数区间变化后重新建立测量点。
 * @param callback - 到期执行一次；不会强制中止尚未结束的异步操作。
 * @returns 取消截止监听的函数。
 */
export function foregroundDeadline(clock: ClockDriver, durationMs: number, callback: () => void): () => void {
    let remaining = durationMs;
    let last = clock.monotonicMs();
    let wasHidden = clock.background;
    let epoch = clock.epoch;
    let cancelled = false;
    let stopWake = () => {};
    let stopState = () => {};
    const cancel = () => {
        cancelled = true;
        stopWake();
        stopState();
    };
    const tick = () => {
        if (cancelled) return;
        stopWake();
        const now = clock.monotonicMs();
        if (!wasHidden && epoch === clock.epoch) remaining -= Math.max(0, now - last);
        last = now;
        wasHidden = clock.background;
        epoch = clock.epoch;
        if (remaining <= 0) {
            cancel();
            callback();
        } else if (!clock.background) stopWake = clock.wake(tick, remaining);
    };
    stopState = clock.onStateChange(tick);
    tick();
    return cancel;
}
