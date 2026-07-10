import type { Node } from 'cc';
import type { AppBootProfile, AppBootProfileInput } from './boot';
import type { BundleRecordSnapshot } from './bundle-manager';
import type { AppClock, AppClockSnapshot } from './clock';
import { ModuleAssets } from './assets';
import type { AssetScopeSnapshot } from './assets';
import type { ConfigScope } from './config';
import { ContentPackManager, type ContentPackRecordSnapshot } from './content-pack';
import type { Extension } from './extension-registry';
import { AppKernel } from './kernel';
import { type LibraryRecordSnapshot, ModuleLibraryManager } from './library';
import { type OwnerIdentity, type OwnershipLedgerSnapshot, type OwnershipRecordSnapshot, type OwnershipScopeSnapshot, type ReleaseScope, type ReleaseScopeSnapshot } from './lifetime';
import type { AppLifecycleReader } from './lifecycle';
import type { Logger } from './logger';
import type { Module, ModuleLease } from './module';
import { bindModuleRuntime, createModuleRuntime, disposeModuleRuntime, loadModuleRuntime } from './module';
import type { EnterModuleOptions, NavigatorSnapshot } from './navigator';
import type { ModuleRef } from './refs';
import type { AppStorage, AppStorageSnapshot, AppStorageUserOptions } from './storage';
import type { ExtensionToken, ModuleExtensionToken } from './tokens';
import type { UISnapshot } from './ui';
import { createMainBinding, type MainBinding } from './main-binding';
import { installViewportBridge, ViewportController, type DeviceProfile, type ViewportConfig, type ViewportReader } from './viewport';
import { YZForgeError } from './errors';
import type { EntryResidencySnapshot } from './entry-registry';
import { CompensationStack, runCleanupSteps } from './compensation';

export interface AppOptions {
    readonly logger?: Logger;
    readonly boot?: AppBootProfileInput;
    readonly storage?: AppStorageUserOptions;
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
    readonly leaseCount: number;
    readonly assets: AssetScopeSnapshot;
    readonly contentPacks: readonly ContentPackRecordSnapshot[];
}

export interface ModulePreloadLease {
    readonly leaseId: string;
    readonly ref: ModuleRef;
    readonly released: boolean;
    release(reason?: unknown): Promise<void>;
}

export type ResourceDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ResourceDiagnosticDetail {
    readonly code: string;
    readonly severity: ResourceDiagnosticSeverity;
    readonly message: string;
    readonly ownerId?: string;
    readonly ownerPath?: string;
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
    readonly boot: AppBootProfile;
    readonly clock: AppClockSnapshot;
    readonly storage: AppStorageSnapshot;
    readonly lastFailure?: AppFailureSnapshot;
    readonly viewport: DeviceProfile;
    readonly releaseScope: ReleaseScopeSnapshot;
    readonly ownership: OwnershipLedgerSnapshot;
    readonly bundles: readonly BundleRecordSnapshot[];
    readonly entries: readonly EntryResidencySnapshot[];
    readonly resourceDiagnostics: ResourceDiagnosticsSnapshot;
    readonly libraries: readonly LibraryRecordSnapshot[];
    readonly modules: readonly ModuleRuntimeSnapshot[];
    readonly navigator: NavigatorSnapshot;
    readonly ui: UISnapshot;
}

interface ModuleRecord<TParams = unknown, TConfig extends object = object> {
    readonly ref: ModuleRef<TParams, TConfig>;
    readonly bundleName: string;
    readonly instance: Module<TParams, TConfig>;
    readonly assets: ModuleAssets;
    readonly config: ConfigScope<TConfig>;
    readonly contentPacks: ContentPackManager;
    readonly scope: ReleaseScope;
    readonly leases: Set<ModuleLease>;
}

export class App {
    private readonly kernel: AppKernel;
    private readonly modules = new Map<string, ModuleRecord>();
    private readonly moduleReleaseStates = new WeakMap<ModuleLease, { released: boolean }>();
    private readonly moduleTasks = new Map<string, Promise<ModuleRecord>>();
    private readonly moduleUnloadTasks = new Map<string, Promise<void>>();
    private readonly preloadLeases = new Map<string, Set<ModulePreloadLeaseImpl>>();
    private nextPreloadLeaseId = 0;
    private nextModuleLeaseId = 0;
    private readonly stateTransitions: AppStateTransitionSnapshot[] = [];
    private beforeFirstModuleExtensionsTask?: Promise<void>;
    private disposeViewportChanged?: () => void;
    private disposeViewportBridge?: () => void;
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

