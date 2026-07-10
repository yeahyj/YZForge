import type { App } from './app';
import type { Module, ModuleLease } from './module';
import {
    enterModuleRuntime,
    exitModuleRuntime,
    pauseModuleRuntime,
    resumeModuleRuntime,
} from './module';
import type { ModuleRef } from './refs';
import { YZForgeError } from './errors';
import { CompensationStack } from './compensation';

export enum EnterMode {
    Replace = 'replace',
    Push = 'push',
}

export interface EnterModuleOptions {
    readonly mode?: EnterMode;
    readonly unloadPrevious?: boolean;
    readonly closePreviousUi?: boolean;
    readonly restorePreviousUiOnBack?: boolean;
    readonly cancelPendingEnter?: boolean;
}

export type NavigateModuleOptions = Omit<EnterModuleOptions, 'mode'>;

export interface NavigationModuleSnapshot {
    readonly name: string;
    readonly bundleName: string;
    readonly state: string;
}

export interface NavigationStackEntrySnapshot {
    readonly module: NavigationModuleSnapshot;
    readonly restoreUiOnBack: boolean;
}

export interface NavigatorFailureSnapshot {
    readonly operation: string;
    readonly error: unknown;
}

export interface NavigatorSnapshot {
    readonly active?: NavigationModuleSnapshot;
    readonly stackDepth: number;
    readonly stack: readonly NavigationStackEntrySnapshot[];
    readonly transitioning: boolean;
    readonly serial: number;
    readonly lastFailure?: NavigatorFailureSnapshot;
}

interface NavigationStackEntry {
    readonly module: ModuleLease<Module>;
    readonly restoreUiOnBack: boolean;
}

export class ModuleNavigator {
    private readonly stack: NavigationStackEntry[] = [];
    private current?: ModuleLease<Module>;
    private transitionTail: Promise<void> = Promise.resolve();
    private enterSerial = 0;
    private queuedTransitions = 0;
    private lastFailure?: NavigatorFailureSnapshot;

    public constructor(private readonly app: App) {}

    public async enter<
        TParams,
        TConfig extends object = object,
        TModule extends Module<TParams, TConfig> = Module<TParams, TConfig>,
    >(
        ref: ModuleRef<TParams, TConfig>,
        params?: TParams,
        options: EnterModuleOptions = {},
    ): Promise<ModuleLease<TModule, TConfig>> {
        const serial = options.cancelPendingEnter === false ? 0 : ++this.enterSerial;
        return await this.enqueue(`enter:${ref.name}`, async () => {
            this.ensureCurrent(serial);
            return await this.enterNow(ref, params, options, serial);
        });
    }

    public async replace<
        TParams,
        TConfig extends object = object,
        TModule extends Module<TParams, TConfig> = Module<TParams, TConfig>,
    >(
        ref: ModuleRef<TParams, TConfig>,
        params?: TParams,
        options: NavigateModuleOptions = {},
    ): Promise<ModuleLease<TModule, TConfig>> {
        return await this.enter(ref, params, { ...options, mode: EnterMode.Replace });
    }

    public async push<
        TParams,
        TConfig extends object = object,
        TModule extends Module<TParams, TConfig> = Module<TParams, TConfig>,
    >(
        ref: ModuleRef<TParams, TConfig>,
        params?: TParams,
        options: NavigateModuleOptions = {},
    ): Promise<ModuleLease<TModule, TConfig>> {
        return await this.enter(ref, params, { ...options, mode: EnterMode.Push });
    }

    public async back(): Promise<boolean> {
        this.enterSerial += 1;
        return await this.enqueue('back', async () => await this.backNow());
    }

    public async detach(handle: ModuleLease): Promise<void> {
        await this.detachModule(handle.instance);
    }

    public async detachModule(instance: Module): Promise<void> {
        await this.enqueue(`detach:${instance.name}`, async () => {
            if (this.current?.instance === instance) {
                await exitModuleRuntime(instance);
                this.current = undefined;
            }
            const index = this.stack.findIndex((entry) => entry.module.instance === instance);
            if (index >= 0) {
                this.stack.splice(index, 1);
                await exitModuleRuntime(instance);
            }
        });
    }

    public snapshot(): NavigatorSnapshot {
        return {
            active: this.current ? this.snapshotModule(this.current) : undefined,
            stackDepth: this.stack.length,
            stack: this.stack.map((entry) => ({
                module: this.snapshotModule(entry.module),
                restoreUiOnBack: entry.restoreUiOnBack,
            })),
            transitioning: this.queuedTransitions > 0,
            serial: this.enterSerial,
            lastFailure: this.lastFailure,
        };
    }

