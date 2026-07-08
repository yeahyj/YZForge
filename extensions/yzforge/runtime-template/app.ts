import type { Node } from 'cc';
import type { BundleRecordSnapshot } from './bundle-manager';
import { ModuleAssets } from './assets';
import type { AssetScopeSnapshot } from './assets';
import { ContentPackManager, type ContentPackRecordSnapshot } from './content-pack';
import type { EntryRegistry } from './entry-registry';
import type { Extension } from './extension-registry';
import { AppKernel } from './kernel';
import { type LibraryRecordSnapshot, ModuleLibraryManager } from './library';
import { type OwnershipLedgerSnapshot, type ReleaseScope, type ReleaseScopeSnapshot } from './lifetime';
import type { AppLifecycle } from './lifecycle';
import type { Logger } from './logger';
import type { LoadedModule, Module } from './module';
import { ModuleState } from './module';
import type { EnterModuleOptions, NavigatorSnapshot } from './navigator';
import type { ModuleRef } from './refs';
import type { ExtensionToken, ModuleExtensionToken } from './tokens';
import type { UISnapshot } from './ui';
import { createMainBinding, type MainBinding } from './main-binding';
import { ViewportManager, type DeviceProfile, type ViewportConfig } from './viewport';
import { YZForgeError } from './errors';

export interface AppOptions {
    readonly logger?: Logger;
    readonly entries?: EntryRegistry;
}

export interface AppStartOptions {
    readonly mainRoot?: Node;
    readonly viewport?: ViewportConfig;
}

export enum AppState {
    Created = 'created',
    Starting = 'starting',
    Started = 'started',
    Disposing = 'disposing',
    Disposed = 'disposed',
    Failed = 'failed',
}

export interface ModuleRuntimeSnapshot {
    readonly name: string;
    readonly bundleName: string;
    readonly state: string;
    readonly assets: AssetScopeSnapshot;
    readonly contentPacks: readonly ContentPackRecordSnapshot[];
}

export interface AppRuntimeSnapshot {
    readonly state: AppState;
    readonly viewport: DeviceProfile;
    readonly releaseScope: ReleaseScopeSnapshot;
    readonly ownership: OwnershipLedgerSnapshot;
    readonly bundles: readonly BundleRecordSnapshot[];
    readonly libraries: readonly LibraryRecordSnapshot[];
    readonly modules: readonly ModuleRuntimeSnapshot[];
    readonly navigator: NavigatorSnapshot;
    readonly ui: UISnapshot;
}

export class App {
    private readonly kernel: AppKernel;
    private readonly modules = new Map<string, LoadedModule>();
    private readonly moduleTasks = new Map<string, Promise<LoadedModule>>();
    private readonly moduleUnloadTasks = new Map<string, Promise<void>>();
    private readonly preloadTasks = new Map<string, Promise<ReleaseScope>>();
    private readonly preloadScopes = new Map<string, ReleaseScope>();
    private beforeFirstModuleExtensionsTask?: Promise<void>;
    private disposeViewportChanged?: () => void;
    private appState = AppState.Created;
    private startTask?: Promise<void>;
    private disposeTask?: Promise<void>;

    public constructor(options: AppOptions = {}) {
        this.kernel = new AppKernel(this, options);
    }

    public get logger(): Logger {
        return this.kernel.logger;
    }

    public get lifecycle(): AppLifecycle {
        return this.kernel.lifecycle;
    }

    public get viewport(): ViewportManager {
        return this.kernel.viewport;
    }

    public get state(): AppState {
        return this.appState;
    }

    public async start(options: AppStartOptions = {}): Promise<void> {
        if (this.startTask) {
            return await this.startTask;
        }
        this.assertState('start', [AppState.Created]);
        this.appState = AppState.Starting;
        const task = this.startNow(options);
        this.startTask = task;
        try {
            await task;
            if (this.appState === AppState.Starting) {
                this.appState = AppState.Started;
            }
        } catch (error) {
            if (this.appState === AppState.Starting) {
                this.appState = AppState.Disposing;
                try {
                    await this.disposeNow({ type: 'app_start_failed', error: describeError(error) }, { awaitStart: false });
                    this.appState = AppState.Disposed;
                } catch (disposeError) {
                    this.appState = AppState.Failed;
                    throw new YZForgeError('App start failed and rollback failed.', 'app.start_failed_rollback_failed', {
                        startError: describeError(error),
                        disposeError: describeError(disposeError),
                    });
                }
            } else if (!this.isCurrentState(AppState.Disposing)) {
                this.appState = AppState.Failed;
            }
            throw error;
        } finally {
            if (this.startTask === task) {
                this.startTask = undefined;
            }
        }
    }

