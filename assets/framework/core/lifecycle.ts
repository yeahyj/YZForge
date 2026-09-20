import { Component } from 'cc';
import { FrameworkError } from './errors';
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
/** Additional development guard; tooling checks indirect bases and computed literals too. */
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
