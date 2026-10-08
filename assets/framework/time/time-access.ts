import type { TaskContext } from '../core/scope';
import type { createCalendar, CalendarOptions, CalendarPeriod, CalendarUnit } from './calendar';

/**
 * 服务器校时响应；两个时间值必须来自同一服务器时钟，均为 UTC 毫秒时间戳。
 */
export interface ServerTimeReply {
    /**
     * 原样返回请求编号，防止旧响应或错配响应更新当前校时结果。
     */
    readonly requestId: string;
    /**
     * 服务器收到本次请求时的 UTC 毫秒时间戳。
     */
    readonly receivedAtMs: number;
    /**
     * 服务器发出本次响应时的 UTC 毫秒时间戳，不得早于 receivedAtMs。
     */
    readonly sentAtMs: number;
}

/**
 * 由项目提供的服务器时间适配器；框架通过多次采样估算网络往返与服务器处理时间。
 */
export interface ServerTimeSource {
    /**
     * 向项目服务器请求一次校时样本。
     * @param requestId - 本次请求编号，响应须原样返回。
     * @param task - 本次采样的 scope、signal 和 commit；网络适配应响应取消，超时通过 signal 通知。
     * @returns 服务器收到请求、发出响应的 UTC 毫秒时间戳。
     */
    sample(requestId: string, task: TaskContext): Promise<ServerTimeReply>;
}

/**
 * 框架当前估计时间及其来源、可信度快照。重要结算应检查质量或使用 requireNowMs。
 */
export interface TimeSnapshot {
    /**
     * 当前估计的 UTC 毫秒时间戳。
     */
    readonly nowMs: number;
    /**
     * device 表示设备时钟；server 表示存在服务器校时锚点。来源为 server 时仍可能已过期。
     */
    readonly source: 'device' | 'server';
    /**
     * local 仅本地估计；synced 已校时且满足项目阈值；stale 未完成、过期或恢复后待重新校时。
     */
    readonly quality: 'local' | 'synced' | 'stale';
    /**
     * 距选中样本的时间，单位毫秒；无有效锚点或时钟连续性失效时为 null。
     */
    readonly sampleAgeMs: number | null;
    /**
     * 估计误差，单位毫秒，包含采样和随时间增长的估计漂移；无法估计时为 null。
     */
    readonly estimatedErrorMs: number | null;
    /**
     * 本次进程内校时锚点更新/重置的递增版本，供界面识别时间变化。
     */
    readonly revision: number;
}

/**
 * 可信服务器时间的质量要求。传给 requireNowMs 时是在项目规则基础上进一步收紧。
 */
export interface TimePolicy {
    /**
     * 允许的样本最大年龄，单位毫秒。项目默认 300000（5 分钟）；单次 requireNowMs 省略时不额外收紧。
     */
    readonly maxAgeMs?: number;
    /**
     * 允许的估计误差上限，单位毫秒。项目默认 5000；单次 requireNowMs 省略时不额外收紧。
     */
    readonly maxErrorMs?: number;
}

/**
 * 应用级时间配置，通常来自面板生成选项，并由项目注入服务器适配器。
 */
export interface TimeOptions extends TimePolicy {
    /** 自动校时策略；有 source 时默认启用，false 表示所有校时（包括恢复前台）由调用方控制。 */
    readonly autoSync?: false | AutoSyncOptions;
    /**
     * 服务器时间适配器；不提供时仅使用设备时间，sync 会报 TIME_SOURCE_MISSING。
     */
    readonly source?: ServerTimeSource;
    /**
     * 每轮校时采样次数，整数 1～8，默认 3。
     */
    readonly sampleCount?: number;
    /**
     * 单次采样的前台等待上限，单位毫秒，默认 5000。
     * 时钟进入后台会使当前校时轮次失效，恢复前台后由服务重新发起校时；不保证后台继续采样。
     */
    readonly requestTimeoutMs?: number;
    /**
     * 日期工具和周期通知的默认时区、周起始日和日切点；单次调用可覆盖。
     */
    readonly calendar?: CalendarOptions;
}

