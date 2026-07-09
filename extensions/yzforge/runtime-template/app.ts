import type { Node } from 'cc';
import type { BundleRecordSnapshot } from './bundle-manager';
import { ModuleAssets } from './assets';
import type { AssetScopeSnapshot } from './assets';
import type { ConfigScope } from './config';
import { ContentPackManager, type ContentPackRecordSnapshot } from './content-pack';
import type { EntryRegistry } from './entry-registry';
import type { Extension } from './extension-registry';
import { AppKernel } from './kernel';
import { type LibraryRecordSnapshot, ModuleLibraryManager } from './library';
import { type OwnershipLedgerSnapshot, type OwnershipRecordSnapshot, type OwnershipScopeSnapshot, type ReleaseScope, type ReleaseScopeSnapshot } from './lifetime';
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

export interface AppStateTransitionSnapshot {
    readonly api: string;
    readonly from: AppState;
    readonly to: AppState;
    readonly reason: string;
}

export interface AppFailureSnapshot {
    readonly api: string;
    readonly state: AppState;
    readonly transitions: readonly AppStateTransitionSnapshot[];
    readonly error: unknown;
}

export interface ModuleRuntimeSnapshot {
    readonly name: string;
    readonly bundleName: string;
    readonly state: string;
    readonly assets: AssetScopeSnapshot;
    readonly contentPacks: readonly ContentPackRecordSnapshot[];
}

export type ResourceDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ResourceDiagnosticDetail {
    readonly code: string;
    readonly severity: ResourceDiagnosticSeverity;
    readonly message: string;
    readonly ownerKey?: string;
    readonly kind?: string;
    readonly key?: string;
    readonly count?: number;
    readonly detail?: unknown;
}

export interface ResourceDiagnosticsSnapshot {
    readonly healthy: boolean;
    readonly holdingCount: number;
    readonly leakCount: number;
    readonly failedReleaseCount: number;
    readonly hotBundleCount: number;
    readonly failedBundleCount: number;
    readonly details: readonly ResourceDiagnosticDetail[];
}

export interface AppRuntimeSnapshot {
    readonly state: AppState;
    readonly lastFailure?: AppFailureSnapshot;
    readonly viewport: DeviceProfile;
    readonly releaseScope: ReleaseScopeSnapshot;
    readonly ownership: OwnershipLedgerSnapshot;
    readonly bundles: readonly BundleRecordSnapshot[];
    readonly resourceDiagnostics: ResourceDiagnosticsSnapshot;
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
    private readonly stateTransitions: AppStateTransitionSnapshot[] = [];
    private beforeFirstModuleExtensionsTask?: Promise<void>;
    private disposeViewportChanged?: () => void;
    private disposeMemoryWarning?: () => void;
    private memoryPressurePurgeTask?: Promise<void>;
    private appState = AppState.Created;
    private lastFailure?: AppFailureSnapshot;
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

