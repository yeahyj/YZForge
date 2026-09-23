import { _decorator, isValid } from 'cc';
import { FrameworkError, invariant, reportError } from '../../core/errors';
import { GameComponent, type ActivationContext } from '../../core/game-component';
import type { Lifetime, Scope } from '../../core/scope';

/** @internal 通用显示组件的一次绑定；复用时同步取消，旧任务由原 Scope 继续排空。 */
@_decorator.ccclass('yzforge.ScopedComponent')
export class ScopedComponent extends GameComponent {
    protected bindingScope?: Scope;
    protected activationContext?: ActivationContext;
    private activationBindings?: Set<Scope>;
    /** @internal 普通用法自动借用框架激活期；已有显式绑定时保留调用方配置。 */
    protected onActivate(activation: ActivationContext): void {
        this.activationContext = activation;
        const bindings = (this.activationBindings = new Set<Scope>());
        if (this.bindingScope && !this.bindingScope.closed) bindings.add(this.bindingScope);
        activation.scope.defer(async () => {
            const results = await Promise.allSettled(Array.from(bindings, (scope) => scope.close()));
            const failures = results.filter((result) => result.status === 'rejected');
            if (failures.length) throw new FrameworkError('UI_COMPONENT_CLEANUP', '显示组件清理失败', { failures });
        });
        if (!this.bindingScope || this.bindingScope.signal.aborted) this.onAutomaticActivate(activation);
    }
    /** @internal 子组件根据 Inspector 配置接入激活期，不向使用方暴露 Scope。 */
    protected onAutomaticActivate(_activation: ActivationContext): void {}
    protected requireActivation(): ActivationContext {
        invariant(
            this.activationContext && !this.activationContext.signal.aborted,
            'UI_COMPONENT_INACTIVE',
            '请在框架 UI / Part 激活后调用',
        );
        return this.activationContext;
    }
    protected beginBinding(owner: Lifetime, label: string, reset: () => void): Scope {
        owner.signal.throwIfAborted();
        invariant(isValid(this, true), 'UI_COMPONENT_DESTROYED', '组件已销毁');
        void this.clear().catch(reportError);
        const scope = owner.child(label);
        this.bindingScope = scope;
        const bindings = this.activationBindings;
        bindings?.add(scope);
        scope.defer(() => {
            bindings?.delete(scope);
        });
        scope.signal.onAbort(() => {
            try {
                if (this.bindingScope === scope) reset();
            } finally {
                void scope.close().catch(reportError);
            }
        });
        return scope;
    }
    protected current(scope: Scope): boolean {
        return this.bindingScope === scope && !scope.signal.aborted && isValid(this, true);
    }
    /** 取消当前绑定并等待任务及资源归还；重复调用安全，旧句柄应调用自身的 dispose。 */
    clear(): Promise<void> {
        return this.bindingScope?.close() ?? Promise.resolve();
    }
    /** @internal 禁用取消绑定；配置型组件在下一次激活时自动恢复。 */
    protected onDeactivate(): void {
        this.activationContext = undefined;
        this.activationBindings = undefined;
        void this.clear().catch(reportError);
    }
    /** @internal 销毁结束绑定。 */
    protected onDispose(): void {
        void this.clear().catch(reportError);
    }
}