    private async startNow(options: AppStartOptions = {}): Promise<void> {
        const kernel = this.kernel;
        await kernel.extensions.installBeforeStart();
        kernel.main = createMainBinding({ mainRoot: options.mainRoot });
        kernel.ui.configureRoots(kernel.main.layerRoots);
        kernel.lifecycle.install();
        this.disposeViewportChanged?.();
        kernel.viewport.dispose();
        kernel.viewport = new ViewportManager(options.viewport);
        this.disposeViewportChanged = kernel.viewport.onChanged(() => kernel.lifecycle.emitViewportChanged());
        kernel.viewport.initialize();
        await kernel.extensions.installAfterMainBinding();
        await kernel.global.initialize();
        kernel.ui.installBackKeyHandler(async () => kernel.navigator.back());
        kernel.logger.info('App started.');
    }

    public async preloadModule<TParams = unknown>(ref: ModuleRef<TParams>): Promise<ReleaseScope> {
        this.assertState('preloadModule', [AppState.Started]);
        const running = this.preloadTasks.get(ref.name);
        if (running) {
            return await running;
        }
        const existing = this.preloadScopes.get(ref.name);
        if (existing && !existing.released) {
            return existing;
        }
        const task = this.preloadModuleNow(ref);
        this.preloadTasks.set(ref.name, task);
        try {
            return await task;
        } finally {
            if (this.preloadTasks.get(ref.name) === task) {
                this.preloadTasks.delete(ref.name);
            }
        }
    }

    private async preloadModuleNow<TParams = unknown>(ref: ModuleRef<TParams>): Promise<ReleaseScope> {
        const kernel = this.kernel;
        const scope = kernel.releaseScope.child('preload', ref.name);
        this.preloadScopes.set(ref.name, scope);
        scope.defer(`preload-index:${ref.name}`, () => {
            this.preloadScopes.delete(ref.name);
        });
        try {
            for (const library of ref.libraries) {
                await kernel.libraries.acquire(library, scope);
            }
            await kernel.bundles.preloadBundle(ref.bundle, { owner: scope });
            return scope;
        } catch (error) {
            await scope.release({ type: 'preload_failed', module: ref.name });
            throw error;
        }
    }

    public async loadModule<TModule extends Module, TParams = unknown>(
        ref: ModuleRef<TParams>,
    ): Promise<LoadedModule<TModule>> {
        this.assertState('loadModule', [AppState.Started]);
        const unloading = this.moduleUnloadTasks.get(ref.name);
        if (unloading) {
            await unloading;
        }
        const existing = this.modules.get(ref.name);
        if (existing) {
            return existing as LoadedModule<TModule>;
        }
        const running = this.moduleTasks.get(ref.name);
        if (running) {
            return await running as LoadedModule<TModule>;
        }

        await this.ensureBeforeFirstModuleExtensions();
        const task = this.createModule(ref);
        this.moduleTasks.set(ref.name, task);
        try {
            return await task as LoadedModule<TModule>;
        } finally {
            this.moduleTasks.delete(ref.name);
        }
    }

    public async enterModule<TModule extends Module, TParams = unknown>(
        ref: ModuleRef<TParams>,
        params?: TParams,
        options?: EnterModuleOptions,
    ): Promise<LoadedModule<TModule>> {
        this.assertState('enterModule', [AppState.Started]);
        return this.kernel.navigator.enter(ref, params, options);
    }

    public async unloadModule(ref: ModuleRef): Promise<void> {
        this.assertState('unloadModule', [AppState.Started, AppState.Disposing]);
        const running = this.moduleUnloadTasks.get(ref.name);
        if (running) {
            return await running;
        }
        const task = this.unloadModuleNow(ref);
        this.moduleUnloadTasks.set(ref.name, task);
        try {
            await task;
        } finally {
            if (this.moduleUnloadTasks.get(ref.name) === task) {
                this.moduleUnloadTasks.delete(ref.name);
            }
        }
    }

