import { invariant } from '../core/errors';

/**
 * 日历周期单位：day 日、week 周、month 月、year 年。月和年按日历计算，不换算成固定 30/365 天。
 */
export type CalendarUnit = 'day' | 'week' | 'month' | 'year';
/**
 * 日历增量，例如 { unit: "week", count: 1 } 表示一周。用于日期加减、延后一次和重复周期。
 */
export interface CalendarPeriod {
    /**
     * 增量采用的日历单位：日、周、月或年。
     */
    readonly unit: CalendarUnit;
    /**
     * 整数数量；calendar.add 允许负数和 0，afterPeriod/everyPeriod 要求正整数。
     */
    readonly count: number;
}
/**
 * 业务日历规则；低层 calendar 工具独立于项目设置。TimeService 的周期接口会先合并项目默认规则。
 */
export interface CalendarOptions {
    /**
     * 相对 UTC 的固定时区偏移，单位为分钟，范围 -840～840；480 表示 UTC+8。低层工具默认 0，不自动读取设备或项目时区；不含夏令时切换。
     */
    readonly offsetMinutes?: number;
    /**
     * 每周起始日：0 周日、1 周一、…、6 周六，默认 1。
     */
    readonly weekStartsOn?: number;
    /**
     * 业务日刷新时刻，相对此时区零点的分钟数，范围 0～1439，默认 0；240 表示凌晨 04:00，也影响业务周/月/年的边界。
     */
    readonly resetMinute?: number;
}
/**
 * 按指定固定时区拆出的日期和时间，各分量为数字；month 从 1 开始。
 */
export interface DateParts {
    /**
     * 年份，范围 1～9999。
     */
    readonly year: number;
    /**
     * 月份，范围 1～12。
     */
    readonly month: number;
    /**
     * 月内日期，从 1 开始。
     */
    readonly day: number;
    /**
     * 星期编号，0 为周日、6 为周六。
     */
    readonly weekday: number;
    /**
     * 小时，范围 0～23。
     */
    readonly hour: number;
    /**
     * 分钟，范围 0～59。
     */
    readonly minute: number;
    /**
     * 秒，范围 0～59。
     */
    readonly second: number;
    /**
     * 秒内毫秒，范围 0～999。
     */
    readonly millisecond: number;
}
/**
 * 支持的最早 UTC 毫秒时间戳，对应公历 0001 年起点。
 */
export const MIN_EPOCH_MS = -62135596800000;
/**
 * 支持的最晚 UTC 毫秒时间戳，对应公历 9999 年末。
 */
export const MAX_EPOCH_MS = 253402300799999;
const DAY = 86400000;
const units: readonly CalendarUnit[] = ['day', 'week', 'month', 'year'];
/**
 * 校验 UTC 毫秒时间戳为支持范围内的安全整数。
 * @param value 从 Unix 纪元起计算的毫秒数，不能传秒。
 * @returns 原值。
 * @throws INVALID_TIME：数值无效或超出支持的年份。
 */
export function validEpoch(value: number): number {
    invariant(
        Number.isSafeInteger(value) && value >= MIN_EPOCH_MS && value <= MAX_EPOCH_MS,
        'INVALID_TIME',
        'Expected UTC milliseconds in years 0001–9999',
    );
    return value;
}
/**
 * 补齐并验证低层日历选项：默认 UTC+0、周一、一日零点。
 * @param input 需要覆盖的日历规则；不读取项目设置。
 * @returns 三个字段均明确的日历选项。
 */
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
/**
 * 验证周期单位和整数数量。
 * @param period 日历增量。
 * @param positive 为 true 时数量必须大于 0，默认 false 允许 0 和负数。
 * @throws INVALID_CALENDAR_PERIOD：单位或数量无效。
 */
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
/**
 * 将毫秒时间戳拆成年、月、日、时、分、秒等分量。
 * @param epochMs UTC 毫秒时间戳。
 * @param offsetMinutes 固定时区偏移分钟数，默认 0；北京时间传 480。
 * @returns 只读日期分量对象，原时间戳不会被修改。
 */
