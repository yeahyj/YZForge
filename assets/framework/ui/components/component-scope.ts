import { Component, isValid } from 'cc';
import type { ScopedAssets } from '../../assets/asset-manager';
import { registerComponentBinding, type ComponentBinding } from '../../core/component-binding';
import { FrameworkError, invariant, reportError } from '../../core/errors';
import type { ModuleContext } from '../../modules/module-manager';
import { Scope, type Lifetime } from '../../core/scope';
import type { ScopedTime, TimeService } from '../../time/time-service';

/** @internal 原生 UI 扩展的一次启用期；资源和框架时间由现有实例绑定流程注入。 */
export interface ComponentContext {
    readonly scope: Lifetime;
    readonly assets?: ScopedAssets;
    readonly time?: ScopedTime;
}

/**
 * @internal 非 Cocos 组件的生命周期助手。独立节点直接启用；框架节点服从显示期限。
 * 禁用同步取消，复用等待物理任务与异步清理，只有最后一次绑定可以回写。
 */
export class ComponentScope implements ComponentBinding {
    context?: ComponentContext;
    binding?: Scope;
    private readonly bindings = new Set<Scope>();
    private instance?: Scope;
    private module?: ModuleContext;
    private time?: TimeService;
    private owner?: Scope;
    private activation?: Scope;
    private draining?: Promise<void>;
    private enabled = false;
    private disposed = false;

    constructor(
        private readonly component: Component,
        private readonly automatic: (context: ComponentContext) => void,
    ) {
        registerComponentBinding(component, this);
    }

    __bind(context: ModuleContext, instance: Scope, time: TimeService): void {
        invariant(!this.instance, 'COMPONENT_ALREADY_BOUND', this.component.name);
        this.instance = instance;
        this.module = context;
        this.time = time;
        void this.__deactivate().catch(reportError);
        instance.signal.onAbort(() => this.__allow(undefined));
        instance.defer(() => this.__deactivate());
    }

    __allow(owner: Scope | undefined): void {
        this.owner = owner;
        if (!owner) void this.__deactivate().catch(reportError);
        else this.activate();
    }

    enable(): void {
        this.enabled = true;
        this.activate();
    }

    disable(): void {
        this.enabled = false;
        void this.__deactivate().catch(reportError);
    }

    destroy(): void {
        this.disposed = true;
        this.disable();
    }

    private activate(): void {
        if (
            this.context ||
            this.draining ||
            this.disposed ||
            !this.enabled ||
            !this.component.enabledInHierarchy ||
            (this.instance && (!this.owner || this.owner.signal.aborted || this.instance.signal.aborted))
        )
            return;
        const scope = this.owner?.child('native-ui') ?? new Scope('native-ui');
        this.activation = scope;
        this.context = Object.freeze({
            scope: scope.lifetime,
            assets: this.module?.assets.in(scope.lifetime),
            time: this.time?.in(scope),
        });
        scope.signal.onAbort(() => {
            void this.__deactivate().catch(reportError);
        });
        try {
            if (!this.binding || this.binding.signal.aborted) this.automatic(this.context);
        } catch (error) {
            this.enabled = false;
            void this.__deactivate().catch(reportError);
            throw error;
        }
    }

    requireContext(): ComponentContext {
        invariant(this.context && !this.context.scope.signal.aborted, 'UI_COMPONENT_INACTIVE', '请在组件启用后调用');
        return this.context;
    }

    begin(owner: Lifetime, label: string, reset: () => void): Scope {
        owner.signal.throwIfAborted();
        invariant(isValid(this.component, true) && !this.disposed, 'UI_COMPONENT_DESTROYED', '组件已销毁');
        invariant(!this.draining, 'UI_COMPONENT_DRAINING', '组件仍在等待上次停用清理，请在重新启用完成后绑定');
        void this.clear().catch(reportError);
        const scope = owner.child(label);
        this.binding = scope;
        this.bindings.add(scope);
        scope.defer(() => {
            this.bindings.delete(scope);
        });
        scope.signal.onAbort(() => {
            try {
                if (this.binding === scope) reset();
            } finally {
                void scope.close().catch(reportError);
            }
        });
        return scope;
    }

    current(scope: Scope): boolean {
        return this.binding === scope && !scope.signal.aborted && isValid(this.component, true);
    }

    clear(): Promise<void> {
        return this.binding?.close() ?? Promise.resolve();
    }

    __deactivate(): Promise<void> {
        if (this.draining) return this.draining;
        const scopes = new Set(this.bindings);
        if (this.activation) scopes.add(this.activation);
        if (!scopes.size) return Promise.resolve();
        this.context = undefined;
        this.activation = undefined;
        this.draining = Promise.resolve().then(async () => {
            const results = await Promise.allSettled(Array.from(scopes, (scope) => scope.close()));
            const failures = results.filter((result) => result.status === 'rejected');
            this.draining = undefined;
            if (failures.length) {
                this.enabled = false;
                throw new FrameworkError('UI_COMPONENT_CLEANUP', '显示组件清理失败', { failures });
            }
            this.activate();
        });
        for (const scope of scopes) scope.cancel();
        return this.draining;
    }
}