    private async unloadModuleNow(ref: ModuleRef): Promise<void> {
        const kernel = this.kernel;
        const loading = this.moduleTasks.get(ref.name);
        if (!this.modules.has(ref.name) && loading) {
            try {
                await loading;
            } catch (_error) {
                return;
            }
        }
        const handle = this.modules.get(ref.name);
        if (!handle) {
            return;
        }
        if (handle.instance.state === ModuleState.Entering) {
            throw new YZForgeError(`Module cannot be unloaded while entering: ${ref.name}`, 'module.unload_during_enter', {
                module: ref.name,
                state: handle.instance.state,
            });
        }

        const failures: Array<{ readonly step: string; readonly error: unknown }> = [];
        const run = async (step: string, task: () => Promise<void>): Promise<void> => {
            try {
                await task();
            } catch (error) {
                failures.push({ step, error });
            }
        };

        await run('navigator.detach', () => kernel.navigator.detach(handle));
        await run('ui.disposeModule', () => kernel.ui.disposeModule(ref.name, 'module_unload'));
        await run('contentPacks.unloadAll', async () => handle.contentPacks.unloadAll?.());
        await run('module.__yzforgeUnload', () => handle.instance.__yzforgeUnload());
        await run('releaseScope.release', () => handle.releaseScope.release({ type: 'module_unload', module: ref.name }));
        await run('preloadScope.release', async () => this.preloadScopes.get(ref.name)?.release({ type: 'module_unload', module: ref.name }));
        this.modules.delete(ref.name);
        if (failures.length > 0) {
            throw new YZForgeError(`Module unload completed with errors: ${ref.name}`, 'module.unload_failed', {
                module: ref.name,
                failures: failures.map((failure) => ({
                    step: failure.step,
                    error: describeError(failure.error),
                })),
            });
        }
    }

    public use<TValue>(token: ExtensionToken<TValue>): TValue {
        this.assertState('use', [AppState.Starting, AppState.Started, AppState.Disposing]);
        return this.kernel.extensions.use(token);
    }

    public async installExtension(extension: Extension): Promise<void> {
        this.assertState('installExtension', [AppState.Created, AppState.Starting, AppState.Started]);
        await this.kernel.extensions.install(extension);
    }

    public useModuleToken<TValue>(module: Module, token: ModuleExtensionToken<TValue>): TValue {
        this.assertState('useModuleToken', [AppState.Started, AppState.Disposing]);
        return this.kernel.extensions.useModuleToken(module, token);
    }

    public async purgeResourceCache(reason: unknown = { type: 'manual_cache_purge' }): Promise<void> {
        this.assertState('purgeResourceCache', [AppState.Started, AppState.Disposing]);
        await this.kernel.bundles.purgeUnusedBundles(reason);
    }

    public async dispose(reason: unknown = { type: 'app_dispose' }): Promise<void> {
        if (this.appState === AppState.Disposed) {
            return;
        }
        if (this.disposeTask) {
            return await this.disposeTask;
        }
        this.assertState('dispose', [AppState.Created, AppState.Starting, AppState.Started, AppState.Failed]);
        this.appState = AppState.Disposing;
        const task = this.disposeNow(reason);
        this.disposeTask = task;
        try {
            await task;
            this.appState = AppState.Disposed;
        } catch (error) {
            this.appState = AppState.Failed;
            throw error;
        } finally {
            if (this.disposeTask === task) {
                this.disposeTask = undefined;
            }
        }
    }

    private async disposeNow(reason: unknown, options: { readonly awaitStart?: boolean } = {}): Promise<void> {
        if (options.awaitStart !== false) {
            await this.startTask?.catch(() => undefined);
        }
        const kernel = this.kernel;
        let failure: unknown;
        const run = async (task: () => Promise<void> | void): Promise<void> => {
            try {
                await task();
            } catch (error) {
                failure = failure ?? error;
            }
        };
        for (const preloading of Array.from(this.preloadTasks.values())) {
            await run(async () => {
                await preloading;
            });
        }
        for (const loading of Array.from(this.moduleTasks.values())) {
            await run(async () => {
                await loading;
            });
        }
        for (const handle of Array.from(this.modules.values()).reverse()) {
            await run(() => this.unloadModule(handle.ref));
        }
        await run(() => kernel.releaseScope.release(reason));
        await run(() => kernel.extensions.dispose(reason));
        await run(() => kernel.global.dispose());
        kernel.ui.dispose();
        this.disposeViewportChanged?.();
        this.disposeViewportChanged = undefined;
        kernel.viewport.dispose();
        kernel.lifecycle.dispose();
        if (failure) {
            throw failure;
        }
    }

