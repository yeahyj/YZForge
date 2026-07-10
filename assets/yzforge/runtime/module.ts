import type { App } from './app';
import type { ConfigScope } from './config';
import type { ContentPackLease, ContentPackLoadPlan, ContentPackRecordSnapshot } from './content-pack';
import type { LibraryLease } from './library';
import { EventBus } from './event-bus';
import { YZForgeError } from './errors';
import type { Logger } from './logger';
import type { ContentPackRef, LibraryRef, ModuleRef, ViewRef } from './refs';
import type { ModuleExtensionToken } from './tokens';
import type { MaybePromise } from './types';
import type { ModuleAssets } from './assets';
import type { OpenViewOptions, UiCancelResult, ViewHandle, ViewLayer, ViewSnapshot } from './ui';
import { runCleanupSteps } from './compensation';

export enum ModuleState {
    Empty = 'empty',
    Creating = 'creating',
    Loading = 'loading',
    Ready = 'ready',
    Entering = 'entering',
    Active = 'active',
    Paused = 'paused',
    Exiting = 'exiting',
    Unloading = 'unloading',
    Unloaded = 'unloaded',
    Failed = 'failed',
}

export type ModelType<TModel extends Model> = new () => TModel;
export type ServiceType<TService extends Service> = new () => TService;
export type FlowType<TFlow extends Flow> = new () => TFlow;

export interface ModuleLibraryAccess {
    load<TTokens, TConfig extends object>(ref: LibraryRef<TTokens, TConfig>): Promise<LibraryLease<TTokens, TConfig>>;
    releaseAll?(reason?: unknown): Promise<void>;
}

export interface ModuleContentPackAccess {
    load<TContract, TConfig>(ref: ContentPackRef<TContract, TConfig>): Promise<ContentPackLease<TContract, TConfig>>;
    explain?<TContract, TConfig>(ref: ContentPackRef<TContract, TConfig>): ContentPackLoadPlan;
    snapshot?(id: string): ContentPackRecordSnapshot | undefined;
    snapshots?(): ContentPackRecordSnapshot[];
    releaseAll?(reason?: unknown): Promise<void>;
}

export interface ModuleUIAccess {
    open<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        options?: OpenViewOptions,
    ): Promise<ViewHandle<TResult>>;
    openForResult<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        options?: OpenViewOptions,
    ): Promise<TResult | UiCancelResult>;
    close(target: ViewHandle | ViewRef, result?: unknown): Promise<void>;
    closeLayer?(layer: ViewLayer, reason?: unknown): Promise<void>;
    back?(): Promise<boolean>;
    closeOwned(reason?: unknown): Promise<void>;
    pauseOwned?(): Promise<void>;
    resumeOwned?(): void;
    snapshots(): ViewSnapshot[];
    top(): ViewHandle | undefined;
}

export type ModuleConfigOf<TModule> = TModule extends Module<any, infer TConfig> ? TConfig : object;

export interface ModuleRuntimeContext<TConfig extends object = object> {
    readonly app: App;
    readonly ref: ModuleRef;
    readonly assets: ModuleAssets;
    readonly config: ConfigScope<TConfig>;
    readonly libraries: ModuleLibraryAccess;
    readonly contentPacks: ModuleContentPackAccess;
    readonly ui: ModuleUIAccess;
    readonly logger: Logger;
}

export interface ModuleLease<TModule extends Module = Module, TConfig extends object = ModuleConfigOf<TModule>> {
    readonly leaseId: string;
    readonly released: boolean;
    readonly ref: ModuleRef;
    readonly bundleName: string;
    readonly instance: TModule;
    readonly assets: ModuleAssets;
    readonly config: ConfigScope<TConfig>;
    readonly contentPacks: ModuleContentPackAccess;
    release(reason?: unknown): Promise<void>;
}

interface ModuleInternal<TConfig extends object = object> {
    state: ModuleState;
    context?: ModuleRuntimeContext<TConfig>;
    readonly models: Map<ModelType<Model>, Model>;
    readonly services: Map<ServiceType<Service>, Service>;
    readonly flows: Map<FlowType<Flow>, Flow>;
}

