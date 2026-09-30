import { Component, isValid, Node } from 'cc';
import type { ModuleContext } from '../modules/module-manager';
import type { Scope } from '../core/scope';
import { runTask, scopeOwner, type Lifetime } from '../core/scope';
import { untilCancelled } from '../core/cancellation';
import { invariant } from '../core/errors';

/** @internal 原生组件扩展接入 UI、Part 和列表复用的生命周期，不需要再挂一个脚本。 */
export interface ComponentBinding {
    /** 注入实例所属模块。 */
    __bind(context: ModuleContext, instance: Scope): void;
    /** 允许本次显示工作，undefined 表示同步停用。 */
    __allow(owner: Scope | undefined): void;
    /** 等待本次启用的必要显示资源；界面准备期间调用，不等待持续运行的业务任务。 */
    __ready?(): Promise<void>;
    /** 等待旧工作及清理全部完成。 */
    __deactivate(): Promise<void>;
}
const nativeBindings = new WeakMap<Component, ComponentBinding>();
const hosts = new WeakMap<Node, ComponentHost>();
const owners = new WeakMap<ComponentBinding, ComponentHost>();

function hostOf(node: Node): ComponentHost | undefined {
    for (let current: Node | null = node; current; current = current.parent) {
        const host = hosts.get(current);
        if (host) return host;
    }
    return undefined;
}

/** 实例级组件宿主。新增组件显式接入；嵌套的框架实例保留自己的宿主。 */
export class ComponentHost {
    readonly components: ComponentBinding[] = [];
    private activation?: Scope;

    constructor(
        root: Node,
        readonly context: ModuleContext,
        private readonly instance: Scope,
    ) {
        invariant(!hosts.has(root), 'COMPONENT_HOST_EXISTS', '此节点已有组件宿主');
        hosts.set(root, this);
        instance.defer(() => {
            hosts.delete(root);
        });
        instance.signal.onAbort(() => this.allow(undefined));
        this.collect(root);
    }

    private collect(root: Node): ComponentBinding[] {
        const selected: ComponentBinding[] = [];
        for (const component of root.getComponentsInChildren(Component)) {
            if (hostOf(component.node) !== this) continue;
            const binding = nativeBindings.get(component);
            if (!binding) continue;
            const previous = owners.get(binding);
            invariant(!previous || previous === this, 'COMPONENT_HOST_MISMATCH', '不能把已绑定的组件移交给另一实例');
            if (!previous) {
                binding.__bind(this.context, this.instance);
                owners.set(binding, this);
                this.components.push(binding);
            }
            selected.push(binding);
        }
        return selected;
    }

    /** onShow 内已可接入新组件，原有组件仍由 UI 准备阶段统一激活。 */
    begin(owner: Scope): void {
        this.activation = owner;
    }

    allow(owner: Scope | undefined): void {
        this.activation = owner;
        for (const component of this.components) component.__allow(owner);
    }

    async prepare(): Promise<void> {
        await this.prepareComponents(this.components);
    }

    private async prepareComponents(components: readonly ComponentBinding[]): Promise<void> {
        const owner = this.activation;
        invariant(owner, 'COMPONENT_HOST_INACTIVE', '组件宿主当前未显示或已结束');
        owner.signal.throwIfAborted();
        for (const component of components) if (component.__ready) component.__allow(owner);
        await untilCancelled(
            Promise.all(components.map((component) => component.__ready?.() ?? Promise.resolve())),
            owner.signal,
        );
        owner.signal.throwIfAborted();
        for (const component of components) if (!component.__ready) component.__allow(owner);
    }

    adopt(root: Node, caller: Lifetime, moduleId: string | undefined): Promise<void> {
        caller.signal.throwIfAborted();
        invariant(moduleId === this.context.id, 'COMPONENT_HOST_MISMATCH', '请使用宿主模块的资源入口');
        invariant(
            this.activation && !this.instance.signal.aborted,
            'COMPONENT_HOST_INACTIVE',
            '组件宿主当前未显示或已结束',
        );
        invariant(
            scopeOwner(this.activation).owns(caller) || scopeOwner(caller).owns(this.activation),
            'COMPONENT_OWNER_OUTSIDE_HOST',
            '请使用当前 show 或实例所属 Scope',
        );
        const activation = this.activation;
        return runTask(
            caller,
            () => {
                activation.signal.throwIfAborted();
                invariant(
                    isValid(root, true) && hostOf(root) === this,
                    'COMPONENT_HOST_MISMATCH',
                    '等待期间节点已离开原宿主',
                );
                return this.prepareComponents(this.collect(root));
            },
            undefined,
            'bind-components',
        );
    }
}

/** 给最近的框架实例显式接入运行时新增组件，不重复绑定已有组件。 */
export function bindAdditionalComponents(root: Node, owner: Lifetime, moduleId?: string): Promise<void> {
    const host = hostOf(root);
    invariant(host, 'COMPONENT_HOST_MISSING', '节点必须位于框架 UI、实例或 bindScene 宿主中');
    return host.adopt(root, owner, moduleId);
}

/** 激活 Assets 创建的实例。 */
export function allowInstanceComponents(root: Node, owner: Scope): void {
    const host = hosts.get(root);
    if (host) host.allow(owner);
}

/** @internal 注册普通 TypeScript 生命周期对象；不会向节点添加组件。 */
export function registerComponentBinding(component: Component, binding: ComponentBinding): void {
    nativeBindings.set(component, binding);
}

/** @internal 在现有实例遍历中一并收集 Part 和原生 UI 扩展，包含未激活节点。 */
export function componentBindings(root: Node): ComponentBinding[] {
    const result: ComponentBinding[] = [];
    for (const component of root.getComponentsInChildren(Component)) {
        const binding = nativeBindings.get(component);
        if (binding) result.push(binding);
    }
    return result;
}