    public snapshot(): AppRuntimeSnapshot {
        const kernel = this.kernel;
        return {
            state: this.appState,
            viewport: kernel.viewport.profile,
            releaseScope: kernel.releaseScope.snapshot(),
            ownership: kernel.ownership.snapshot(),
            bundles: kernel.bundles.snapshots(),
            libraries: kernel.libraries.snapshots(),
            modules: Array.from(this.modules.values()).map((handle) => this.snapshotModule(handle)),
            navigator: kernel.navigator.snapshot(),
            ui: kernel.ui.snapshot(),
        };
    }

    private async createModule<TParams>(ref: ModuleRef<TParams>): Promise<LoadedModule> {
        const kernel = this.kernel;
        let instance: Module | undefined;
        const moduleScope = kernel.releaseScope.child('module', ref.name);
        try {
            for (const library of ref.libraries) {
                await kernel.libraries.acquire(library, moduleScope);
            }

            const bundle = await kernel.bundles.loadBundle(ref.bundle, { owner: moduleScope });
            const entry = await kernel.entries.waitForModule(ref);
            kernel.entries.validateModule(ref, entry);

            instance = new entry.type();
            const assets = new ModuleAssets(
                ref.name,
                bundle,
                kernel.logger.child(`module:${ref.name}`),
                moduleScope.child('assets', ref.name),
                kernel.ownership,
            );
            const libraries = new ModuleLibraryManager(kernel, moduleScope);
            const contentPacks = new ContentPackManager(kernel, ref.name, moduleScope);
            const ui = kernel.ui.createForModule(ref.name, instance, moduleScope);
            const config = await kernel.configs.loadScope(entry.config, assets);

            instance.__yzforgeBind({
                app: this,
                ref,
                assets,
                config,
                libraries,
                contentPacks,
                ui,
                logger: kernel.logger.child(`module:${ref.name}`),
            });

            await instance.__yzforgeCreate();
            await instance.__yzforgeLoad();

            const handle: LoadedModule = {
                ref,
                bundleName: ref.bundle,
                instance,
                assets,
                config,
                contentPacks,
                releaseScope: moduleScope,
                unload: async () => this.unloadModule(ref),
            };
            this.modules.set(ref.name, handle);
            return handle;
        } catch (error) {
            await kernel.ui.disposeModule(ref.name, 'module_load_failed');
            await instance?.contentPacks.unloadAll?.();
            await moduleScope.release({ type: 'module_load_failed', module: ref.name });
            throw error;
        }
    }

    private async ensureBeforeFirstModuleExtensions(): Promise<void> {
        if (!this.beforeFirstModuleExtensionsTask) {
            this.beforeFirstModuleExtensionsTask = this.kernel.extensions.installBeforeFirstModule();
        }
        await this.beforeFirstModuleExtensionsTask;
    }

    private snapshotModule(handle: LoadedModule): ModuleRuntimeSnapshot {
        return {
            name: handle.ref.name,
            bundleName: handle.bundleName,
            state: handle.instance.state,
            assets: handle.assets.snapshot(),
            contentPacks: handle.contentPacks.snapshots?.() ?? [],
        };
    }

    private assertState(api: string, allowed: readonly AppState[]): void {
        for (const state of allowed) {
            if (this.appState === state) {
                return;
            }
        }
        throw new YZForgeError(`App.${api} cannot run while App is ${this.appState}.`, 'app.invalid_state', {
            api,
            state: this.appState,
            allowed,
        });
    }

    private isCurrentState(state: AppState): boolean {
        return this.appState === state;
    }
}

export function createApp(options: AppOptions = {}): App {
    return new App(options);
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