/** 有服务器适配器时的自动校时策略；后台停止请求，恢复前台立即重试。 */
export interface AutoSyncOptions {
    /** 正常刷新间隔，毫秒；默认有效期的 80%，设置更大时仍会在质量过期前提前刷新。 */
    readonly intervalMs?: number;
    /** 首次失败后的重试间隔，毫秒，默认 1000；后续指数退避。 */
    readonly retryDelayMs?: number;
    /** 失败重试间隔上限，毫秒，默认 60000。 */
    readonly maxRetryDelayMs?: number;
}

/**
 * 某个日历周期或截止时刻已到的通知；框架只通知，由业务决定刷新、结算与持久化去重。
 */
export interface CalendarEvent {
    /**
     * 本次周期/时刻的标识；跨重启去重需要业务保存最后处理标识。
     */
    readonly occurrenceKey: string;
    /**
     * 本次边界或计划发生的 UTC 毫秒时间戳，可能早于实际派发时刻。
     */
    readonly scheduledAtMs: number;
    /**
     * 框架观察并派发时的 UTC 毫秒时间戳。
     */
    readonly observedAtMs: number;
    /**
     * due 到期；resume 回前台核对；time-adjusted 时间校正；initial 注册时主动通知当前周期。
     */
    readonly reason: 'due' | 'resume' | 'time-adjusted' | 'initial';
    /**
     * 本次合并通知中跳过的中间周期数；无法建立上一次期次时为 null。业务需要逐日补算时应自行读取持久化记录。
     */
    readonly missedCount: number | null;
}

/**
 * 一次性或周期订阅句柄，跟随注册时的 Scope 结束；不会自动跨进程重启保存。
 */
export interface TimeHandle {
    /**
     * 计划是否仍有效；取消、持有者结束或一次性执行完成后为 false。
     */
    readonly active: boolean;
    /**
     * 预计下一次到期的 UTC 毫秒时间戳；没有下一次时为 null，不承诺后台精确准时回调。
     */
    readonly nextAtMs: number | null;
    /**
     * 提前取消本计划，重复调用安全；已执行中的回调通过 task.signal/commit 配合退出，不会被强制中断。
     */
    cancel(): void;
}

/**
 * 日历通知回调，可同步或返回 Promise。event 描述期次，task 管理本次工作；同一订阅串行执行。
 * 异步写 UI 使用 task.commit；回调失败会取消该订阅并上报，不自动重试业务操作。
 */
export type CalendarCallback = (event: CalendarEvent, task: TaskContext) => void | Promise<void>;

/**
 * 跨日/周/月/年订阅选项；未提供的日历字段继承项目默认设置。
 */
export interface BoundaryOptions extends CalendarOptions {
    /**
     * 是否在注册后的异步派发中先通知当前周期，默认 false；true 适合初次刷新界面，不代表业务奖励可以重复发放。
     */
    readonly emitCurrent?: boolean;
}

/**
 * 相对日历周期的重复计划选项，围绕固定起算点计算每一期。
 */
export interface RepeatOptions {
    /**
     * 固定时区偏移分钟数，例如 480 为 UTC+8；省略时继承项目日历偏移。
     */
    readonly offsetMinutes?: number;
    /**
     * 最初起算的 UTC 毫秒时间戳，省略时捕获注册当时的有效业务时间。跨重启恢复应保存并复用它。
     */
    readonly anchorMs?: number;
    /**
     * 注册时是否异步通知最近已到的期次，默认 false；用于持久化 anchor 的恢复，业务负责去重。
     */
    readonly emitLatestOnStart?: boolean;
}
/** 当前使用期内的时间查询和订阅；订阅随所有者取消。 */
export interface TimeAccess {
    /** 使用项目日历设置的日期工具。 */
    readonly calendar: ReturnType<typeof createCalendar>;

