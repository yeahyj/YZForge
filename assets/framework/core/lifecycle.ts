import { Component } from 'cc';
import { FrameworkError } from './errors';
/**
 * 框架保留的引擎钩子名列表。继承框架组件时业务改用 onInit、onActivate、onShow、onTick 等自定义钩子。
 */
export const reservedLifecycle = Object.freeze([
    '__preload',
    'onLoad',
    'start',
    'onEnable',
    'onDisable',
    'update',
    'lateUpdate',
    'onDestroy',
]);
/**
 * @internal
 * 沿业务实例到框架基类的原型链检查保留钩子，防止业务覆盖框架接管的引擎生命周期。
 * @param component - 待检查组件。
 * @param frameworkPrototype - 允许声明引擎适配钩子的框架原型边界。
 * @throws FrameworkError 业务覆盖了保留生命周期，或没有继承要求的框架基类。
 */
export function assertLifecycle(component: Component, frameworkPrototype: object): void {
    let target: object | null = component;
    while (target && target !== frameworkPrototype) {
        for (const name of reservedLifecycle)
            if (Object.prototype.hasOwnProperty.call(target, name)) {
                throw new FrameworkError(
                    'LIFECYCLE_OVERRIDE',
                    `${component.constructor.name} overrides reserved engine hook ${name}`,
                );
            }
        target = Object.getPrototypeOf(target);
    }
    if (!target)
        throw new FrameworkError('LIFECYCLE_BASE_INVALID', 'Business components must inherit a framework base');
}
/**
 * @internal
 * 检查要求同步的框架钩子是否错误返回 Promise，异步任务应放到 activation.run 或 show.run。
 * @param result - 钩子调用结果。
 * @param hook - 钩子名称，用于错误定位。
 * @throws FrameworkError 返回 Promise/thenable 时抛 ASYNC_COMPONENT_HOOK。
 */
export function synchronous(result: unknown, hook: string): void {
    if (result && typeof (result as Promise<unknown>).then === 'function') {
        // The diagnostic must not leave a second, unobserved rejection behind.
        void Promise.resolve(result).catch(() => {});
        throw new FrameworkError(
            'ASYNC_COMPONENT_HOOK',
            `${hook} must be synchronous; use activation.run() or show.run()`,
        );
    }
}
