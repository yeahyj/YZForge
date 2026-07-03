import type { App } from './app';
import type { LoadedModule, Module } from './module';
import { ModuleState } from './module';
import type { ModuleRef } from './refs';

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

export class ModuleNavigator {
    private readonly stack: Array<LoadedModule<Module>> = [];
    private current?: LoadedModule<Module>;

    public constructor(private readonly app: App) {}

    public get active(): LoadedModule<Module> | undefined {
        return this.current;
    }

    public async enter<TModule extends Module, TParams>(
        ref: ModuleRef<TParams>,
        params?: TParams,
        options: EnterModuleOptions = {},
    ): Promise<LoadedModule<TModule>> {
        const mode = options.mode ?? EnterMode.Replace;
        const closePreviousUi = options.closePreviousUi ?? mode === EnterMode.Replace;
        const target = await this.app.loadModule<TModule, TParams>(ref);
        const previous = this.current;

        if (previous && previous !== target) {
            if (mode === EnterMode.Push) {
                await previous.instance.__yzforgePause();
                previous.instance.ui.pauseOwned?.();
                this.stack.push(previous);
            } else {
                await previous.instance.__yzforgeExit();
                if (closePreviousUi) {
                    await previous.instance.ui.closeOwned('replace');
                }
                if (options.unloadPrevious) {
                    await this.app.unloadModule(previous.ref);
                }
            }
        }

        await target.instance.__yzforgeEnter(params);
        this.current = target as LoadedModule<Module>;
        return target;
    }

    public async back(): Promise<boolean> {
        const current = this.current;
        if (!current) {
            return false;
        }
        if (await current.instance.ui.back?.()) {
            return true;
        }

        await current.instance.__yzforgeExit();
        await current.instance.ui.closeOwned('back');
        const previous = this.stack.pop();
        if (!previous) {
            this.current = undefined;
            return true;
        }
        this.current = previous;
        previous.instance.ui.resumeOwned?.();
        await previous.instance.__yzforgeResume();
        return true;
    }

    public async detach(handle: LoadedModule): Promise<void> {
        if (this.current === handle) {
            this.current = undefined;
        }
        const index = this.stack.indexOf(handle);
        if (index >= 0) {
            this.stack.splice(index, 1);
        }
        if (handle.instance.state === ModuleState.Active || handle.instance.state === ModuleState.Paused) {
            await handle.instance.__yzforgeExit();
        }
    }
}
