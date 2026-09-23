import { _decorator, Component, game, Game, Label } from 'cc';
import { EDITOR } from 'cc/env';
import { type ErrorReporter, OperationCancelled, reportError } from '../../../core/errors';
import { type Lifetime, type TaskContext, runTask } from '../../../core/scope';
import type { ScopedTime } from '../../../time/time-service';
import { ComponentScope } from '../component-scope';
import { countdownSeconds, formatCountdown } from './countdown';
const { ccclass, property, disallowMultiple, menu } = _decorator;
/** 倒计时需要的最小时间接口；不传时独立节点使用 Date.now，框架节点自动使用校时服务。 */
export type CountdownTime = Pick<ScopedTime, 'nowMs' | 'onChanged'>;
const deviceTime: CountdownTime = { nowMs: () => Date.now(), onChanged: () => () => {} };
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
/** 原生 Label 的扩展；字体、颜色、对齐等直接配置在本组件，独立节点也能 startFor。 */
@ccclass('yzforge.CountdownLabel')
@menu('YZForge/UI/倒计时文本')
@disallowMultiple
export class CountdownLabel extends Label {
    private readonly lifetime = new ComponentScope(this, () => {
        if (this.autoStart) this.restart();
    });
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
    /** 使用 Inspector 中的时长重新开始，可直接连接 Button.clickEvents。 */
    restart(): void {
        this.startFor(this.duration);
    }
    /** 从指定秒数开始，无需传 Scope 或时间服务。 */
    startFor(seconds: number): void {
        const activation = this.lifetime.requireContext();
        if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('倒计时长须为非负秒数');
        this.startUntil((activation.time ?? deviceTime).nowMs() + seconds * 1000);
    }
    /** 从绝对 UTC 毫秒截止时刻开始；服务端活动计时通常调用这一方法。 */
    startUntil(deadlineMs: number): void {
        const activation = this.lifetime.requireContext(),
            template = this.textFormat;
        this.bind(activation.scope, activation.time ?? deviceTime, {
            deadlineMs,
            format: (seconds) => {
                const [hh, mm, ss] = formatCountdown(seconds).split(':');
                const tokens: Record<string, string> = { hh, mm, ss, seconds: String(seconds) };
                return template.replace(/\{(hh|mm|ss|seconds)\}/g, (_, key: string) => tokens[key]);
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
    bind(owner: Lifetime, time: CountdownTime, options: CountdownOptions): CountdownHandle {
        options = { ...options };
        countdownSeconds(options.deadlineMs, time.nowMs());
        const report = options.onError ?? reportError;
        let off = () => {},
            ended = false,
            last = -1;
        const scope = this.lifetime.begin(owner, 'countdown', () => {
            off();
            game.off(Game.EVENT_SHOW, refresh);
            this.refreshCurrent = undefined;
        });
        const refresh = () => {
            if (!this.lifetime.current(scope) || ended) return;
            try {
                const seconds = countdownSeconds(options.deadlineMs, time.nowMs());
                if (seconds !== last) {
                    const text = (options.format ?? formatCountdown)(seconds);
                    if (!this.lifetime.current(scope)) return;
                    this.string = text;
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
    update(): void {
        this.refreshCurrent?.();
    }
    /** 停止当前计时，等待完成任务退出，保留最后文字。 */
    clear(): Promise<void> {
        return this.lifetime.clear();
    }
    /** @internal 保留 Label 的渲染、字体加载和材质行为。 */
    onEnable(): void {
        super.onEnable();
        if (!EDITOR) this.lifetime.enable();
    }
    /** @internal 禁用时移除时间和前台事件订阅。 */
    onDisable(): void {
        this.lifetime.disable();
        super.onDisable();
    }
    /** @internal 关闭完成回调的使用期限。 */
    onDestroy(): void {
        this.lifetime.destroy();
        super.onDestroy();
    }
}
