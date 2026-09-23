import { invariant } from '../../../core/errors';
/** 剩余秒数向上取整，到期为 0；直接比较截止时间，不累计帧间隔。 */
export function countdownSeconds(deadlineMs: number, nowMs: number): number {
    invariant(
        Number.isFinite(deadlineMs) && Number.isFinite(nowMs) && Math.abs(deadlineMs) <= 8640000000000000,
        'COUNTDOWN_TIME_INVALID',
        '倒计时需要有效毫秒时间戳',
    );
    return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}
/** 默认 HH:mm:ss；小时可以超过 24，业务可传自己的天数或本地化格式。 */
export function formatCountdown(seconds: number): string {
    invariant(Number.isSafeInteger(seconds) && seconds >= 0, 'COUNTDOWN_TIME_INVALID', '剩余秒数须为非负整数');
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
