import { ClockDriver, foregroundDeadline } from '../core/clock-driver';
import { untilCancelled } from '../core/cancellation';
import { ErrorReporter, invariant, OperationCancelled, reportError } from '../core/errors';
import { runTask, Scope, TaskContext, Lifetime } from '../core/scope';
import {
    add,
    createCalendar,
    CalendarOptions,
    CalendarPeriod,
    CalendarUnit,
    nextBoundary,
    options,
    parts,
    periodKey,
    startOf,
    validEpoch,
    validPeriod,
} from './calendar';

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
type Anchor = { utc: number; mono: number; epoch: number; error: number };
type Round = { scope: Scope; epoch: number; serial: number; waiters: number; promise: Promise<TimeSnapshot> };
type Plan = {
    scope: Scope;
    callback: CalendarCallback;
    active: boolean;
    busy: boolean;
    next: number | null;
    cursor: number | null;
    initialized: boolean;
    initial: boolean;
    anchored: boolean;
    candidate(now: number): { cursor: number; at: number; key: string; next: number | null };
};

/**
 * 应用级时间服务：当前时间、服务器校时、截止时刻和日/周/月/年周期通知。
 * 后台暂停派发，回前台核对并合并错过的周期；不提供跨进程持久化或任意毫秒游戏调度。
 */