    /**
     * 获取当前估计 UTC 毫秒时间戳，不联网；严格服务器时间请使用 requireNowMs。
     */
    nowMs(): number;

    /**
     * 获取向下取整的 Unix 秒时间戳；与 nowMs 的单位不同。
     */
    nowSeconds(): number;

    /**
     * 返回当前估计时间的新 Date 对象；不携带项目时区，修改它不影响框架。
     */
    nowDate(): Date;

    /**
     * 读取时间来源、质量与误差快照，不会发起校时请求。
     */
    snapshot(): TimeSnapshot;

    /**
     * 要求可信服务器时间。
     * @param policy 可额外收紧年龄和误差阈值，单位毫秒。
     * @returns UTC 毫秒时间戳；质量不满足时抛出 TIME_NOT_SYNCED。
     */
    requireNowMs(policy?: TimePolicy): number;

    /**
     * 计算非负剩余毫秒数，过期返回 0。
     * @param deadline 截止时刻的 UTC 毫秒时间戳。
     */
    remainingMs(deadline: number): number;

    /**
     * 发起或加入共享校时轮次；当前持有者结束时取消本次等待。
     * @returns 校时后的快照；需要项目注入 ServerTimeSource，后台不可发起。
     */
    sync(): Promise<TimeSnapshot>;

    /**
     * 监听校时和质量变化，随当前持有者取消；不是每秒通知。
     * @param callback 同步处理时间快照。
     * @returns 可提前解绑的函数。
     */
    onChanged(callback: (value: TimeSnapshot) => void): () => void;

    /**
     * 指定绝对时刻的一次通知，随当前 Scope 取消。
     * @param epoch 目标 UTC 毫秒时间戳；已过期时在下一次可用派发中通知。
     * @param callback 到期处理，可返回 Promise。
     * @returns 可取消句柄。
     */
    at(epoch: number, callback: CalendarCallback): TimeHandle;

    /**
     * 监听跨日、跨周、跨月或跨年，自动使用当前 Scope；show.time 的订阅会在显示结束时取消。
     * @param unit day/week/month/year，边界由项目时区、日切点与周起始日决定。
     * @param callback 通知回调，支持异步；后台恢复合并错过周期，业务负责持久化去重。
     * @param input 单次日历覆盖与 emitCurrent；默认不通知当前周期，true 时注册后先异步通知一次。
     * @returns 可手动取消的句柄。
     * @example
     * show.time.onBoundary('day', event => {
     *     show.commit(() => { this.lblDay.string = event.occurrenceKey; });
     * }, { emitCurrent: true });
     */
    onBoundary(unit: CalendarUnit, callback: CalendarCallback, input?: BoundaryOptions): TimeHandle;

    /**
     * 从登记时起经过一个日历周期后通知一次，自动跟随当前 Scope。
     * @param period 正整数周期，例如一周 { unit: "week", count: 1 }。
     * @param callback 到期处理。
     * @param input 可覆盖时区偏移分钟数。
     * @returns 一次性句柄；跨重启应保存截止时间改用 at，避免重新起算。
     */
    afterPeriod(
        period: CalendarPeriod,
        callback: CalendarCallback,
        input?: Pick<RepeatOptions, 'offsetMinutes'>,
    ): TimeHandle;

    /**
     * 按固定起算点重复通知，自动跟随当前 Scope；错过多期时合并通知最新一期。
     * @param period 正整数日历周期。
     * @param callback 同一订阅内串行执行的回调。
     * @param input anchorMs 为 UTC 毫秒，省略时从当前有效时间起算；恢复时复用已保存的 anchorMs。
     * @returns 可取消句柄。
     */
    everyPeriod(period: CalendarPeriod, callback: CalendarCallback, input?: RepeatOptions): TimeHandle;
}