type ModuleRuntimeOperation = 'create' | 'load' | 'enter' | 'pause' | 'resume' | 'exit' | 'unload';
const moduleRuntimeOperation = Symbol('yzforge.module.runtime-operation');
const moduleInternals = new WeakMap<Module, ModuleInternal>();
const moduleUnitOwners = new WeakMap<ModuleUnit, Module>();

export abstract class Module<TEnter = unknown, TConfig extends object = object> {
    public readonly event = new EventBus();

    public get state(): ModuleState {
        return requireInternal(this).state;
    }

    public get app(): App {
        return this.requireContext().app;
    }

    public get name(): string {
        return this.requireContext().ref.name;
    }

    public get assets(): ModuleAssets {
        return this.requireContext().assets;
    }

    public get config(): ConfigScope<TConfig> {
        return this.requireContext().config;
    }

    public get libraries(): ModuleLibraryAccess {
        return this.requireContext().libraries;
    }

    public get contentPacks(): ModuleContentPackAccess {
        return this.requireContext().contentPacks;
    }

    public get ui(): ModuleUIAccess {
        return this.requireContext().ui;
    }

    public get logger(): Logger {
        return this.requireContext().logger;
    }

    public useModel<TModel extends Model>(type: ModelType<TModel>): TModel {
        return this.useUnit('model', type, requireInternal(this).models) as TModel;
    }

    public useService<TService extends Service>(type: ServiceType<TService>): TService {
        return this.useUnit('service', type, requireInternal(this).services) as TService;
    }

    public useFlow<TFlow extends Flow>(type: FlowType<TFlow>): TFlow {
        return this.useUnit('flow', type, requireInternal(this).flows) as TFlow;
    }

    public use<TValue>(token: ModuleExtensionToken<TValue>): TValue {
        return this.app.useModuleToken(this, token);
    }

    public async [moduleRuntimeOperation](operation: ModuleRuntimeOperation, value?: unknown): Promise<void> {
        if (operation === 'create') return await this.onCreate();
        if (operation === 'load') return await this.onLoad();
        if (operation === 'enter') return await this.onEnter(value as TEnter);
        if (operation === 'pause') return await this.onPause();
        if (operation === 'resume') return await this.onResume();
        if (operation === 'exit') return await this.onExit();
        await this.onUnload();
    }

    protected onCreate(): MaybePromise<void> {}
    protected onLoad(): MaybePromise<void> {}
    protected onEnter(_params?: TEnter): MaybePromise<void> {}
    protected onPause(): MaybePromise<void> {}
    protected onResume(): MaybePromise<void> {}
    protected onExit(): MaybePromise<void> {}
    protected onUnload(): MaybePromise<void> {}

    private requireContext(): ModuleRuntimeContext<TConfig> {
        const context = requireInternal(this).context as ModuleRuntimeContext<TConfig> | undefined;
        if (!context) {
            throw new YZForgeError('Module has not been bound to an App context.', 'module.context_missing');
        }
        return context;
    }

    private useUnit(
        kind: string,
        type: new () => ModuleUnit,
        units: Map<new () => ModuleUnit, ModuleUnit>,
    ): ModuleUnit {
        const existing = units.get(type);
        if (existing) {
            return existing;
        }
        const unit = new type();
        moduleUnitOwners.set(unit, this);
        try {
            unit.onCreate();
            units.set(type, unit);
            return unit;
        } catch (error) {
            moduleUnitOwners.delete(unit);
            throw new YZForgeError(`Module ${kind} creation failed: ${type.name}`, 'module_unit.create_failed', {
                module: this.name,
                kind,
                type: type.name,
                error,
            });
        }
    }
}

export function bindModuleRuntime<TConfig extends object>(module: Module<unknown, TConfig>, context: ModuleRuntimeContext<TConfig>): void {
    const internal = requireInternal(module) as ModuleInternal<TConfig>;
    if (internal.context) {
        throw new YZForgeError(`Module runtime is already bound: ${context.ref.name}`, 'module.already_bound');
    }
    internal.context = context;
}

