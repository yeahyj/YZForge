import { Component, isValid } from 'cc';
import type { AssetAccess } from '../assets/asset-access';
import { registerComponentBinding, type ComponentBinding } from './component-binding';
import { FrameworkError, invariant, OperationCancelled, reportError } from '../core/errors';
import { untilCancelled } from '../core/cancellation';
import type { ComponentServicesHost } from './component-services';
import { Scope, type Lifetime } from '../core/scope';
import type { TimeAccess } from '../time/time-access';
import type { LocalizationAccess } from '../ui/localization/localization-access';

/** @internal 原生 UI 扩展的一次启用期；资源和框架时间由现有实例绑定流程注入。 */
export interface ComponentContext {
    readonly scope: Lifetime;
    readonly assets?: AssetAccess;
    readonly time?: TimeAccess;
    readonly i18n?: LocalizationAccess;
}

/**
 * @internal 非 Cocos 组件的生命周期助手。独立节点直接启用；框架节点服从显示期限。
 * 禁用同步取消，复用等待物理任务与异步清理，只有最后一次绑定可以回写。
 */
export class ComponentScope implements ComponentBinding {
    /** 是否已接入框架宿主；独立原生组件的本地功能不要求宿主。 */
    get bound(): boolean {
        return !!this.instance;
    }
    context?: ComponentContext;
    binding?: Scope;
    private readonly bindings = new Set<Scope>();
    private instance?: Scope;
    private module?: ComponentServicesHost;
    private owner?: Scope;
    private activation?: Scope;
    private draining?: Promise<void>;
    private preparation?: { scope: Scope; done: Promise<void> };
    private enabled = false;
    private disposed = false;

    constructor(
        private readonly component: Component,
        private readonly automatic: (context: ComponentContext) => void | Promise<void>,
    ) {
        registerComponentBinding(component, this);
    }

    __bind(context: ComponentServicesHost, instance: Scope): void {
        invariant(!this.instance, 'COMPONENT_ALREADY_BOUND', this.component.name);
        this.instance = instance;
        this.module = context;
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

    /** 只等待自动绑定的首份显示内容；停用或复用时重新核对当前启用期。 */
    async __ready(): Promise<void> {
        for (;;) {
            if (this.draining) await this.draining;
            this.owner?.signal.throwIfAborted();
            this.activate();
            const pending = this.preparation;
            if (!pending) return;
            try {
                await untilCancelled(pending.done, pending.scope.signal);
            } catch (error) {
                if (
                    !(error instanceof OperationCancelled) ||
                    !pending.scope.signal.aborted ||
                    this.owner?.signal.aborted
                )
                    throw error;
            }
            if (this.preparation === pending || this.disposed || !this.enabled || !this.component.enabledInHierarchy)
                return;
        }
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
            ...this.module?.componentServices(scope, () => this.activation === scope),
        });
        scope.signal.onAbort(() => {
            void this.__deactivate().catch(reportError);
        });
        try {
            if (!this.binding || this.binding.signal.aborted) {
                const done = this.automatic(this.context);
                if (done) {
                    this.preparation = { scope, done };
                    void done.catch((error) => {
                        if (!(error instanceof OperationCancelled)) reportError(error);
                    });
                }
            }
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
        this.preparation = undefined;
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
