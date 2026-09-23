import { Component, Node } from 'cc';
import { GameComponent } from './game-component';
import type { ModuleContext } from '../modules/module-manager';
import type { Scope } from './scope';
import type { TimeService } from '../time/time-service';

/** @internal 原生组件扩展接入 UI、Part 和列表复用的生命周期，不需要再挂一个脚本。 */
export interface ComponentBinding {
    /** 注入实例所属模块。 */
    __bind(context: ModuleContext, instance: Scope, time: TimeService): void;
    /** 允许本次显示工作，undefined 表示同步停用。 */
    __allow(owner: Scope | undefined): void;
    /** 等待旧工作及清理全部完成。 */
    __deactivate(): Promise<void>;
}
const nativeBindings = new WeakMap<Component, ComponentBinding>();

/** @internal 注册普通 TypeScript 生命周期对象；不会向节点添加组件。 */
export function registerComponentBinding(component: Component, binding: ComponentBinding): void {
    nativeBindings.set(component, binding);
}

/** @internal 在现有实例遍历中一并收集 Part 和原生 UI 扩展，包含未激活节点。 */
export function componentBindings(root: Node): ComponentBinding[] {
    const result: ComponentBinding[] = [];
    for (const component of root.getComponentsInChildren(Component)) {
        const binding = component instanceof GameComponent ? component : nativeBindings.get(component);
        if (binding) result.push(binding);
    }
    return result;
}
