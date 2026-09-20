import { invariant } from '../core/errors';

export type CalendarUnit = 'day' | 'week' | 'month' | 'year';
export interface CalendarPeriod {
    readonly unit: CalendarUnit;
    readonly count: number;
}
export interface CalendarOptions {
    readonly offsetMinutes?: number;
    readonly weekStartsOn?: number;
    readonly resetMinute?: number;
}
export interface DateParts {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly weekday: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
    readonly millisecond: number;
}
export const MIN_EPOCH_MS = -62135596800000;
export const MAX_EPOCH_MS = 253402300799999;
const DAY = 86400000;
const units: readonly CalendarUnit[] = ['day', 'week', 'month', 'year'];
export function validEpoch(value: number): number {
    invariant(
        Number.isSafeInteger(value) && value >= MIN_EPOCH_MS && value <= MAX_EPOCH_MS,
        'INVALID_TIME',
        'Expected UTC milliseconds in years 0001–9999',
    );
    return value;
}
export function options(input: CalendarOptions = {}): Required<CalendarOptions> {
    const result = {
        offsetMinutes: input.offsetMinutes ?? 0,
        weekStartsOn: input.weekStartsOn ?? 1,
        resetMinute: input.resetMinute ?? 0,
    };
    invariant(
        Number.isInteger(result.offsetMinutes) && Math.abs(result.offsetMinutes) <= 840,
        'INVALID_TIME_ZONE',
        'offsetMinutes must be in [-840, 840]',
    );
    invariant(
        Number.isInteger(result.weekStartsOn) && result.weekStartsOn >= 0 && result.weekStartsOn <= 6,
        'INVALID_WEEK_START',
        'weekStartsOn is 0 (Sunday) through 6',
    );
    invariant(
        Number.isInteger(result.resetMinute) && result.resetMinute >= 0 && result.resetMinute < 1440,
        'INVALID_RESET_TIME',
        'resetMinute must be in [0, 1439]',
    );
    return result;
}
export function validPeriod(period: CalendarPeriod, positive = false): void {
    invariant(
        units.includes(period.unit) && Number.isSafeInteger(period.count) && (!positive || period.count > 0),
        'INVALID_CALENDAR_PERIOD',
        'Invalid calendar unit or count',
    );
}
function utc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, ms);
    return date.getTime();
}
function fromDate(date: Date): DateParts {
    return Object.freeze({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
        millisecond: date.getUTCMilliseconds(),
    });
}
export function parts(epochMs: number, offsetMinutes = 0): DateParts {
    options({ offsetMinutes });
    const result = fromDate(new Date(validEpoch(epochMs) + offsetMinutes * 60000));
    invariant(result.year >= 1 && result.year <= 9999, 'INVALID_TIME', 'Local date is outside years 0001–9999');
    return result;
}
const pad = (value: number, length = 2) => String(value).padStart(length, '0');
const dateText = (p: DateParts) => `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
export function toISO(epochMs: number): string {
    return new Date(validEpoch(epochMs)).toISOString();
}
/** Strict RFC3339 subset: explicit zone, real calendar date, no rollover or leap seconds. */
export function parseISO(text: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
    invariant(m, 'INVALID_ISO_TIME', 'Use YYYY-MM-DDTHH:mm:ss[.SSS]Z or an explicit ±HH:mm offset');
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
    invariant(
        year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour < 24 && minute < 60 && second < 60,
        'INVALID_ISO_TIME',
        'Invalid date or time fields',
    );
    let offset = 0;
    if (m[8] !== 'Z') {
        const hours = Number(m[8].slice(1, 3)),
            minutes = Number(m[8].slice(4, 6));
        invariant(
            minutes < 60 && hours <= 14 && (hours < 14 || minutes === 0),
            'INVALID_ISO_TIME',
            'Invalid UTC offset',
        );
        offset = (hours * 60 + minutes) * (m[8][0] === '-' ? -1 : 1);
    }
    const local = utc(year, month, day, hour, minute, second, Number((m[7] ?? '').padEnd(3, '0')));
    const check = fromDate(new Date(local));
    invariant(
        check.year === year && check.month === month && check.day === day,
        'INVALID_ISO_TIME',
        'Date does not exist',
    );
    return validEpoch(local - offset * 60000);
}
export function format(epochMs: number, style: 'date' | 'time' | 'datetime' = 'datetime', offsetMinutes = 0): string {
    const p = parts(epochMs, offsetMinutes);
    const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
    return style === 'date' ? dateText(p) : style === 'time' ? time : `${dateText(p)} ${time}`;
}
export function add(epochMs: number, period: CalendarPeriod, offsetMinutes = 0): number {
    validPeriod(period);
    const p = parts(epochMs, offsetMinutes);
    if (period.unit === 'day' || period.unit === 'week')
        return validEpoch(epochMs + period.count * DAY * (period.unit === 'week' ? 7 : 1));
    const months = (p.year - 1) * 12 + p.month - 1 + period.count * (period.unit === 'year' ? 12 : 1);
    const year = Math.floor(months / 12) + 1,
        month = (((months % 12) + 12) % 12) + 1;
    invariant(year >= 1 && year <= 9999, 'INVALID_TIME', 'Calendar addition exceeds supported years');
    const lastDay = new Date(utc(year, month + 1, 0)).getUTCDate();
    return validEpoch(
        utc(year, month, Math.min(p.day, lastDay), p.hour, p.minute, p.second, p.millisecond) - offsetMinutes * 60000,
    );
}
export function startOf(epochMs: number, unit: CalendarUnit, input: CalendarOptions = {}): number {
    validPeriod({ unit, count: 1 });
    const o = options(input);
    const shift = (o.offsetMinutes - o.resetMinute) * 60000;
    const p = fromDate(new Date(validEpoch(epochMs) + shift));
    let start = utc(p.year, p.month, p.day);
    if (unit === 'week') start -= ((p.weekday - o.weekStartsOn + 7) % 7) * DAY;
    if (unit === 'month') start = utc(p.year, p.month, 1);
    if (unit === 'year') start = utc(p.year, 1, 1);
    return validEpoch(start - shift);
}
export function nextBoundary(epochMs: number, unit: CalendarUnit, input: CalendarOptions = {}): number {
    return add(startOf(epochMs, unit, input), { unit, count: 1 }, options(input).offsetMinutes);
}
export function periodKey(epochMs: number, unit: CalendarUnit, input: CalendarOptions = {}): string {
    const o = options(input);
    const date = dateText(parts(startOf(epochMs, unit, o), o.offsetMinutes));
    return `${unit}:${date}:o${o.offsetMinutes}:w${o.weekStartsOn}:r${o.resetMinute}`;
}
export function isSamePeriod(a: number, b: number, unit: CalendarUnit, input?: CalendarOptions): boolean {
    return startOf(a, unit, input) === startOf(b, unit, input);
}
export function formatDuration(milliseconds: number): string {
    invariant(Number.isFinite(milliseconds), 'INVALID_DURATION', 'Duration must be finite');
    const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
export const calendar = Object.freeze({
    toISO,
    parseISO,
    parts,
    format,
    add,
    startOf,
    nextBoundary,
    periodKey,
    isSamePeriod,
    dayStartMs: (ms: number, input?: CalendarOptions) => startOf(ms, 'day', input),
    dayKey: (ms: number, input?: CalendarOptions) => periodKey(ms, 'day', input),
    formatDuration,
});
