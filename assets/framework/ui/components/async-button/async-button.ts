import { _decorator, Button, isValid, Node } from 'cc';
import { type ErrorReporter, invariant, OperationCancelled, reportError } from '../../../core/errors';
import type { Lifetime, TaskContext } from '../../../core/scope';
import type { ActivationContext } from '../../../core/game-component';
import { ScopedComponent } from '../scoped-component';
import { AsyncButtonController } from './async-button-controller';
const { ccclass, property, requireComponent, disallowMultiple, menu } = _decorator;

/** 一次按钮绑定；dispose 仅结束该次绑定，不影响同一组件后来建立的绑定。 */
export interface AsyncButtonHandle {
    /** 程序触发；忙碌或不可交互时返回 false，业务错误拒绝 Promise。 */
    press(): Promise<boolean>;
    /** 修改空闲时能否点击；忙碌期间仍保持禁用。 */
    setInteractable(value: boolean): void;
    /** 立即解绑和恢复按钮，等待本次操作清理；不要在操作内部 await 自己的 dispose。 */
    dispose(): Promise<void>;
}
/** 异步按钮：组合原生 Button，复用 Actions 防连点，绑定结束时同步取消工作。 */
@ccclass('yzforge.AsyncButton')
@menu('YZForge/UI/异步按钮')
@requireComponent(Button)
@disallowMultiple
export class AsyncButton extends ScopedComponent {
    /** 挂上即可防连点，普通点击仍使用 Button.clickEvents；显式 bind 会接管此模式。 */
    @property({ displayName: '自动防连点' }) autoGuard = true;
    /** 普通点击后禁用的秒数；等待真实异步任务使用 run，无需传 Scope。 */
    @property({ displayName: '点击间隔（秒）', min: 0 }) clickInterval = 0.3;
    /** 可选忙碌提示子节点；样式由业务预制体提供，不能引用自身或祖先。 */
    @property({ type: Node, displayName: '忙碌提示节点' }) busyVisual: Node | null = null;
    private runningConvenience = false;
    protected onAutomaticActivate(activation: ActivationContext): void {
        if (!this.autoGuard) return;
        invariant(
            Number.isFinite(this.clickInterval) && this.clickInterval >= 0,
            'ASYNC_BUTTON_INTERVAL',
            '点击间隔须为非负秒数',
        );
        this.bind(
            activation.scope,
            (task) =>
                new Promise<void>((resolve) => {
                    const timer = setTimeout(() => {
                        off();
                        resolve();
                    }, this.clickInterval * 1000);
                    const off = task.signal.onAbort(() => {
                        clearTimeout(timer);
                        resolve();
                    });
                }),
        );
    }
    /**
     * 直接执行异步点击业务，无需 bind/Scope；忙碌或未激活时返回 false，结束后自动恢复防连点。
     * 可在 Button.clickEvents 或 show.listen 回调中调用；await 后用 task.commit 写界面。
     * @param work 本次任务，取消时响应 task.signal。
     */
    async run(work: (task: TaskContext) => void | Promise<void>): Promise<boolean> {
        const activation = this.activationContext;
        if (!activation || activation.signal.aborted || !this.enabledInHierarchy || this.runningConvenience)
            return false;
        this.runningConvenience = true;
        let handle: AsyncButtonHandle | undefined;
        let scope = this.bindingScope;
        try {
            handle = this.bind(activation.scope, work);
            scope = this.bindingScope;
            return await handle.press();
        } finally {
            try {
                await handle?.dispose();
            } finally {
                this.runningConvenience = false;
                if (
                    handle &&
                    this.bindingScope === scope &&
                    this.activationContext === activation &&
                    !activation.signal.aborted
                )
                    this.onAutomaticActivate(activation);
            }
        }
    }

    /**
     * 绑定点击操作，可用于 show.scope、activation.scope 或 item.scope；重新绑定取消旧工作。
     * 组件拥有 Button.interactable，业务通过句柄修改。异步回写使用 task.commit。
     * @param owner 此次显示期限。
     * @param work 单次业务操作；没有自动重试，取消不能撤销已经提交的服务端写入。
     * @param onError 真实点击发生非取消错误时同步上报；程序 press 的错误由调用方处理。
     */
    bind(
        owner: Lifetime,
        work: (task: TaskContext) => void | Promise<void>,
        onError: ErrorReporter = reportError,
    ): AsyncButtonHandle {
        owner.signal.throwIfAborted();
        invariant(
            !this.busyVisual || (this.busyVisual !== this.node && this.busyVisual.isChildOf(this.node)),
            'ASYNC_BUTTON_SETUP',
            '忙碌提示必须是子节点',
        );
        void this.clear().catch(reportError);
        const button = this.getComponent(Button)!;
        const node = this.node;
        const original = button.interactable,
            visual = this.busyVisual;
        const originalVisible = visual?.active ?? false;
        let enabled = original,
            busy = false;
        const scope = this.beginBinding(owner, 'async-button', () => {
            node.off(Button.EventType.CLICK, clicked);
            if (isValid(button, true)) button.interactable = original;
            if (isValid(visual, true)) visual!.active = originalVisible;
        });
        const render = () => {
            if (!this.current(scope)) return;
            button.interactable = enabled && !busy;
            if (isValid(visual, true)) visual!.active = busy;
        };
        const controller = new AsyncButtonController(scope, work, (value) => {
            busy = value;
            render();
        });
        const press = () => {
            scope.signal.throwIfAborted();
            return this.enabledInHierarchy && button.interactable ? controller.press() : Promise.resolve(false);
        };
        const clicked = () => {
            if (scope.signal.aborted) return;
            void press().catch((error: unknown) => {
                if (!(error instanceof OperationCancelled)) onError(error);
            });
        };
        button.node.on(Button.EventType.CLICK, clicked);
        render();
        return Object.freeze({
            press,
            setInteractable: (value: boolean) => {
                scope.signal.throwIfAborted();
                enabled = value;
                render();
            },
            dispose: () => scope.close(),
        });
    }
}
