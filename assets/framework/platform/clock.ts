import { WECHAT } from 'cc/env';
import { SystemClockDriver } from '../core/clock-driver';
import { invariant } from '../core/errors';
export interface PlatformClockOptions {
    readonly wechatPerformanceUnit?: 'microseconds' | 'milliseconds';
}
interface WeChatClockHost {
    getPerformance(): { now(): number };
}
/** Explicit platform boundary: Cocos 3.8.8's WeChat window.performance shim is Date.now. */
export function createPlatformClock(input: PlatformClockOptions = {}): SystemClockDriver {
    if (WECHAT) {
        const host = (globalThis as unknown as { wx?: WeChatClockHost }).wx;
        invariant(
            host && typeof host.getPerformance === 'function',
            'MONOTONIC_CLOCK_UNAVAILABLE',
            'WeChat getPerformance is required for elapsed-time measurement',
        );
        const counter = host.getPerformance(),
            divisor = input.wechatPerformanceUnit === 'milliseconds' ? 1 : 1000;
        invariant(
            counter && typeof counter.now === 'function',
            'MONOTONIC_CLOCK_UNAVAILABLE',
            'WeChat performance counter unavailable',
        );
        return new SystemClockDriver(false, () => counter.now() / divisor);
    }
    // Web uses the browser's high-resolution timer; Creator native binds steady_clock in milliseconds.
    return new SystemClockDriver();
}