    public get lifecycle(): AppLifecycleReader {
        return this.kernel.lifecycle;
    }

    public get viewport(): ViewportReader {
        return this.kernel.viewport;
    }

    public get state(): AppState {
        return this.appState;
    }

    public get boot(): AppBootProfile {
        return this.kernel.boot;
    }

    public get clock(): AppClock {
        return this.kernel.clock;
    }

    public get storage(): AppStorage {
        return this.kernel.storage;
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
        kernel.viewport = new ViewportController(options.viewport);
        this.disposeViewportBridge?.();
        this.disposeViewportBridge = installViewportBridge(kernel.viewport);
        this.disposeViewportChanged = kernel.viewport.onChanged(() => kernel.lifecycle.emitViewportChanged());
        kernel.viewport.initialize();
        await kernel.extensions.installAfterMainBinding();
        await kernel.global.initialize();
        kernel.ui.installBackKeyHandler(async () => this.back());
        kernel.logger.info('App started.');
    }

    public async preloadModule<TParams = unknown>(ref: ModuleRef<TParams>): Promise<ModulePreloadLease> {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('preloadModule', [AppState.Started]);
            return await this.preloadModuleNow(ref);
        } catch (error) {
            this.recordFailure('preloadModule', error, transitionStart);
            throw error;
        }
    }

    private async preloadModuleNow<TParams = unknown>(ref: ModuleRef<TParams>): Promise<ModulePreloadLease> {
        const kernel = this.kernel;
        const transaction = new CompensationStack(`module.preload:${ref.name}`);
        const scope = kernel.releaseScope.child('module-preload', ref.name);
        transaction.defer('release preload scope', (reason) => scope.release(reason));
        try {
            for (const library of ref.libraries) {
                await kernel.libraries.acquire(library, scope);
            }
            await kernel.bundles.preloadBundle(ref.bundle, scope);
            const lease = new ModulePreloadLeaseImpl(
                `module-preload-lease-${++this.nextPreloadLeaseId}`,
                ref,
                scope,
                () => this.removePreloadLease(ref.name, lease),
            );
            let leases = this.preloadLeases.get(ref.name);
            if (!leases) {
                leases = new Set();
                this.preloadLeases.set(ref.name, leases);
            }
            leases.add(lease);
            transaction.commit();
            return lease;
        } catch (error) {
            return await transaction.fail(error, { type: 'preload_failed', module: ref.name });
        }
    }

    public async loadModule<
        TParams = unknown,
        TConfig extends object = object,
        TModule extends Module<TParams, TConfig> = Module<TParams, TConfig>,
    >(
        ref: ModuleRef<TParams, TConfig>,
    ): Promise<ModuleLease<TModule, TConfig>> {
        const transitionStart = this.stateTransitions.length;
        try {
            this.assertState('loadModule', [AppState.Started]);
            const unloading = this.moduleUnloadTasks.get(ref.name);
            if (unloading) {
                await unloading;
            }
            const existing = this.modules.get(ref.name);
            if (existing) {
                return this.createModuleLease(existing) as ModuleLease<TModule, TConfig>;
            }
            const running = this.moduleTasks.get(ref.name);
            if (running) {
                return this.createModuleLease(await running) as ModuleLease<TModule, TConfig>;
            }

            await this.ensureBeforeFirstModuleExtensions();
            const task = this.createModule(ref);
            this.moduleTasks.set(ref.name, task);
            try {
                return this.createModuleLease(await task) as ModuleLease<TModule, TConfig>;
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
    ): Promise<ModuleLease<TModule, TConfig>> {
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
        const record = this.modules.get(ref.name);
        if (!record) {
            return;
        }
        for (const lease of record.leases) {
            const releaseState = this.moduleReleaseStates.get(lease);
            if (releaseState) {
                releaseState.released = true;
            }
        }
        record.leases.clear();
        const failures: Array<{ readonly step: string; readonly error: unknown }> = [];
        const run = async (step: string, task: () => Promise<void>): Promise<void> => {
            try {
                await task();
            } catch (error) {
                failures.push({ step, error });
            }
        };

        await run('navigator.detach', () => kernel.navigator.detachModule(record.instance));
        await run('ui.disposeModule', () => kernel.ui.disposeModule(ref.name, 'module_unload'));
        await run('contentPacks.releaseAll', () => record.contentPacks.releaseAll({ type: 'module_unload', module: ref.name }));
        await run('module.dispose', () => disposeModuleRuntime(record.instance));
        await run('releaseScope.release', () => record.scope.release({ type: 'module_unload', module: ref.name }));
        await run('preloadLeases.release', () => this.releasePreloads(ref.name, { type: 'module_unload', module: ref.name }));
        if (this.modules.get(ref.name) === record) {
            this.modules.delete(ref.name);
        }
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
        await run(() => this.releaseAllPreloads(reason));
        await run(() => kernel.releaseScope.release(reason));
        await run(() => kernel.extensions.dispose(reason));
        await run(() => kernel.global.dispose());
        await run(() => kernel.ui.dispose());
        await run(() => {
            this.disposeViewportChanged?.();
            this.disposeViewportChanged = undefined;
        });
        await run(() => {
            this.disposeViewportBridge?.();
            this.disposeViewportBridge = undefined;
        });
        await run(() => kernel.viewport.dispose());
        await run(() => kernel.lifecycle.dispose());
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
            boot: kernel.boot,
            clock: kernel.clock.snapshot(),
            storage: kernel.storage.snapshot(),
            lastFailure: this.lastFailure,
            viewport: kernel.viewport.profile,
            releaseScope: kernel.releaseScope.snapshot(),
            ownership,
            bundles,
            entries: kernel.entries.snapshot(new Set(bundles.filter((bundle) => bundle.loaded).map((bundle) => bundle.name))),
            resourceDiagnostics: this.snapshotResourceDiagnostics(ownership, bundles),
            libraries: kernel.libraries.snapshots(),
            modules: Array.from(this.modules.values()).map((record) => this.snapshotModule(record)),
            navigator: kernel.navigator.snapshot(),
            ui: kernel.ui.snapshot(),
        };
    }

    private async createModule<TParams, TConfig extends object = object>(ref: ModuleRef<TParams, TConfig>): Promise<ModuleRecord<TParams, TConfig>> {
        const kernel = this.kernel;
        const transaction = new CompensationStack(`module.load:${ref.name}`);
        let instance: Module<TParams, TConfig> | undefined;
        const moduleScope = kernel.releaseScope.child('module', ref.name);
        transaction.defer('release module scope', (reason) => moduleScope.release(reason));
        try {
            for (const library of ref.libraries) {
                await kernel.libraries.acquire(library, moduleScope);
            }

            const bundle = await kernel.bundles.loadBundle(ref.bundle, moduleScope);
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

            bindModuleRuntime(instance, {
                app: this,
                ref,
                assets,
                config,
                libraries,
                contentPacks,
                ui,
                logger: kernel.logger.child(`module:${ref.name}`),
            });

            transaction.defer('dispose partial module lifecycle', () => disposeModuleRuntime(instance as Module));
            await createModuleRuntime(instance);
            await loadModuleRuntime(instance);

            const record: ModuleRecord<TParams, TConfig> = {
                ref,
                bundleName: ref.bundle,
                instance,
                assets,
                config,
                contentPacks,
                scope: moduleScope,
                leases: new Set(),
            };
            this.modules.set(ref.name, record);
            transaction.commit();
            try {
                await this.releasePreloads(ref.name, { type: 'module_load_completed', module: ref.name });
            } catch (error) {
                kernel.logger.warn(`Module loaded but preload lease cleanup reported errors: ${ref.name}`, describeError(error));
            }
            return record;
        } catch (error) {
            transaction.defer('dispose module ui', () => kernel.ui.disposeModule(ref.name, 'module_load_failed'));
            return await transaction.fail(error, { type: 'module_load_failed', module: ref.name });
        }
    }

    private async ensureBeforeFirstModuleExtensions(): Promise<void> {
        if (!this.beforeFirstModuleExtensionsTask) {
            this.beforeFirstModuleExtensionsTask = this.kernel.extensions.installBeforeFirstModule();
        }
        await this.beforeFirstModuleExtensionsTask;
    }

    private removePreloadLease(moduleName: string, lease: ModulePreloadLeaseImpl): void {
        const leases = this.preloadLeases.get(moduleName);
        leases?.delete(lease);
        if (leases?.size === 0) {
            this.preloadLeases.delete(moduleName);
        }
    }

    private async releasePreloads(moduleName: string, reason: unknown): Promise<void> {
        const leases = Array.from(this.preloadLeases.get(moduleName) ?? []).reverse();
        this.preloadLeases.delete(moduleName);
        await runCleanupSteps(`module.preload.release:${moduleName}`, leases.map((lease) => ({
            step: `release preload lease:${lease.leaseId}`,
            task: () => lease.release(reason),
        })));
    }

    private async releaseAllPreloads(reason: unknown): Promise<void> {
        const names = Array.from(this.preloadLeases.keys()).reverse();
        await runCleanupSteps('module.preload.releaseAll', names.map((name) => ({
            step: `release module preloads:${name}`,
            task: () => this.releasePreloads(name, reason),
        })));
    }

    private createModuleLease<TParams, TConfig extends object>(
        record: ModuleRecord<TParams, TConfig>,
    ): ModuleLease<Module<TParams, TConfig>, TConfig> {
        if (this.appState !== AppState.Started || this.modules.get(record.ref.name) !== record) {
            throw new YZForgeError(`Module lease acquire was cancelled: ${record.ref.name}`, 'module.acquire_cancelled', {
                module: record.ref.name,
                appState: this.appState,
            });
        }
        const releaseState = { released: false };
        let lease!: ModuleLease<Module<TParams, TConfig>, TConfig>;
        lease = {
            leaseId: `module-lease-${++this.nextModuleLeaseId}`,
            get released(): boolean {
                return releaseState.released;
            },
            ref: record.ref,
            bundleName: record.bundleName,
            instance: record.instance,
            assets: record.assets,
            config: record.config,
            contentPacks: record.contentPacks,
            release: async () => {
                if (releaseState.released) {
                    return;
                }
                releaseState.released = true;
                record.leases.delete(lease);
                if (record.leases.size === 0 && this.modules.get(record.ref.name) === record) {
                    await this.unloadModule(record.ref);
                }
            },
        };
        record.leases.add(lease);
        this.moduleReleaseStates.set(lease, releaseState);
        return lease;
    }

    private snapshotModule(record: ModuleRecord): ModuleRuntimeSnapshot {
        return {
            name: record.ref.name,
            bundleName: record.bundleName,
            state: record.instance.state,
            leaseCount: record.leases.size,
            assets: record.assets.snapshot(),
            contentPacks: record.contentPacks.snapshots(),
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
                ownerId: scope.id,
                ownerPath: scope.path,
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
        const scope = scopes.find((item) => item.id === record.ownerId);
        return {
            code: 'ownership.leak',
            severity: 'error',
            message: `Released scope still holds ${record.kind}: ${record.ownerPath} (${record.ownerId}) -> ${record.key}`,
            ownerId: record.ownerId,
            ownerPath: record.ownerPath,
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

class ModulePreloadLeaseImpl implements ModulePreloadLease {
    private leaseReleased = false;

    public constructor(
        public readonly leaseId: string,
        public readonly ref: ModuleRef,
        private readonly scope: ReleaseScope,
        private readonly onReleased: () => void,
    ) {}

    public get owner(): OwnerIdentity {
        return {
            id: this.scope.ownerId,
            path: this.scope.ownerPath,
            generation: this.scope.generation,
        };
    }

    public get released(): boolean {
        return this.leaseReleased;
    }

    public async release(reason: unknown = { type: 'module_preload_lease_release' }): Promise<void> {
        if (this.leaseReleased) {
            return;
        }
        this.leaseReleased = true;
        try {
            await this.scope.release(reason);
        } finally {
            this.onReleased();
        }
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