    private async enterNow<
        TParams,
        TConfig extends object,
        TModule extends Module<TParams, TConfig>,
    >(
        ref: ModuleRef<TParams, TConfig>,
        params: TParams | undefined,
        options: EnterModuleOptions,
        serial: number,
    ): Promise<ModuleLease<TModule, TConfig>> {
        const mode = options.mode ?? EnterMode.Replace;
        const closePreviousUi = options.closePreviousUi ?? mode === EnterMode.Replace;
        const restorePreviousUiOnBack = options.restorePreviousUiOnBack ?? mode === EnterMode.Push;
        const previous = this.current;
        const target = await this.app.loadModule<TParams, TConfig, TModule>(ref);
        this.ensureCurrent(serial);

        if (previous === target) {
            await enterModuleRuntime(target.instance, params);
            this.current = target as ModuleLease<Module>;
            return target;
        }

        const transaction = new CompensationStack(`navigator.enter:${ref.name}`);
        try {
            if (previous) {
                if (mode === EnterMode.Push) {
                    await pauseModuleRuntime(previous.instance);
                    transaction.defer('resume previous module', () => resumeModuleRuntime(previous.instance));
                    if (closePreviousUi) {
                        await previous.instance.ui.closeOwned('push');
                    } else {
                        await previous.instance.ui.pauseOwned?.();
                        transaction.defer('resume previous module ui', () => previous.instance.ui.resumeOwned?.());
                    }
                    const stackEntry = {
                        module: previous,
                        restoreUiOnBack: restorePreviousUiOnBack && !closePreviousUi,
                    };
                    this.stack.push(stackEntry);
                    transaction.defer('remove previous module from navigation stack', () => {
                        const index = this.stack.indexOf(stackEntry);
                        if (index >= 0) this.stack.splice(index, 1);
                    });
                } else {
                    await exitModuleRuntime(previous.instance);
                    transaction.defer('re-enter previous module', () => enterModuleRuntime(previous.instance));
                    if (closePreviousUi) {
                        await previous.instance.ui.closeOwned('replace');
                    } else {
                        await previous.instance.ui.pauseOwned?.();
                        transaction.defer('resume previous module ui', () => previous.instance.ui.resumeOwned?.());
                    }
                }
            }

            this.ensureCurrent(serial);
            await enterModuleRuntime(target.instance, params);
            transaction.defer('exit target module', async () => {
                await exitModuleRuntime(target.instance);
                await target.instance.ui.closeOwned('enter_failed');
            });
            this.current = target as ModuleLease<Module>;
            transaction.commit();
            if (previous && mode === EnterMode.Replace && options.unloadPrevious) {
                try {
                    await this.app.unloadModule(previous.ref);
                } catch (error) {
                    this.app.logger.warn(`Failed to release replaced module: ${previous.ref.name}`, error);
                }
            }
            return target;
        } catch (error) {
            this.current = previous;
            return await transaction.fail(error, { type: 'navigator_enter_failed', module: ref.name });
        }
    }

    private async backNow(): Promise<boolean> {
        const current = this.current;
        if (!current) {
            return false;
        }
        if (await current.instance.ui.back?.()) {
            return true;
        }
        await exitModuleRuntime(current.instance);
        await current.instance.ui.closeOwned('back');
        const previous = this.stack.pop();
        if (!previous) {
            this.current = undefined;
            return true;
        }
        this.current = previous.module;
        if (previous.restoreUiOnBack) {
            previous.module.instance.ui.resumeOwned?.();
        }
        await resumeModuleRuntime(previous.module.instance);
        return true;
    }

    private ensureCurrent(serial: number): void {
        if (serial !== 0 && serial !== this.enterSerial) {
            throw new YZForgeError('Module enter request was cancelled.', 'navigator.enter_cancelled');
        }
    }

    private async enqueue<TValue>(operation: string, task: () => Promise<TValue>): Promise<TValue> {
        this.queuedTransitions += 1;
        let resolveValue!: (value: TValue) => void;
        let rejectValue!: (error: unknown) => void;
        const result = new Promise<TValue>((resolve, reject) => {
            resolveValue = resolve;
            rejectValue = reject;
        });
        const run = async (): Promise<void> => {
            try {
                const value = await task();
                this.lastFailure = undefined;
                resolveValue(value);
            } catch (error) {
                this.lastFailure = { operation, error: describeError(error) };
                rejectValue(error);
            } finally {
                this.queuedTransitions = Math.max(0, this.queuedTransitions - 1);
            }
        };
        this.transitionTail = this.transitionTail.then(run, run);
        return await result;
    }

    private snapshotModule(handle: ModuleLease<Module>): NavigationModuleSnapshot {
        return {
            name: handle.ref.name,
            bundleName: handle.bundleName,
            state: handle.instance.state,
        };
    }
}

function describeError(error: unknown): unknown {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            ...(error instanceof YZForgeError ? { code: error.code, details: error.details } : {}),
        };
    }
    return error;
}