export function parts(epochMs: number, offsetMinutes = 0): DateParts {
    options({ offsetMinutes });
    const result = fromDate(new Date(validEpoch(epochMs) + offsetMinutes * 60000));
    invariant(result.year >= 1 && result.year <= 9999, 'INVALID_TIME', 'Local date is outside years 0001–9999');
    return result;
}
const pad = (value: number, length = 2) => String(value).padStart(length, '0');
const dateText = (p: DateParts) => `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
/**
 * 转换为 UTC 的标准 ISO 文本，结尾为 Z，包含毫秒。
 * @param epochMs UTC 毫秒时间戳。
 * @returns 例如 2026-09-21T04:00:00.000Z；不使用业务时区。
 */
export function toISO(epochMs: number): string {
    return new Date(validEpoch(epochMs)).toISOString();
}
/**
 * 严格解析带时区的 ISO 日期时间；检查真实日期，不猜测本地时区。
 * @param text 必须带 Z 或 ±HH:mm，可带 1～3 位小数秒；不接受单独日期或 Excel 序号。
 * @returns UTC 毫秒时间戳。
 * @throws INVALID_ISO_TIME：文本或日期无效。
 * @example
 * const deadlineMs = show.time.calendar.parseISO("2026-10-01T04:00:00+08:00");
 */
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
/**
 * 将毫秒时间戳转换成用于界面显示的日期/时间字符串。
 * 这是独立格式化工具，当前不自动继承面板的日历偏移，也不修改时间戳。
 * @param epochMs UTC 毫秒时间戳，例如 show.time.nowMs()。
 * @param style date 为 YYYY-MM-DD，time 为 HH:mm:ss，datetime 为两者组合；默认 datetime。
 * @param offsetMinutes 相对 UTC 的分钟偏移，默认 0；480 表示 UTC+8。
 * @returns 例如 2026-09-21 12:00:00。
 * @example
 * const text = show.time.calendar.format(show.time.nowMs(), 'datetime', 480);
 */
export function format(epochMs: number, style: 'date' | 'time' | 'datetime' = 'datetime', offsetMinutes = 0): string {
    const p = parts(epochMs, offsetMinutes);
    const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
    return style === 'date' ? dateText(p) : style === 'time' ? time : `${dateText(p)} ${time}`;
}
/**
 * 按日历加减周期。日/周按固定 24 小时/7 天；月/年保持时分秒，日期超出目标月份时收敛到月末。
 * @param epochMs 起点 UTC 毫秒时间戳。
 * @param period 日历单位和整数数量，允许负数和 0。
 * @param offsetMinutes 计算月/年时使用的固定时区偏移分钟数，默认 0。
 * @returns 新的 UTC 毫秒时间戳，不修改起点。
 */
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
/**
 * 获取该时刻所属业务日/周/月/年的起点。
 * @param epochMs UTC 毫秒时间戳。
 * @param unit 业务周期单位。
 * @param input 日历规则；低层默认 UTC+0/周一/零点，resetMinute 会改变周期归属。
 * @returns 周期起点的 UTC 毫秒时间戳。
 */
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
/**
 * 获取当前业务周期结束后，下一个周期的起点。
 * @param epochMs 当前 UTC 毫秒时间戳。
 * @param unit 周期单位。
 * @param input 时区、每周起始日和刷新分钟；默认使用低层规则。
 * @returns 下一个边界的 UTC 毫秒时间戳。
 */
export function nextBoundary(epochMs: number, unit: CalendarUnit, input: CalendarOptions = {}): number {
    return add(startOf(epochMs, unit, input), { unit, count: 1 }, options(input).offsetMinutes);
}
/**
 * 生成业务周期标识，可保存用于业务去重；标识包含日期、单位和日历规则。
 * @param epochMs UTC 毫秒时间戳。
 * @param unit 周期单位。
 * @param input 日历规则，比较标识时应使用一致规则。
 * @returns 周期标识字符串；格式应整体保存，不建议依赖字符串下标解析业务字段。
 */
export function periodKey(epochMs: number, unit: CalendarUnit, input: CalendarOptions = {}): string {
    const o = options(input);
    const date = dateText(parts(startOf(epochMs, unit, o), o.offsetMinutes));
    return `${unit}:${date}:o${o.offsetMinutes}:w${o.weekStartsOn}:r${o.resetMinute}`;
}
/**
 * 判断两个时刻是否属于相同业务周期。
 * @param a 第一个 UTC 毫秒时间戳。
 * @param b 第二个 UTC 毫秒时间戳。
 * @param unit 日/周/月/年。
 * @param input 两个时刻共用的日历规则。
 * @returns 是否具有相同周期起点。
 */
export function isSamePeriod(a: number, b: number, unit: CalendarUnit, input?: CalendarOptions): boolean {
    return startOf(a, unit, input) === startOf(b, unit, input);
}
/**
 * 将持续时间转换为 HH:mm:ss，向上取整到秒；小时可超过 24，负数显示为 00:00:00。
 * @param milliseconds 持续时间，单位为毫秒，不是绝对时间戳。
 * @returns 不涉及时区的时长文字。
 * @example
 * const text = show.time.calendar.formatDuration(show.time.remainingMs(deadlineMs));
 */
export function formatDuration(milliseconds: number): string {
    invariant(Number.isFinite(milliseconds), 'INVALID_DURATION', 'Duration must be finite');
    const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
/**
 * 独立纯日期工具集合，默认采用 UTC；TimeService 使用 createCalendar 创建继承项目设置的入口。
 */
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
    /**
     * 取得当前时刻所属业务日的起点，是 startOf(ms, "day", input) 的便捷写法。
     * @param ms - UTC 毫秒时间戳。
     * @param input - 固定时区及日切规则，默认 UTC+0、零点；不自动继承项目设置。
     * @returns 业务日起点的 UTC 毫秒时间戳。
     */
    dayStartMs: (ms: number, input?: CalendarOptions) => startOf(ms, 'day', input),
    /**
     * 取得业务日标识，是 periodKey(ms, "day", input) 的便捷写法，可用于业务去重。
     * @param ms - UTC 毫秒时间戳。
     * @param input - 日历规则，默认 UTC+0、周一、零点；跨会话比较应保持规则一致。
     * @returns 带规则的日标识；保存整个标识，不依赖字符串切片提取日期。
     */
    dayKey: (ms: number, input?: CalendarOptions) => periodKey(ms, 'day', input),
    formatDuration,
});

/**
 * 创建继承项目规则的日期入口；显式传参仍可覆盖时区、周起始日和日切点。
 * @param input 项目日历规则，创建时复制，不受外部后续修改影响。
 * @returns 与纯 calendar 相同的工具及只读 rules；toISO/parseISO 始终遵循 ISO 自身的时区。
 */
export function createCalendar(input: CalendarOptions = {}) {
    const rules = Object.freeze(options(input));
    const merged = (override?: CalendarOptions) => ({ ...rules, ...override });
    return Object.freeze({
        ...calendar,
        /** 本入口实际采用的默认日历规则；格式化日期不应用业务日切偏移。 */
        rules,
        /** 分解日期；offsetMinutes 省略时采用项目时区。 */
        parts: (ms: number, offsetMinutes = rules.offsetMinutes) => parts(ms, offsetMinutes),
        /** 格式化日期；省略时区使用项目设置，传 0 可明确按 UTC 显示。 */
        format: (ms: number, style: 'date' | 'time' | 'datetime' = 'datetime', offsetMinutes = rules.offsetMinutes) =>
            format(ms, style, offsetMinutes),
        /** 增减日历周期；月末截断规则与纯 add 相同，默认采用项目时区。 */
        add: (ms: number, period: CalendarPeriod, offsetMinutes = rules.offsetMinutes) =>
            add(ms, period, offsetMinutes),
        /** 获取业务周期起点；省略字段继承项目规则。 */
        startOf: (ms: number, unit: CalendarUnit, override?: CalendarOptions) => startOf(ms, unit, merged(override)),
        /** 获取下一业务周期边界；省略字段继承项目规则。 */
        nextBoundary: (ms: number, unit: CalendarUnit, override?: CalendarOptions) =>
            nextBoundary(ms, unit, merged(override)),
        /** 获取业务期次键，适合保存日切去重标识。 */
        periodKey: (ms: number, unit: CalendarUnit, override?: CalendarOptions) =>
            periodKey(ms, unit, merged(override)),
        /** 按项目规则判断两个时刻是否属于同一业务周期。 */
        isSamePeriod: (a: number, b: number, unit: CalendarUnit, override?: CalendarOptions) =>
            isSamePeriod(a, b, unit, merged(override)),
        /** 获取业务日开始时间戳，包含项目日切规则。 */
        dayStartMs: (ms: number, override?: CalendarOptions) => startOf(ms, 'day', merged(override)),
        /** 获取业务日键，包含项目日切规则。 */
        dayKey: (ms: number, override?: CalendarOptions) => periodKey(ms, 'day', merged(override)),
    });
}
