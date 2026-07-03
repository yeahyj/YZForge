import type { App } from './app';
import type { ConfigScope } from './config';
import { EventBus } from './event-bus';
import { YZForgeError } from './errors';
import type { Logger } from './logger';
import type { ModuleRef } from './refs';
import type { ModuleExtensionToken } from './tokens';
import type { MaybePromise } from './types';
import type { ModuleAssets } from './assets';

export enum ModuleState {
    Empty = 'empty',
    Preloading = 'preloading',
    BundleReady = 'bundle-ready',
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
    load(ref: unknown): Promise<unknown>;
    releaseAll?(): Promise<void>;
}

export interface ModuleContentPackAccess {
    load(ref: unknown): Promise<unknown>;
    unloadAll?(): Promise<void>;
}

export interface ModuleUIAccess {
    back?(): Promise<boolean>;
    closeOwned(reason?: unknown): Promise<void>;
    pauseOwned?(): void;
    resumeOwned?(): void;
}

export interface ModuleRuntimeContext {
    readonly app: App;
    readonly ref: ModuleRef;
    readonly assets: ModuleAssets;
    readonly config: ConfigScope | Record<string, unknown>;
    readonly libraries: ModuleLibraryAccess;
    readonly contentPacks: ModuleContentPackAccess;
    readonly ui: ModuleUIAccess;
    readonly logger: Logger;
}

export interface LoadedModule<TModule extends Module = Module> {
    readonly ref: ModuleRef;
    readonly bundleName: string;
    readonly instance: TModule;
    readonly assets: ModuleAssets;
    readonly config: ConfigScope | Record<string, unknown>;
    readonly contentPacks: ModuleContentPackAccess;
    unload(): Promise<void>;
}

export abstract class Module<TEnter = unknown> {
    private context?: ModuleRuntimeContext;
    private readonly models = new Map<ModelType<Model>, Model>();
    private readonly services = new Map<ServiceType<Service>, Service>();
    private readonly flows = new Map<FlowType<Flow>, Flow>();

    public state = ModuleState.Empty;
    public readonly event = new EventBus();

    public get app(): App {
        return this.requireContext().app;
    }

    public get name(): string {
        return this.requireContext().ref.name;
    }

    public get assets(): ModuleAssets {
        return this.requireContext().assets;
    }

    public get config(): ConfigScope | Record<string, unknown> {
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
        let model = this.models.get(type);
        if (!model) {
            model = new type();
            model.__yzforgeBind(this);
            this.models.set(type, model);
            model.onCreate();
        }
        return model as TModel;
    }

    public useService<TService extends Service>(type: ServiceType<TService>): TService {
        let service = this.services.get(type);
        if (!service) {
            service = new type();
            service.__yzforgeBind(this);
            this.services.set(type, service);
            service.onCreate();
        }
        return service as TService;
    }

    public useFlow<TFlow extends Flow>(type: FlowType<TFlow>): TFlow {
        let flow = this.flows.get(type);
        if (!flow) {
            flow = new type();
            flow.__yzforgeBind(this);
            this.flows.set(type, flow);
            flow.onCreate();
        }
        return flow as TFlow;
    }

    public use<TValue>(token: ModuleExtensionToken<TValue>): TValue {
        return this.app.extensions.useModuleToken(this, token);
    }

    public __yzforgeBind(context: ModuleRuntimeContext): void {
        this.context = context;
    }

    public async __yzforgeCreate(): Promise<void> {
        this.state = ModuleState.Creating;
        await this.onCreate();
    }

    public async __yzforgeLoad(): Promise<void> {
        this.state = ModuleState.Loading;
        await this.onLoad();
        this.state = ModuleState.Ready;
    }

    public async __yzforgeEnter(params?: TEnter): Promise<void> {
        this.state = ModuleState.Entering;
        await this.onEnter(params);
        this.state = ModuleState.Active;
    }

    public async __yzforgePause(): Promise<void> {
        if (this.state !== ModuleState.Active) {
            return;
        }
        await this.onPause();
        this.state = ModuleState.Paused;
    }

    public async __yzforgeResume(): Promise<void> {
        if (this.state !== ModuleState.Paused) {
            return;
        }
        await this.onResume();
        this.state = ModuleState.Active;
    }

    public async __yzforgeExit(): Promise<void> {
        if (this.state !== ModuleState.Active && this.state !== ModuleState.Paused) {
            return;
        }
        this.state = ModuleState.Exiting;
        await this.onExit();
        this.state = ModuleState.Ready;
    }

    public async __yzforgeUnload(): Promise<void> {
        this.state = ModuleState.Unloading;
        for (const flow of Array.from(this.flows.values()).reverse()) {
            flow.onDispose();
        }
        this.flows.clear();
        for (const service of Array.from(this.services.values()).reverse()) {
            service.onDispose();
        }
        this.services.clear();
        for (const model of Array.from(this.models.values()).reverse()) {
            model.onDispose();
        }
        this.models.clear();
        await this.onUnload();
        this.event.clear();
        this.state = ModuleState.Unloaded;
    }

    protected onCreate(): MaybePromise<void> {}
    protected onLoad(): MaybePromise<void> {}
    protected onEnter(_params?: TEnter): MaybePromise<void> {}
    protected onPause(): MaybePromise<void> {}
    protected onResume(): MaybePromise<void> {}
    protected onExit(): MaybePromise<void> {}
    protected onUnload(): MaybePromise<void> {}

    private requireContext(): ModuleRuntimeContext {
        if (!this.context) {
            throw new YZForgeError('Module has not been bound to an App context.', 'module.context_missing');
        }
        return this.context;
    }
}

export abstract class ModuleUnit {
    private owner?: Module;

    public get module(): Module {
        if (!this.owner) {
            throw new YZForgeError('Module unit has not been bound.', 'module_unit.context_missing');
        }
        return this.owner;
    }

    public get app(): App {
        return this.module.app;
    }

    public __yzforgeBind(module: Module): void {
        this.owner = module;
    }

    public onCreate(): void {}
    public onDispose(): void {}
}

export abstract class Model extends ModuleUnit {}
export abstract class Service extends ModuleUnit {}
export abstract class Flow extends ModuleUnit {}
