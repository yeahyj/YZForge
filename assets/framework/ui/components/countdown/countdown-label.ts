import { _decorator, Component, game, Game, Label } from 'cc';
import type { ActivationContext } from '../../../core/game-component';
import { type ErrorReporter, OperationCancelled, reportError } from '../../../core/errors';
import { type Lifetime, type TaskContext, runTask } from '../../../core/scope';
import type { ScopedTime } from '../../../time/time-service';
import { ScopedComponent } from '../scoped-component';
import { countdownSeconds, formatCountdown } from './countdown';
const { ccclass, property, requireComponent, disallowMultiple, menu } = _decorator;
/** 倒计时配置；更换截止时间请重新 bind，每次绑定只通知一次完成。 */
export interface CountdownOptions {
    /** 截止 UTC 毫秒时间戳。 */ readonly deadlineMs: number;
    /** 同步格式化非负剩余秒数，默认 HH:mm:ss。 */ readonly format?: (seconds: number) => string;
    /** 到期回调，登记到绑定 Scope；不能在内部等待自己的 dispose。 */ readonly onComplete?: (
        task: TaskContext,
    ) => void | Promise<void>;
    /** 格式化或完成回调错误的同步上报器。 */ readonly onError?: ErrorReporter;
}
/** 一次倒计时绑定；更换截止时间重新 bind，旧句柄不会影响新绑定。 */
export interface CountdownHandle {
    /** 立即读取时间并刷新；本次已经完成或取消时无操作。 */
    refresh(): void;
    /** 取消订阅和完成任务，等待异步清理；保留最后显示的文字。 */
    dispose(): Promise<void>;
}
/** 倒计时显示：校时或恢复前台后重新读时间；时间源是否可信由现有 TimeService 决定。 */
@ccclass('yzforge.CountdownLabel')
@menu('YZForge/UI/倒计时文本')
@requireComponent(Label)
@disallowMultiple
export class CountdownLabel extends ScopedComponent {
    /** 每次节点业务激活时按配置启动；手动调用 restart 也可启动。 */
    @property({ displayName: '启用后自动开始' }) autoStart = true;
    /** 编辑器默认计时时长，秒。 */
    @property({ displayName: '倒计时长（秒）', min: 0 }) duration = 60;
    /** 支持 {hh}/{mm}/{ss}/{seconds}；mm 为小时内分钟，seconds 为剩余总秒数。 */
    @property({ displayName: '显示格式', tooltip: '例如 {mm}:{ss} 或 剩余 {seconds} 秒' }) textFormat =
        '{hh}:{mm}:{ss}';
    /** 编辑器完成事件；每次计时只触发一次，遵循 Cocos 同步事件约定。 */
    @property({ type: [Component.EventHandler], displayName: '计时完成事件' }) completedEvents: InstanceType<
        typeof Component.EventHandler
    >[] = [];
    private refreshCurrent?: () => void;
    protected onAutomaticActivate(_activation: ActivationContext): void {
        if (this.autoStart) this.restart();
    }
    /** 使用 Inspector 中的时长重新开始，可直接连接 Button.clickEvents。 */
    restart(): void {
        this.startFor(this.duration);
    }
    /** 从指定秒数开始，无需传 Scope 或时间服务。 */
    startFor(seconds: number): void {
        const activation = this.requireActivation();
        if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('倒计时长须为非负秒数');
        this.startUntil(activation.time.nowMs() + seconds * 1000);
    }
    /** 从绝对 UTC 毫秒截止时刻开始；服务端活动计时通常调用这一方法。 */
    startUntil(deadlineMs: number): void {
        const activation = this.requireActivation(),
            template = this.textFormat;
        this.bind(activation.scope, activation.time, {
            deadlineMs,
            format: (seconds) => {
                const [hh, mm, ss] = formatCountdown(seconds).split(':');
                return template.replace(
                    /\{(hh|mm|ss|seconds)\}/g,
                    (_, key: string) => ({ hh, mm, ss, seconds: String(seconds) })[key as 'hh'],
                );
            },
            onComplete: () => Component.EventHandler.emitEvents(this.completedEvents, this),
        });
    }
    /** 停止并保留当前文字，可直接连接 Button.clickEvents。 */
    stop(): void {
        void this.clear().catch(reportError);
    }
    /**
     * 绑定绝对截止时刻；已到期立即显示 0 并调度一次完成回调，不负责发奖或持久化。
     * @param owner 此次显示期限，结束时同步退订并取消完成任务。
     * @param time 现有 show.time 或 activation.time；不另建时钟。
     * @param options 截止时刻、同步格式化和一次完成通知。
     * @throws COUNTDOWN_TIME_INVALID 截止时间或当前时间无效。
     */
    bind(owner: Lifetime, time: ScopedTime, options: CountdownOptions): CountdownHandle {
        options = { ...options };
        countdownSeconds(options.deadlineMs, time.nowMs());
        const label = this.getComponent(Label)!,
            report = options.onError ?? reportError;
        let off = () => {},
            ended = false,
            last = -1;
        const scope = this.beginBinding(owner, 'countdown', () => {
            off();
            game.off(Game.EVENT_SHOW, refresh);
            this.refreshCurrent = undefined;
        });
        const refresh = () => {
            if (!this.current(scope) || ended) return;
            try {
                const seconds = countdownSeconds(options.deadlineMs, time.nowMs());
                if (seconds !== last) {
                    const text = (options.format ?? formatCountdown)(seconds);
                    if (!this.current(scope)) return;
                    label.string = text;
                    last = seconds;
                }
                if (seconds === 0) {
                    ended = true;
                    off();
                    game.off(Game.EVENT_SHOW, refresh);
                    if (options.onComplete)
                        void runTask(scope, options.onComplete).catch((error: unknown) => {
                            if (!(error instanceof OperationCancelled)) report(error);
                        });
                }
            } catch (error) {
                ended = true;
                void scope.close().catch(report);
                report(error);
            }
        };
        this.refreshCurrent = refresh;
        off = time.onChanged(refresh);
        game.on(Game.EVENT_SHOW, refresh);
        refresh();
        return Object.freeze({ refresh, dispose: () => scope.close() });
    }
    /** @internal 每帧读取框架时间，仅剩余秒数变化时写 Label；不使用 dt 累加。 */
    protected onTick(): void {
        this.refreshCurrent?.();
    }
}