export class TimeService {
    /**
     * 继承项目日历规则的工具集合；显式传时区可覆盖。独立导出的 calendar 仍是默认 UTC 的纯工具。
     */
    readonly calendar: ReturnType<typeof createCalendar>;
    private anchor?: Anchor;
    private revision = 0;
    private syncSerial = 0;
    private round?: Round;
    private resumeStale = false;
    private lastEstimate = 0;
    private lastDevice: number;
    private lastMono: number;
    private quality = '';
    private queuedChange = false;
    private closed = false;
    private readonly scope: Scope;
    private readonly listeners = new Set<{ scope: Lifetime; callback: (value: TimeSnapshot) => void }>();
    private readonly plans = new Set<Plan>();
    private stopWake = () => {};
    private stopState: () => void;
    private readonly autoSync: Required<AutoSyncOptions> | undefined;
    private nextSyncAt = 0;
    private autoSyncPending = false;
    private syncFailures = 0;
    private dispatchReason: CalendarEvent['reason'] = 'due';
    /**
     * 创建应用级时间服务，一般由 App 装配。
     * @param clock 平台时钟驱动。
     * @param owner 服务所属的期限，结束后停止校时和日历订阅。
     * @param settings 来源、质量阈值与业务日历规则。
     * @param report 后台任务错误上报函数。
     */
    constructor(
        /**
         * 时间服务使用的底层设备/单调时钟驱动；业务日期通常通过 nowMs 等入口读取。
         */
        readonly clock: ClockDriver,
        owner: Lifetime,
        private readonly settings: TimeOptions = {},
        private readonly report: ErrorReporter = reportError,
    ) {
        this.calendar = createCalendar(settings.calendar);
        for (const [key, value] of Object.entries({
            maxAgeMs: settings.maxAgeMs ?? 300000,
            maxErrorMs: settings.maxErrorMs ?? 5000,
            requestTimeoutMs: settings.requestTimeoutMs ?? 5000,
        }))
            invariant(
                Number.isFinite(value) && value > 0,
                'INVALID_TIME_OPTIONS',
                `${key} must be positive and finite`,
            );
        if (settings.source && settings.autoSync !== false) {
            const auto = settings.autoSync ?? {};
            this.autoSync = {
                intervalMs: auto.intervalMs ?? (settings.maxAgeMs ?? 300000) * 0.8,
                retryDelayMs: auto.retryDelayMs ?? 1000,
                maxRetryDelayMs: auto.maxRetryDelayMs ?? 60000,
            };
            invariant(
                Object.values(this.autoSync).every((value) => Number.isFinite(value) && value > 0) &&
                    this.autoSync.maxRetryDelayMs >= this.autoSync.retryDelayMs,
                'INVALID_TIME_OPTIONS',
                'Invalid automatic synchronization intervals',
            );
        }
        this.scope = owner.child('time');
        this.lastDevice = clock.deviceNowMs();
        this.lastMono = clock.monotonicMs();
        this.stopState = clock.onStateChange(() => {
            this.invalidateRound('Host state changed');
            if (!clock.background) {
                this.resumeStale = !!settings.source;
                this.dispatchReason = 'resume';
                this.changed();
                this.nextSyncAt = clock.monotonicMs();
                this.syncFailures = 0;
            }
            this.pump();
        });
        this.scope.signal.onAbort(() => {
            this.closed = true;
            this.stopWake();
            this.stopState();
            this.invalidateRound('Time service closed');
            for (const plan of Array.from(this.plans)) this.cancelPlan(plan);
            this.listeners.clear();
        });
        this.pump();
    }
    /**
     * 获取当前估计的 UTC 毫秒时间戳；无锚点时读设备时间，有有效锚点时按单调计数推算。
     * 时钟连续性失效后暂时保持最后一次估计，直到重新校时；可通过 snapshot 查看 stale 状态。
     * @returns 毫秒整数，时区设置不会改变时间戳。读取本身不联网；需要符合质量规则的服务器时间用 requireNowMs。
     */
    nowMs(): number {
        if (!this.anchor) return validEpoch(Math.floor(this.clock.deviceNowMs()));
        if (this.anchor.epoch !== this.clock.epoch) return this.lastEstimate;
        this.lastEstimate = validEpoch(
            Math.floor(this.anchor.utc + Math.max(0, this.clock.monotonicMs() - this.anchor.mono)),
        );
        return this.lastEstimate;
    }
    /**
     * 获取当前估计的 Unix 秒时间戳，向下取整；内部相当于 Math.floor(nowMs() / 1000)。
     * @returns 秒整数，不是毫秒。
     */
    nowSeconds(): number {
        return Math.floor(this.nowMs() / 1000);
    }
    /**
     * 将当前估计时间包装为新的 Date 对象；修改返回对象不会修改框架时钟。
     * @returns 独立 Date；它自身不携带业务时区。
     */
    nowDate(): Date {
        return new Date(this.nowMs());
    }
    /**
     * 直接获取设备时钟的 UTC 毫秒时间戳，不应用服务器校时，适合诊断设备时间。
     */
    deviceNowMs(): number {
        return this.clock.deviceNowMs();
    }
    /**
     * 读取当前时间、来源、质量、样本年龄和估计误差；不会联网。
     * @returns 不可变时间快照，具体字段含义见 TimeSnapshot。
     */
    snapshot(): TimeSnapshot {
        const a = this.anchor;
        const age = a && a.epoch === this.clock.epoch ? Math.max(0, this.clock.monotonicMs() - a.mono) : null;
        const error = age === null ? null : a!.error + age * 0.00005;
        const synced =
            !!a &&
            !this.resumeStale &&
            age !== null &&
            age <= (this.settings.maxAgeMs ?? 300000) &&
            error !== null &&
            error <= (this.settings.maxErrorMs ?? 5000);
        return Object.freeze({
            nowMs: this.nowMs(),
            source: a ? 'server' : 'device',
            quality: synced ? 'synced' : this.settings.source ? 'stale' : 'local',
            sampleAgeMs: age,
            estimatedErrorMs: error,
            revision: this.revision,
        });
    }
    /**
     * 只在服务器时间满足项目质量规则及本次附加规则时返回当前时间。
     * @param policy 可选的更严格样本年龄/误差上限，单位均为毫秒。
     * @returns 可信服务器 UTC 毫秒时间戳。
     * @throws TIME_NOT_SYNCED：未校时、本地模式、已过期或误差超限。
     */
    requireNowMs(policy: TimePolicy = {}): number {
        const state = this.snapshot();
        invariant(
            state.quality === 'synced' &&
                state.sampleAgeMs! <= (policy.maxAgeMs ?? Infinity) &&
                state.estimatedErrorMs! <= (policy.maxErrorMs ?? Infinity),
            'TIME_NOT_SYNCED',
            'Fresh server time is required',
        );
        return state.nowMs;
    }
    /**
     * 计算到截止时刻的剩余毫秒数，过期返回 0；每次调用从当前估计时间重新计算。
     * @param deadlineMs 截止时刻的 UTC 毫秒时间戳。
     * @returns 非负毫秒数，适合刷新倒计时。
     */
    remainingMs(deadlineMs: number): number {
        return Math.max(0, validEpoch(deadlineMs) - this.nowMs());
    }
    /**
     * 监听校时、来源或质量变化；不是每秒更新通知，不保证注册时立即回调。
     * @param callback 同步接收新的时间快照。
     * @param scope 订阅期限，取消时自动解绑。
     * @returns 可手动解绑的函数。
     */
    onChanged(callback: (value: TimeSnapshot) => void, scope: Lifetime): () => void {
        scope.signal.throwIfAborted();
        const item = { scope, callback };
        this.listeners.add(item);
        let detach = () => {};
        const off = () => {
            this.listeners.delete(item);
            detach();
        };
        detach = scope.signal.onAbort(off);
        return off;
    }
    /**
     * 清除校时锚点并使当前采样轮次失效，适合退出账号或切换服务器。
     * 不修改设备时间；配置了服务器来源时恢复为 stale，待再次 sync。
     * @param reason 取消在途校时的原因说明。
     */
    resetSync(reason = 'Connection changed'): void {
        this.invalidateRound(reason);
        this.anchor = undefined;
        this.resumeStale = false;
        this.revision++;
        this.nextSyncAt = this.clock.monotonicMs();
        this.syncFailures = 0;
        this.changed();
        this.pump();
    }
    /**
     * 采样服务器时间并更新框架锚点；并发调用共享同一轮，单个持有者取消只结束自己的等待。
     * @param owner 本次等待的期限；所有等待者退出时取消本轮，迟到结果不能提交。
     * @returns 更新后的 TimeSnapshot；不会修改系统时钟。
     * @throws TIME_SOURCE_MISSING、TIME_BACKGROUND 或采样失败/取消错误。
     */
    async sync(owner: Lifetime): Promise<TimeSnapshot> {
        owner.signal.throwIfAborted();
        this.scope.signal.throwIfAborted();
        invariant(this.settings.source, 'TIME_SOURCE_MISSING', 'Install a ServerTimeSource for server synchronization');
        invariant(!this.clock.background, 'TIME_BACKGROUND', 'Synchronization is suspended in background');
        let round = this.round;
        if (!round) {
            const scope = this.scope.child('sync');
            round = {
                scope,
                epoch: this.clock.epoch,
                serial: ++this.syncSerial,
                waiters: 0,
                promise: Promise.resolve(null as unknown as TimeSnapshot),
            };
            this.round = round;
            const captured = round;
            round.promise = Promise.resolve()
                .then(() => this.collect(captured))
                .finally(async () => {
                    if (this.round === captured) this.round = undefined;
                    await scope.close();
                    this.scheduleWake();
                });
        }
        round.waiters++;
        try {
            return await untilCancelled(round.promise, owner.signal);
        } finally {
            if (--round.waiters === 0 && this.round === round) this.invalidateRound('No synchronization waiters');
        }
    }
    private invalidateRound(reason: string): void {
        if (this.round) {
            this.round.scope.cancel(new OperationCancelled(reason));
            this.round = undefined;
        }
        this.syncSerial++;
    }
    private async collect(round: Round): Promise<TimeSnapshot> {
        const samples: Anchor[] = [];
        const count = this.settings.sampleCount ?? 3;
        invariant(
            Number.isInteger(count) && count >= 1 && count <= 8,
            'INVALID_TIME_OPTIONS',
            'sampleCount must be 1–8',
        );
        for (let index = 0; index < count; index++) {
            round.scope.signal.throwIfAborted();
            const request = round.scope.child(`sample:${index}`);
            const stop = foregroundDeadline(this.clock, this.settings.requestTimeoutMs ?? 5000, () =>
                request.cancel(new OperationCancelled('Time sample deadline')),
            );
            try {
                const requestId = `${round.serial}:${index}`;
                const m0 = this.clock.monotonicMs();
                const reply = await untilCancelled(
                    Promise.resolve().then(() =>
                        this.settings.source!.sample(requestId, {
                            scope: request,
                            signal: request.signal,
                            commit: (action) => {
                                if (request.signal.aborted) return false;
                                action();
                                return true;
                            },
                        }),
                    ),
                    request.signal,
                );
                const m3 = this.clock.monotonicMs();
                validEpoch(reply.receivedAtMs);
                validEpoch(reply.sentAtMs);
                const rtt = m3 - m0 - (reply.sentAtMs - reply.receivedAtMs);
                invariant(
                    reply.requestId === requestId &&
                        reply.sentAtMs >= reply.receivedAtMs &&
                        rtt >= 0 &&
                        rtt <= 10000 &&
                        m3 >= m0 &&
                        round.epoch === this.clock.epoch,
                    'INVALID_TIME_SAMPLE',
                    'Invalid timestamp units, request identity, RTT or clock epoch',
                );
                samples.push({ utc: reply.sentAtMs + rtt / 2, mono: m3, epoch: round.epoch, error: rtt / 2 + 1 });
            } catch (error) {
                if (!(error instanceof OperationCancelled)) this.report(error);
            } finally {
                stop();
                await request.close();
            }
        }
        round.scope.signal.throwIfAborted();
        invariant(samples.length > 0, 'TIME_SYNC_FAILED', 'No valid server time samples');
        const selected = samples.sort((a, b) => a.error - b.error)[0];
        const mono = this.clock.monotonicMs();
        const next = selected.utc + mono - selected.mono;
        if (Math.abs(next - this.nowMs()) > 300000) {
            invariant(
                samples.filter(
                    (sample) =>
                        Math.abs(sample.utc + mono - sample.mono - next) <=
                        Math.max(2000, sample.error + selected.error),
                ).length >= 2,
                'TIME_CORRECTION_UNCONFIRMED',
                'Large clock corrections require two consistent samples',
            );
        }
        invariant(
            this.round === round &&
                round.serial === this.syncSerial &&
                round.epoch === this.clock.epoch &&
                !this.clock.background,
            'TIME_SYNC_INVALIDATED',
            'Synchronization round is no longer current',
        );
        validEpoch(Math.floor(next));
        this.anchor = selected;
        this.nextSyncAt = this.refreshAt(selected);
        this.lastEstimate = Math.floor(next);
        this.resumeStale = false;
        if (this.snapshot().quality === 'synced') this.syncFailures = 0;
        this.revision++;
        this.dispatchReason = 'time-adjusted';
        this.changed();
        this.pump();
        return this.snapshot();
    }
    /**
     * 创建固定持有者的时间入口，之后注册计划可省略 Scope。
     * @param scope 订阅和校时等待的期限，例如 show.scope。
     * @returns ScopedTime，不会创建另一套时钟。
     */
    in(scope: Lifetime): ScopedTime {
        return new ScopedTime(this, scope);
    }
    private eligibleNow(): number | null {
        if (this.clock.background || this.closed) return null;
        const state = this.snapshot();
        return this.settings.source && state.quality !== 'synced' ? null : state.nowMs;
    }
    private captureAnchor(): number {
        const now = this.eligibleNow();
        invariant(now !== null, 'TIME_NOT_READY', 'Calendar anchor requires eligible foreground time');
        return now;
    }
    /**
     * 在指定绝对时刻通知一次；已过期时在下一次可用的前台派发中通知。
     * @param epochMs 目标 UTC 毫秒时间戳，不是延迟时长。
     * @param callback 到期处理，可返回 Promise。
     * @param owner 计划期限，结束后取消。
     * @returns 可提前取消的句柄；跨重启恢复由业务保存目标时间。
     */
    at(epochMs: number, callback: CalendarCallback, owner: Lifetime): TimeHandle {
        validEpoch(epochMs);
        return this.plan(owner, callback, false, () => ({ cursor: 0, at: epochMs, key: `at:${epochMs}`, next: null }));
    }
    /**
     * 以登记时的有效业务时间为起点，经过指定日历周期后通知一次。
     * @param period 正整数周期，例如 { unit: "week", count: 1 }；月按日历计算。
     * @param callback 到期回调。
     * @param owner 计划期限。
     * @param input 可覆盖固定时区，省略时继承项目设置。
     * @returns 一次性句柄；反复注册会重新起算，恢复任务应保存 deadline 并使用 at。
     * @throws TIME_NOT_READY：当前业务时间不可用。
     */
    afterPeriod(
        period: CalendarPeriod,
        callback: CalendarCallback,
        owner: Lifetime,
        input: Pick<RepeatOptions, 'offsetMinutes'> = {},
    ): TimeHandle {
        validPeriod(period, true);
        return this.at(
            add(this.captureAnchor(), period, input.offsetMinutes ?? this.settings.calendar?.offsetMinutes),
            callback,
            owner,
        );
    }
    /**
     * 监听进入新的业务日、周、月或年；具体边界采用项目日历规则，可单次覆盖。
     * 后台不执行，恢复时将错过周期合并为最新一次通知；同一订阅不会因时间回拨重复通知旧期次。
     * @param unit day/week/month/year，表示跨周期，而非从现在起等待这么长时间。
     * @param callback 周期通知；异步结果使用 task.commit，业务结算自行持久化去重。
     * @param owner 订阅期限；UI 使用 show.scope，长期账号业务使用账号期限。
     * @param input 可覆盖时区、周起始日、日切点；emitCurrent 默认为 false。
     * @returns 可取消的句柄，进程结束后不会自动恢复。
     * @example
     * app.time.onBoundary('day', onDayChanged, accountScope, { offsetMinutes: 480, resetMinute: 240, emitCurrent: true });
     */
    onBoundary(
        unit: CalendarUnit,
        callback: CalendarCallback,
        owner: Lifetime,
        input: BoundaryOptions = {},
    ): TimeHandle {
        const o = options({ ...this.settings.calendar, ...input });
        validPeriod({ unit, count: 1 });
        return this.plan(
            owner,
            callback,
            input.emitCurrent ?? false,
            (now) => {
                const at = startOf(now, unit, o);
                // Monotonic integer index allows exact missed counts and rollback suppression.
                const p = parts(at, o.offsetMinutes);
                const cursor =
                    unit === 'day'
                        ? Math.floor(at / 86400000)
                        : unit === 'week'
                          ? Math.floor(at / 604800000)
                          : unit === 'month'
                            ? p.year * 12 + p.month
                            : p.year;
                return { cursor, at, key: periodKey(now, unit, o), next: nextBoundary(now, unit, o) };
            },
            true,
        );
    }
    /**
     * 围绕固定 anchorMs 重复计算每一期，适合从开通日期起每月等业务；不是每月 1 日的自然月边界。
     * @param period 正整数周期，例如 { unit: "month", count: 1 }。
     * @param callback 到期回调，同一订阅串行执行。
     * @param owner 计划期限。
     * @param input 起算点、时区及是否通知最近已到期次。
     * @returns 订阅句柄；月末按原锚点计算，1 月 31 日的后续期次不会因 2 月而永久变为 28 日。
     */
    everyPeriod(
        period: CalendarPeriod,
        callback: CalendarCallback,
        owner: Lifetime,
        input: RepeatOptions = {},
    ): TimeHandle {
        validPeriod(period, true);
        const anchor = validEpoch(input.anchorMs ?? this.captureAnchor());
        const offset = options({ ...this.settings.calendar, ...input }).offsetMinutes;
        const origin = parts(anchor, offset);
        return this.plan(
            owner,
            callback,
            input.emitLatestOnStart ?? false,
            (now) => {
                const p = parts(now, offset);
                const elapsed =
                    period.unit === 'month'
                        ? (p.year - origin.year) * 12 + p.month - origin.month
                        : period.unit === 'year'
                          ? p.year - origin.year
                          : (now - anchor) / (period.unit === 'week' ? 604800000 : 86400000);
                let index = Math.max(0, Math.floor(elapsed / period.count));
                const occurrence = (n: number) => add(anchor, { unit: period.unit, count: period.count * n }, offset);
                if (index > 0 && occurrence(index) > now) index--;
                const at = index > 0 ? occurrence(index) : occurrence(1);
                return {
                    cursor: index,
                    at,
                    key: `period:${anchor}:${period.unit}:${period.count}:o${offset}:n${index}`,
                    next: occurrence(index + 1),
                };
            },
            true,
            true,
        );
    }
    private plan(
        owner: Lifetime,
        callback: CalendarCallback,
        initial: boolean,
        candidate: Plan['candidate'],
        repeating = false,
        anchored = false,
    ): TimeHandle {
        owner.signal.throwIfAborted();
        this.scope.signal.throwIfAborted();
        const scope = owner.child('calendar');
        const plan: Plan = {
            scope,
            callback,
            active: true,
            busy: false,
            next: null,
            cursor: null,
            initialized: !repeating,
            initial,
            anchored,
            candidate,
        };
        this.plans.add(plan);
        scope.signal.onAbort(() => {
            plan.active = false;
            this.plans.delete(plan);
            this.scheduleWake();
        });
        const now = this.eligibleNow();
        if (now !== null) this.initialize(plan, now);
        void Promise.resolve()
            .then(() => this.pump())
            .catch(this.report);
        return Object.freeze({
            get active() {
                return plan.active;
            },
            get nextAtMs() {
                return plan.active ? plan.next : null;
            },
            cancel: () => this.cancelPlan(plan),
        });
    }
    private initialize(plan: Plan, now: number): void {
        const candidate = plan.candidate(now);
        if (!plan.initialized) {
            plan.initialized = true;
            if (!plan.initial || (plan.anchored && candidate.cursor === 0)) plan.cursor = candidate.cursor;
            plan.next = plan.cursor !== null && plan.cursor >= candidate.cursor ? candidate.next : candidate.at;
        } else if (plan.next === null && plan.cursor === null) plan.next = candidate.at;
    }
    private cancelPlan(plan: Plan): void {
        if (!plan.active && plan.scope.signal.aborted) return;
        plan.active = false;
        this.plans.delete(plan);
        void plan.scope.close().catch(this.report);
    }
    private pump(): void {
        this.stopWake();
        if (this.closed) return;
        this.synchronizeIfDue();
        const state = this.snapshot();
        const nowDevice = this.clock.deviceNowMs(),
            mono = this.clock.monotonicMs();
        const signature = `${state.source}:${state.quality}:${state.revision}`;
        if (
            signature !== this.quality ||
            (!this.anchor && Math.abs(nowDevice - this.lastDevice - (mono - this.lastMono)) > 2000)
        ) {
            this.quality = signature;
            this.changed();
        }
        this.lastDevice = nowDevice;
        this.lastMono = mono;
        const now = this.eligibleNow();
        if (now !== null)
            for (const plan of Array.from(this.plans)) {
                if (!plan.active || plan.busy || plan.scope.signal.aborted) continue;
                try {
                    this.initialize(plan, now);
                    const occurrence = plan.candidate(now);
                    if (occurrence.at > now || (plan.cursor !== null && occurrence.cursor <= plan.cursor)) {
                        plan.next = occurrence.next ?? occurrence.at;
                        continue;
                    }
                    const previous = plan.cursor;
                    plan.cursor = occurrence.cursor;
                    plan.next = occurrence.next;
                    plan.busy = true;
                    const event: CalendarEvent = Object.freeze({
                        occurrenceKey: occurrence.key,
                        scheduledAtMs: occurrence.at,
                        observedAtMs: now,
                        reason: previous === null && plan.initial ? 'initial' : this.dispatchReason,
                        missedCount: previous === null ? null : Math.max(0, occurrence.cursor - previous - 1),
                    });
                    void runTask(plan.scope, (task) => plan.callback(event, task)).then(
                        () => {
                            plan.busy = false;
                            if (occurrence.next === null) this.cancelPlan(plan);
                            this.pump();
                        },
                        (error) => {
                            plan.busy = false;
                            this.cancelPlan(plan);
                            if (!(error instanceof OperationCancelled)) this.report(error);
                            this.pump();
                        },
                    );
                } catch (error) {
                    this.cancelPlan(plan);
                    this.report(error);
                }
            }
        this.dispatchReason = 'due';
        this.scheduleWake();
    }
    private scheduleWake(): void {
        this.stopWake();
        if (this.closed || this.clock.background) return;
        const now = this.eligibleNow();
        let wait = 60000;
        if (this.autoSync && !this.autoSyncPending && !this.round)
            wait = Math.min(wait, Math.max(1, this.nextSyncAt - this.clock.monotonicMs()));
        if (now !== null)
            for (const plan of this.plans)
                if (!plan.busy && plan.next !== null) wait = Math.min(wait, Math.max(1, plan.next - now));
        this.stopWake = this.clock.wake(() => this.pump(), wait);
    }
    private refreshAt(anchor: Anchor): number {
        const ageLimit = this.settings.maxAgeMs ?? 300000;
        const errorLimit = Math.max(1, ((this.settings.maxErrorMs ?? 5000) - anchor.error) / 0.00005);
        return (
            anchor.mono + Math.max(1, Math.min(this.autoSync?.intervalMs ?? Infinity, ageLimit * 0.8, errorLimit * 0.8))
        );
    }
    private synchronizeIfDue(): void {
        const auto = this.autoSync;
        if (
            !auto ||
            this.autoSyncPending ||
            this.round ||
            this.clock.background ||
            this.clock.monotonicMs() < this.nextSyncAt
        )
            return;
        this.autoSyncPending = true;
        void this.sync(this.scope)
            .then((state) => {
                invariant(
                    state.quality === 'synced',
                    'TIME_NOT_SYNCED',
                    'Automatic synchronization did not reach the required quality',
                );
            })
            .catch((error) => {
                if (error instanceof OperationCancelled || this.closed || this.clock.background) return;
                this.nextSyncAt =
                    this.clock.monotonicMs() +
                    Math.min(auto.maxRetryDelayMs, auto.retryDelayMs * 2 ** Math.min(this.syncFailures++, 20));
                this.report(error);
            })
            .finally(() => {
                this.autoSyncPending = false;
                this.pump();
            });
    }
    private changed(): void {
        if (this.queuedChange || this.closed) return;
        this.queuedChange = true;
        void Promise.resolve()
            .then(() => {
                this.queuedChange = false;
                if (this.closed) return;
                const value = this.snapshot();
                for (const item of Array.from(this.listeners))
                    if (!item.scope.signal.aborted)
                        try {
                            item.callback(value);
                        } catch (error) {
                            this.report(error);
                        }
            })
            .catch(this.report);
    }
}