    public async back(): Promise<boolean> {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('back', [AppState.Started]);
            return await this.kernel.navigator.back();
        } catch (error) {
            this.recordFailure('back', error, transitionStart);
            throw error;
        }
    }

    public async start(options: AppStartOptions = {}): Promise<void> {
        if (this.startTask) {
            return await this.startTask;
        }
        const transitionStart = this.stateTransitions.length;
        this.assertState('start', [AppState.Created]);
        this.setState('start', AppState.Starting, 'start_begin');
        const task = this.startNow(options);
        this.startTask = task;
        try {
            await task;
            if (this.appState === AppState.Starting) {
                this.setState('start', AppState.Started, 'start_completed');
            }
        } catch (error) {
            if (this.appState === AppState.Starting) {
                this.setState('start', AppState.Disposing, 'start_failed_rollback');
                try {
                    await this.disposeNow({ type: 'app_start_failed', error: describeError(error) }, { awaitStart: false });
                    this.setState('start', AppState.Disposed, 'start_failed_rollback_completed');
                } catch (disposeError) {
                    this.setState('start', AppState.Failed, 'start_failed_rollback_failed');
                    const failure = new YZForgeError('App start failed and rollback failed.', 'app.start_failed_rollback_failed', {
                        startError: describeError(error),
                        disposeError: describeError(disposeError),
                    });
                    this.recordFailure('start', failure, transitionStart);
                    throw failure;
                }
            } else if (!this.isCurrentState(AppState.Disposing)) {
                this.setState('start', AppState.Failed, 'start_failed');
            }
            this.recordFailure('start', error, transitionStart);
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
        this.installMemoryPressurePolicy(kernel);
        this.disposeViewportChanged?.();
        kernel.viewport.dispose();
        kernel.viewport = new ViewportManager(options.viewport);
        this.disposeViewportChanged = kernel.viewport.onChanged(() => kernel.lifecycle.emitViewportChanged());
        kernel.viewport.initialize();
        await kernel.extensions.installAfterMainBinding();
        await kernel.global.initialize();
        kernel.ui.installBackKeyHandler(async () => this.back());
        kernel.logger.info('App started.');
    }

    public async preloadModule<TParams = unknown>(ref: ModuleRef<TParams>): Promise<ReleaseScope> {
        const transitionStart = this.stateTransitions.length;
        this.assertState('preloadModule', [AppState.Started]);
        const running = this.preloadTasks.get(ref.name);
        if (running) {
            try {
                return await running;
            } catch (error) {
                this.recordFailure('preloadModule', error, transitionStart);
                throw error;
            }
        }
        const existing = this.preloadScopes.get(ref.name);
        if (existing && !existing.released) {
            return existing;
        }
        const task = this.preloadModuleNow(ref);
        this.preloadTasks.set(ref.name, task);
        try {
            return await task;
        } catch (error) {
            this.recordFailure('preloadModule', error, transitionStart);
            throw error;
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

    public async loadModule<
        TParams = unknown,
        TConfig extends object = object,
        TModule extends Module<TParams, TConfig> = Module<TParams, TConfig>,
    >(
        ref: ModuleRef<TParams, TConfig>,
    ): Promise<LoadedModule<TModule, TConfig>> {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('loadModule', [AppState.Started]);
            const unloading = this.moduleUnloadTasks.get(ref.name);
            if (unloading) {
                await unloading;
            }
            const existing = this.modules.get(ref.name);
            if (existing) {
                return existing as LoadedModule<TModule, TConfig>;
            }
            const running = this.moduleTasks.get(ref.name);
            if (running) {
                return await running as LoadedModule<TModule, TConfig>;
            }

            await this.ensureBeforeFirstModuleExtensions();
            const task = this.createModule(ref);
            this.moduleTasks.set(ref.name, task);
            try {
                return await task as LoadedModule<TModule, TConfig>;
            } finally {
                this.moduleTasks.delete(ref.name);
            }
        } catch (error) {
            this.recordFailure('loadModule', error, transitionStart);
            throw error;
        }
    }

    public async enterModule<
        TParams = unknown,
        TConfig extends object = object,
        TModule extends Module<TParams, TConfig> = Module<TParams, TConfig>,
    >(
        ref: ModuleRef<TParams, TConfig>,
        params?: TParams,
        options?: EnterModuleOptions,
    ): Promise<LoadedModule<TModule, TConfig>> {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('enterModule', [AppState.Started]);
            return await this.kernel.navigator.enter(ref, params, options);
        } catch (error) {
            this.recordFailure('enterModule', error, transitionStart);
            throw error;
        }
    }

    public async unloadModule(ref: ModuleRef): Promise<void> {
        const transitionStart = this.stateTransitions.length;
        try {
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
        } catch (error) {
            this.recordFailure('unloadModule', error, transitionStart);
            throw error;
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
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('use', [AppState.Starting, AppState.Started, AppState.Disposing]);
            return this.kernel.extensions.use(token);
        } catch (error) {
            this.recordFailure('use', error, transitionStart);
            throw error;
        }
    }

    public async installExtension(extension: Extension): Promise<void> {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('installExtension', [AppState.Created, AppState.Starting, AppState.Started]);
            await this.kernel.extensions.install(extension);
        } catch (error) {
            this.recordFailure('installExtension', error, transitionStart);
            throw error;
        }
    }

    public useModuleToken<TValue>(module: Module, token: ModuleExtensionToken<TValue>): TValue {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('useModuleToken', [AppState.Started, AppState.Disposing]);
            return this.kernel.extensions.useModuleToken(module, token);
        } catch (error) {
            this.recordFailure('useModuleToken', error, transitionStart);
            throw error;
        }
    }

    public async purgeResourceCache(reason: unknown = { type: 'manual_cache_purge' }): Promise<void> {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('purgeResourceCache', [AppState.Started, AppState.Disposing]);
            await this.kernel.bundles.purgeUnusedBundles(reason);
        } catch (error) {
            this.recordFailure('purgeResourceCache', error, transitionStart);
            throw error;
        }
    }

    public async dispose(reason: unknown = { type: 'app_dispose' }): Promise<void> {
        if (this.appState === AppState.Disposed) {
            return;
        }
        if (this.disposeTask) {
            return await this.disposeTask;
        }
        const transitionStart = this.stateTransitions.length;
        this.assertState('dispose', [AppState.Created, AppState.Starting, AppState.Started, AppState.Failed]);
        this.setState('dispose', AppState.Disposing, 'dispose_begin');
        const task = this.disposeNow(reason);
        this.disposeTask = task;
        try {
            await task;
            this.setState('dispose', AppState.Disposed, 'dispose_completed');
        } catch (error) {
            this.setState('dispose', AppState.Failed, 'dispose_failed');
            this.recordFailure('dispose', error, transitionStart);
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
        this.disposeMemoryWarning?.();
        this.disposeMemoryWarning = undefined;
        await run(async () => {
            await this.memoryPressurePurgeTask;
        });
        this.memoryPressurePurgeTask = undefined;
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
        const ownership = kernel.ownership.snapshot();
        const bundles = kernel.bundles.snapshots();
        return {
            state: this.appState,
            lastFailure: this.lastFailure,
            viewport: kernel.viewport.profile,
            releaseScope: kernel.releaseScope.snapshot(),
            ownership,
            bundles,
            resourceDiagnostics: this.snapshotResourceDiagnostics(ownership, bundles),
            libraries: kernel.libraries.snapshots(),
            modules: Array.from(this.modules.values()).map((handle) => this.snapshotModule(handle)),
            navigator: kernel.navigator.snapshot(),
            ui: kernel.ui.snapshot(),
        };
    }

    private async createModule<TParams, TConfig extends object = object>(ref: ModuleRef<TParams, TConfig>): Promise<LoadedModule<Module<TParams, TConfig>, TConfig>> {
        const kernel = this.kernel;
        let instance: Module<TParams, TConfig> | undefined;
        const moduleScope = kernel.releaseScope.child('module', ref.name);
        try {
            for (const library of ref.libraries) {
                await kernel.libraries.acquire(library, moduleScope);
            }

            const bundle = await kernel.bundles.loadBundle(ref.bundle, { owner: moduleScope });
            const entry = await kernel.entries.waitForModule(ref);
            kernel.entries.validateModule(ref, entry);

            const ModuleType = entry.type as new () => Module<TParams, TConfig>;
            instance = new ModuleType();
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
            const config = await kernel.configs.loadScope<TConfig>(entry.config as never, assets) as ConfigScope<TConfig>;

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

            const handle: LoadedModule<Module<TParams, TConfig>, TConfig> = {
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

    private snapshotResourceDiagnostics(
        ownership: OwnershipLedgerSnapshot,
        bundles: readonly BundleRecordSnapshot[],
    ): ResourceDiagnosticsSnapshot {
        const details: ResourceDiagnosticDetail[] = [];
        const leaks = ownership.leaks ?? [];
        for (const record of leaks) {
            details.push(this.describeOwnershipLeak(record, ownership.scopes ?? []));
        }
        for (const scope of ownership.scopes ?? []) {
            if (!scope.lastFailure) {
                continue;
            }
            details.push({
                code: scope.lastFailure.code,
                severity: 'error',
                message: scope.lastFailure.message,
                ownerKey: scope.ownerKey,
                kind: scope.kind,
                key: scope.key,
                detail: {
                    errors: scope.lastFailure.errors,
                },
            });
        }
        for (const bundle of bundles) {
            if (bundle.cacheState === 'failed') {
                details.push({
                    code: 'bundle.cache_failed',
                    severity: 'error',
                    message: `Bundle cache is failed: ${bundle.name}`,
                    key: bundle.name,
                    detail: bundle,
                });
            }
        }

        const failedReleaseCount = (ownership.scopes ?? []).filter((scope) => Boolean(scope.lastFailure)).length;
        const failedBundleCount = bundles.filter((bundle) => bundle.cacheState === 'failed').length;
        return {
            healthy: leaks.length === 0 && failedReleaseCount === 0 && failedBundleCount === 0,
            holdingCount: ownership.holdings.length,
            leakCount: leaks.length,
            failedReleaseCount,
            hotBundleCount: bundles.filter((bundle) => bundle.cacheState === 'hot').length,
            failedBundleCount,
            details,
        };
    }

    private describeOwnershipLeak(
        record: OwnershipRecordSnapshot,
        scopes: readonly OwnershipScopeSnapshot[],
    ): ResourceDiagnosticDetail {
        const scope = scopes.find((item) => item.ownerKey === record.ownerKey);
        return {
            code: 'ownership.leak',
            severity: 'error',
            message: `Released scope still holds ${record.kind}: ${record.ownerKey} -> ${record.key}`,
            ownerKey: record.ownerKey,
            kind: record.kind,
            key: record.key,
            count: record.count,
            detail: {
                resource: record.detail,
                scope: scope ? {
                    kind: scope.kind,
                    key: scope.key,
                    released: scope.released,
                    lastFailure: scope.lastFailure,
                } : undefined,
            },
        };
    }

    private installMemoryPressurePolicy(kernel: AppKernel): void {
        this.disposeMemoryWarning?.();
        this.disposeMemoryWarning = kernel.lifecycle.on('memory-warning', () => {
            void this.purgeMemoryPressureCache(kernel);
        });
    }

    private async purgeMemoryPressureCache(kernel: AppKernel): Promise<void> {
        if (this.memoryPressurePurgeTask) {
            return await this.memoryPressurePurgeTask;
        }
        const task = this.runMemoryPressurePurge(kernel);
        this.memoryPressurePurgeTask = task;
        return await task;
    }

    private async runMemoryPressurePurge(kernel: AppKernel): Promise<void> {
        try {
            await kernel.bundles.purgeUnusedBundles({ type: 'memory_pressure' });
        } catch (error) {
            kernel.logger.warn('Memory pressure cache purge failed.', describeError(error));
        } finally {
            this.memoryPressurePurgeTask = undefined;
        }
    }

    private assertState(api: string, allowed: readonly AppState[]): void {
        for (const state of allowed) {
            if (this.appState === state) {
                return;
            }
        }
        const error = new YZForgeError(`App.${api} cannot run while App is ${this.appState}.`, 'app.invalid_state', {
            api,
            state: this.appState,
            allowed,
        });
        this.recordFailure(api, error, this.stateTransitions.length);
        throw error;
    }

    private setState(api: string, to: AppState, reason: string): void {
        const from = this.appState;
        if (from === to) {
            return;
        }
        this.appState = to;
        this.stateTransitions.push({ api, from, to, reason });
        if (this.stateTransitions.length > 32) {
            this.stateTransitions.shift();
        }
    }

    private recordFailure(api: string, error: unknown, transitionStart: number): void {
        this.lastFailure = {
            api,
            state: this.appState,
            transitions: this.stateTransitions.slice(transitionStart),
            error: describeError(error),
        };
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
