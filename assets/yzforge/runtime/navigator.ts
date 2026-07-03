import type { App } from './app';
import type { LoadedModule, Module } from './module';
import { ModuleState } from './module';
import type { ModuleRef } from './refs';
import { YZForgeError } from './errors';

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

interface NavigationStackEntry {
    readonly module: LoadedModule<Module>;
    readonly restoreUiOnBack: boolean;
}

export class ModuleNavigator {
    private readonly stack: NavigationStackEntry[] = [];
    private current?: LoadedModule<Module>;
    private enterTask: Promise<LoadedModule<Module> | undefined> = Promise.resolve(undefined);
    private enterSerial = 0;

    public constructor(private readonly app: App) {}

    public get active(): LoadedModule<Module> | undefined {
        return this.current;
    }

    public get stackDepth(): number {
        return this.stack.length;
    }

    public async enter<TModule extends Module, TParams>(
        ref: ModuleRef<TParams>,
        params?: TParams,
        options: EnterModuleOptions = {},
    ): Promise<LoadedModule<TModule>> {
        const serial = options.cancelPendingEnter === false ? 0 : ++this.enterSerial;
        const run = async (): Promise<LoadedModule<Module>> => {
            this.ensureCurrent(serial);
            return await this.enterNow(ref, params, options, serial) as LoadedModule<Module>;
        };
        const task = this.enterTask.then(run, run);
        this.enterTask = task.catch(() => undefined);
        return await task as LoadedModule<TModule>;
    }

    public async back(): Promise<boolean> {
        const current = this.current;
        if (!current) {
            return false;
        }
        if (await current.instance.ui.back?.()) {
            return true;
        }

        await this.exitCurrentForBack(current);
        const previous = this.stack.pop();
        if (!previous) {
            this.current = undefined;
            return true;
        }
        this.current = previous.module;
        if (previous.restoreUiOnBack) {
            previous.module.instance.ui.resumeOwned?.();
        }
        await previous.module.instance.__yzforgeResume();
        return true;
    }

    public async detach(handle: LoadedModule): Promise<void> {
        if (this.current === handle) {
            this.current = undefined;
        }
        const index = this.stack.findIndex((entry) => entry.module === handle);
        if (index >= 0) {
            this.stack.splice(index, 1);
        }
        if (handle.instance.state === ModuleState.Active || handle.instance.state === ModuleState.Paused) {
            await handle.instance.__yzforgeExit();
        }
    }

    private async enterNow<TModule extends Module, TParams>(
        ref: ModuleRef<TParams>,
        params: TParams | undefined,
        options: EnterModuleOptions,
        serial: number,
    ): Promise<LoadedModule<TModule>> {
        const mode = options.mode ?? EnterMode.Replace;
        const closePreviousUi = options.closePreviousUi ?? mode === EnterMode.Replace;
        const restorePreviousUiOnBack = options.restorePreviousUiOnBack ?? mode === EnterMode.Push;
        const previous = this.current;
        const target = await this.app.loadModule<TModule, TParams>(ref);
        this.ensureCurrent(serial);

        if (previous === target) {
            await this.reenterCurrent(target, params);
            this.current = target as LoadedModule<Module>;
            return target;
        }

        let previousPrepared = false;
        try {
            if (previous) {
                if (mode === EnterMode.Push) {
                    await previous.instance.__yzforgePause();
                    previousPrepared = true;
                    if (closePreviousUi) {
                        await previous.instance.ui.closeOwned('push');
                    } else {
                        await previous.instance.ui.pauseOwned?.();
                    }
                    this.stack.push({
                        module: previous,
                        restoreUiOnBack: restorePreviousUiOnBack && !closePreviousUi,
                    });
                } else {
                    await previous.instance.__yzforgeExit();
                    previousPrepared = true;
                    if (closePreviousUi) {
                        await previous.instance.ui.closeOwned('replace');
                    } else {
                        await previous.instance.ui.pauseOwned?.();
                    }
                }
            }

            this.ensureCurrent(serial);
            await target.instance.__yzforgeEnter(params);
            this.current = target as LoadedModule<Module>;
            if (previous && mode === EnterMode.Replace && options.unloadPrevious) {
                await this.unloadReplacedModule(previous);
            }
            return target;
        } catch (error) {
            await this.rollbackEnter(previous, target as LoadedModule<Module>, mode, previousPrepared);
            throw error;
        }
    }

    private async reenterCurrent<TModule extends Module, TParams>(
        target: LoadedModule<TModule>,
        params: TParams | undefined,
    ): Promise<void> {
        const previousState = target.instance.state;
        try {
            await target.instance.__yzforgeEnter(params);
        } catch (error) {
            target.instance.state = previousState;
            throw error;
        }
    }

    private ensureCurrent(serial: number): void {
        if (serial !== 0 && serial !== this.enterSerial) {
            throw new YZForgeError('Module enter request was cancelled.', 'navigator.enter_cancelled');
        }
    }

    private async exitCurrentForBack(current: LoadedModule<Module>): Promise<void> {
        await current.instance.__yzforgeExit();
        await current.instance.ui.closeOwned('back');
    }

    private async unloadReplacedModule(previous: LoadedModule<Module>): Promise<void> {
        try {
            await this.app.unloadModule(previous.ref);
        } catch (error) {
            this.app.logger.warn(`Failed to unload replaced module: ${previous.ref.name}`, error);
        }
    }

    private async rollbackEnter(
        previous: LoadedModule<Module> | undefined,
        target: LoadedModule<Module>,
        mode: EnterMode,
        previousPrepared: boolean,
    ): Promise<void> {
        if (target.instance.state === ModuleState.Active || target.instance.state === ModuleState.Paused) {
            await target.instance.__yzforgeExit();
        } else if (target.instance.state === ModuleState.Entering) {
            target.instance.state = ModuleState.Ready;
        }
        await target.instance.ui.closeOwned('enter_failed');

        if (!previous || !previousPrepared) {
            this.current = previous;
            return;
        }

        if (mode === EnterMode.Push) {
            const index = this.stack.findIndex((entry) => entry.module === previous);
            if (index >= 0) {
                this.stack.splice(index, 1);
            }
            previous.instance.ui.resumeOwned?.();
            await previous.instance.__yzforgeResume();
        } else if (previous.instance.state === ModuleState.Ready) {
            previous.instance.ui.resumeOwned?.();
            await previous.instance.__yzforgeEnter();
        }
        this.current = previous;
    }
}
