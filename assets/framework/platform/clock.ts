import { WECHAT } from 'cc/env';
import { SystemClockDriver } from '../core/clock-driver';
import { invariant } from '../core/errors';
/**
 * 默认平台时钟的适配参数；AppOptions.clock 可替换整个驱动。
 */
export interface PlatformClockOptions {
    /**
     * 微信 getPerformance().now() 返回值的单位。框架默认按 microseconds（微秒）除以 1000；
     * 若接入的平台实际提供毫秒，明确改为 milliseconds，避免耗时和校时误差相差 1000 倍。
     */
    readonly wechatPerformanceUnit?: 'microseconds' | 'milliseconds';
}
interface WeChatClockHost {
    getPerformance(): { now(): number };
}
/**
 * 创建当前平台适配的时钟驱动。微信使用 getPerformance 计数，其余使用真实 performance.now。
 * @param input - 平台计数单位等选项，省略使用默认值。
 * @returns 可供 App 注入的 SystemClockDriver，默认不保证后台计数连续。
 * @throws FrameworkError 平台缺少可用单调计数时直接报错，不静默改用系统日期计时。
 */
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