export async function createModuleRuntime(module: Module): Promise<void> {
    const internal = requireInternal(module);
    internal.state = ModuleState.Creating;
    try {
        await module[moduleRuntimeOperation]('create');
    } catch (error) {
        internal.state = ModuleState.Failed;
        throw error;
    }
}

export async function loadModuleRuntime(module: Module): Promise<void> {
    const internal = requireInternal(module);
    internal.state = ModuleState.Loading;
    try {
        await module[moduleRuntimeOperation]('load');
        internal.state = ModuleState.Ready;
    } catch (error) {
        internal.state = ModuleState.Failed;
        throw error;
    }
}

export async function enterModuleRuntime(module: Module, params?: unknown): Promise<void> {
    const internal = requireInternal(module);
    const previous = internal.state;
    internal.state = ModuleState.Entering;
    try {
        await module[moduleRuntimeOperation]('enter', params);
        internal.state = ModuleState.Active;
    } catch (error) {
        internal.state = previous;
        throw error;
    }
}

export async function pauseModuleRuntime(module: Module): Promise<void> {
    const internal = requireInternal(module);
    if (internal.state !== ModuleState.Active) return;
    await module[moduleRuntimeOperation]('pause');
    internal.state = ModuleState.Paused;
}

export async function resumeModuleRuntime(module: Module): Promise<void> {
    const internal = requireInternal(module);
    if (internal.state !== ModuleState.Paused) return;
    await module[moduleRuntimeOperation]('resume');
    internal.state = ModuleState.Active;
}

export async function exitModuleRuntime(module: Module): Promise<void> {
    const internal = requireInternal(module);
    if (internal.state !== ModuleState.Active && internal.state !== ModuleState.Paused) return;
    const previous = internal.state;
    internal.state = ModuleState.Exiting;
    try {
        await module[moduleRuntimeOperation]('exit');
        internal.state = ModuleState.Ready;
    } catch (error) {
        internal.state = previous;
        throw error;
    }
}

export async function disposeModuleRuntime(module: Module): Promise<void> {
    const internal = requireInternal(module);
    if (internal.state === ModuleState.Unloaded || internal.state === ModuleState.Unloading) return;
    internal.state = ModuleState.Unloading;
    const steps = [
        ...unitCleanupSteps('flow', internal.flows),
        ...unitCleanupSteps('service', internal.services),
        ...unitCleanupSteps('model', internal.models),
        { step: 'module.onUnload', task: () => module[moduleRuntimeOperation]('unload') },
        { step: 'module.event.clear', task: () => module.event.clear() },
    ];
    internal.flows.clear();
    internal.services.clear();
    internal.models.clear();
    try {
        await runCleanupSteps(`module.dispose:${internal.context?.ref.name ?? 'unbound'}`, steps);
    } finally {
        internal.state = ModuleState.Unloaded;
    }
}

export abstract class ModuleUnit {
    public get module(): Module {
        const owner = moduleUnitOwners.get(this);
        if (!owner) {
            throw new YZForgeError('Module unit has not been bound.', 'module_unit.context_missing');
        }
        return owner;
    }

    public get app(): App {
        return this.module.app;
    }

    public onCreate(): void {}
    public onDispose(): MaybePromise<void> {}
}

export abstract class Model extends ModuleUnit {}
export abstract class Service extends ModuleUnit {}
export abstract class Flow extends ModuleUnit {}

function requireInternal(module: Module): ModuleInternal {
    let internal = moduleInternals.get(module);
    if (!internal) {
        internal = {
            state: ModuleState.Empty,
            models: new Map(),
            services: new Map(),
            flows: new Map(),
        };
        moduleInternals.set(module, internal);
    }
    return internal;
}

function unitCleanupSteps(kind: string, units: Map<new () => ModuleUnit, ModuleUnit>) {
    return Array.from(units.values()).reverse().map((unit) => ({
        step: `${kind}.onDispose:${unit.constructor.name}`,
        task: async () => {
            try {
                await unit.onDispose();
            } finally {
                moduleUnitOwners.delete(unit);
            }
        },
    }));
}