/**
 * 绑定固定 Scope 的时间入口，通常由 show.time、activation.time、ctx.time 提供；不创建新时钟。
 * 订阅跟随该期限取消，读取时间与纯日期工具本身不承担资源持有。
 */
export class ScopedTime {
    /**
     * @internal
     * 使用 TimeService.in(scope) 创建固定持有者入口。
     * @param service 所属的应用时间服务。
     * @param owner 订阅和校时等待的期限。
     */
    constructor(
        private readonly service: TimeService,
        private readonly owner: Lifetime,
    ) {}
    /**
     * 继承项目日历设置的日期工具；format、dayKey 等与周期订阅使用同一默认偏移，可显式覆盖。
     * @example
     * const text = show.time.calendar.format(show.time.nowMs(), "datetime", 480);
     */
    get calendar() {
        return this.service.calendar;
    }
    /**
     * 获取当前估计 UTC 毫秒时间戳，不联网；严格服务器时间请使用 requireNowMs。
     */
    nowMs(): number {
        return this.service.nowMs();
    }
    /**
     * 获取向下取整的 Unix 秒时间戳；与 nowMs 的单位不同。
     */
    nowSeconds(): number {
        return this.service.nowSeconds();
    }
    /**
     * 返回当前估计时间的新 Date 对象；不携带项目时区，修改它不影响框架。
     */
    nowDate(): Date {
        return this.service.nowDate();
    }
    /**
     * 读取时间来源、质量与误差快照，不会发起校时请求。
     */
    snapshot(): TimeSnapshot {
        return this.service.snapshot();
    }
    /**
     * 要求可信服务器时间。
     * @param policy 可额外收紧年龄和误差阈值，单位毫秒。
     * @returns UTC 毫秒时间戳；质量不满足时抛出 TIME_NOT_SYNCED。
     */
    requireNowMs(policy?: TimePolicy): number {
        return this.service.requireNowMs(policy);
    }
    /**
     * 计算非负剩余毫秒数，过期返回 0。
     * @param deadline 截止时刻的 UTC 毫秒时间戳。
     */
    remainingMs(deadline: number): number {
        return this.service.remainingMs(deadline);
    }
    /**
     * 发起或加入共享校时轮次；当前持有者结束时取消本次等待。
     * @returns 校时后的快照；需要项目注入 ServerTimeSource，后台不可发起。
     */
    sync(): Promise<TimeSnapshot> {
        return this.service.sync(this.owner);
    }
    /**
     * 监听校时和质量变化，随当前持有者取消；不是每秒通知。
     * @param callback 同步处理时间快照。
     * @returns 可提前解绑的函数。
     */
    onChanged(callback: (value: TimeSnapshot) => void): () => void {
        return this.service.onChanged(callback, this.owner);
    }
    /**
     * 指定绝对时刻的一次通知，随当前 Scope 取消。
     * @param epoch 目标 UTC 毫秒时间戳；已过期时在下一次可用派发中通知。
     * @param callback 到期处理，可返回 Promise。
     * @returns 可取消句柄。
     */
    at(epoch: number, callback: CalendarCallback): TimeHandle {
        return this.service.at(epoch, callback, this.owner);
    }
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
    onBoundary(unit: CalendarUnit, callback: CalendarCallback, input?: BoundaryOptions): TimeHandle {
        return this.service.onBoundary(unit, callback, this.owner, input);
    }
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
    ): TimeHandle {
        return this.service.afterPeriod(period, callback, this.owner, input);
    }
    /**
     * 按固定起算点重复通知，自动跟随当前 Scope；错过多期时合并通知最新一期。
     * @param period 正整数日历周期。
     * @param callback 同一订阅内串行执行的回调。
     * @param input anchorMs 为 UTC 毫秒，省略时从当前有效时间起算；恢复时复用已保存的 anchorMs。
     * @returns 可取消句柄。
     */
    everyPeriod(period: CalendarPeriod, callback: CalendarCallback, input?: RepeatOptions): TimeHandle {
        return this.service.everyPeriod(period, callback, this.owner, input);
    }
}
