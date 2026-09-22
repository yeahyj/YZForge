import type { ClockDriver } from '../../../../../framework/core/clock-driver';

/** 实验专用时钟。只注入独立 TimeService，不修改应用时间、设备时间或真实服务器。 */
export class LabClock implements ClockDriver {
    private wall = Date.parse('2026-01-31T03:59:00+08:00');
    private mono = 0;
    private sequence = 0;
    private readonly timers = new Map<number, { at: number; callback: () => void }>();
    private readonly listeners = new Set<() => void>();
    readonly continuesInBackground = true;
    readonly epoch = 0;
    background = false;

    /** 模拟设备 UTC 毫秒时间戳。 */
    deviceNowMs(): number {
        return this.wall;
    }
    /** 模拟连续单调时钟，不受设备回拨影响。 */
    monotonicMs(): number {
        return this.mono;
    }
    /** 登记唤醒，仅在实验主动推进时执行。 */
    wake(callback: () => void, afterMs: number): () => void {
        const id = ++this.sequence;
        this.timers.set(id, { at: this.mono + Math.max(0, afterMs), callback });
        return () => {
            this.timers.delete(id);
        };
    }
    /** 订阅模拟前后台变化。 */
    onStateChange(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }
    /** 推进两个时钟；只调度当前已登记的到期任务，避免周期追赶死循环。 */
    advance(ms: number): void {
        if (!Number.isFinite(ms) || ms < 0) throw Error('实验只允许正向推进单调时间');
        this.wall += ms;
        this.mono += ms;
        for (const [id, timer] of Array.from(this.timers))
            if (timer.at <= this.mono && this.timers.delete(id)) timer.callback();
    }
    /** 仅回拨设备时间，不回拨单调时钟。 */
    rewindDay(): void {
        this.wall -= 86400000;
        this.advance(0);
    }
    /** 模拟前后台；框架自行决定合并补发哪些边界。 */
    setBackground(value: boolean): void {
        this.background = value;
        for (const callback of Array.from(this.listeners)) callback();
    }
    /** 用于验证 Scope 关闭后不再保留唤醒或监听。 */
    inspect() {
        return { timers: this.timers.size, listeners: this.listeners.size };
    }
}
