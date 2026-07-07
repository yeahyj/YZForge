import type { Node } from 'cc';
import { BundleManager, type BundleRecordSnapshot } from './bundle-manager';
import { ModuleAssets } from './assets';
import type { AssetScopeSnapshot } from './assets';
import { ConfigManager } from './config';
import { ContentPackManager, type ContentPackRecordSnapshot } from './content-pack';
import { EntryRegistry, getDefaultEntryRegistry } from './entry-registry';
import { ExtensionRegistry } from './extension-registry';
import { GlobalRoot } from './global-root';
import { LibraryRegistry, type LibraryRecordSnapshot, ModuleLibraryManager } from './library';
import { OwnershipLedger, ReleaseScope, type OwnershipLedgerSnapshot, type ReleaseScopeSnapshot } from './lifetime';
import { Logger } from './logger';
import type { LoadedModule, Module } from './module';
import { ModuleState } from './module';
import { ModuleNavigator, type EnterModuleOptions, type NavigatorSnapshot } from './navigator';
import type { ModuleRef } from './refs';
import { SharedRegistry } from './shared-registry';
import type { ExtensionToken } from './tokens';
import { UIManager, type UISnapshot } from './ui';
import { AppLifecycle } from './lifecycle';
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

export interface ModuleRuntimeSnapshot {
    readonly name: string;
    readonly bundleName: string;
    readonly state: string;
    readonly assets: AssetScopeSnapshot;
    readonly contentPacks: readonly ContentPackRecordSnapshot[];
}

export interface AppRuntimeSnapshot {
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
    public readonly logger: Logger;
    public readonly entries: EntryRegistry;
    public readonly ownership: OwnershipLedger;
    public readonly releaseScope: ReleaseScope;
    public readonly configs: ConfigManager;
    public readonly bundles: BundleManager;
    public readonly shared: SharedRegistry;
    public readonly libraries: LibraryRegistry;
    public readonly extensions: ExtensionRegistry;
    public readonly global: GlobalRoot;
    public readonly lifecycle: AppLifecycle;
    public readonly ui: UIManager;
    public readonly navigator: ModuleNavigator;
    public viewport: ViewportManager;
    public main?: MainBinding;
    private readonly modules = new Map<string, LoadedModule>();
    private readonly moduleTasks = new Map<string, Promise<LoadedModule>>();
    private readonly moduleUnloadTasks = new Map<string, Promise<void>>();
    private readonly preloadScopes = new Map<string, ReleaseScope>();
    private beforeFirstModuleExtensionsTask?: Promise<void>;
    private disposeViewportChanged?: () => void;

    public constructor(options: AppOptions = {}) {
        this.logger = options.logger ?? new Logger();
        this.entries = options.entries ?? getDefaultEntryRegistry();
        this.ownership = new OwnershipLedger();
        this.releaseScope = new ReleaseScope('app', 'root', this.ownership);
        this.configs = new ConfigManager();
        this.bundles = new BundleManager(this.logger.child('bundle'), {}, this.ownership);
        this.shared = new SharedRegistry();
        this.libraries = new LibraryRegistry(this);
        this.extensions = new ExtensionRegistry(this, this.logger.child('extension'));
        this.global = new GlobalRoot(this);
        this.lifecycle = new AppLifecycle();
        this.viewport = new ViewportManager();
        this.ui = new UIManager();
        this.navigator = new ModuleNavigator(this);
    }

    public async start(options: AppStartOptions = {}): Promise<void> {
        await this.extensions.installBeforeStart();
        this.main = createMainBinding({ mainRoot: options.mainRoot });
        this.ui.configureRoots(this.main.layerRoots);
        this.lifecycle.install();
        this.disposeViewportChanged?.();
        this.viewport.dispose();
        this.viewport = new ViewportManager(options.viewport);
        this.disposeViewportChanged = this.viewport.onChanged(() => this.lifecycle.emitViewportChanged());
        this.viewport.initialize();
        await this.extensions.installAfterMainBinding();
        await this.global.initialize();
        this.ui.installBackKeyHandler(async () => this.navigator.back());
        this.logger.info('App started.');
    }

    public async preloadModule<TParams = unknown>(ref: ModuleRef<TParams>): Promise<ReleaseScope> {
        const existing = this.preloadScopes.get(ref.name);
        if (existing && !existing.released) {
            return existing;
        }
        const scope = this.releaseScope.child('preload', ref.name);
        this.preloadScopes.set(ref.name, scope);
        scope.defer(`preload-index:${ref.name}`, () => {
            this.preloadScopes.delete(ref.name);
        });
        try {
            for (const library of ref.libraries) {
                await this.libraries.acquire(library, scope);
            }
            await this.bundles.preloadBundle(ref.bundle, { owner: scope });
            return scope;
        } catch (error) {
            await scope.release({ type: 'preload_failed', module: ref.name });
            throw error;
        }
    }

    public async loadModule<TModule extends Module, TParams = unknown>(
        ref: ModuleRef<TParams>,
    ): Promise<LoadedModule<TModule>> {
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
        return this.navigator.enter(ref, params, options);
    }

    public async unloadModule(ref: ModuleRef): Promise<void> {
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

        await run('navigator.detach', () => this.navigator.detach(handle));
        await run('ui.disposeModule', () => this.ui.disposeModule(ref.name, 'module_unload'));
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
        return this.extensions.use(token);
    }

    public async dispose(reason: unknown = { type: 'app_dispose' }): Promise<void> {
        let failure: unknown;
        const run = async (task: () => Promise<void> | void): Promise<void> => {
            try {
                await task();
            } catch (error) {
                failure = failure ?? error;
            }
        };
        for (const handle of Array.from(this.modules.values()).reverse()) {
            await run(() => this.unloadModule(handle.ref));
        }
        await run(() => this.releaseScope.release(reason));
        await run(() => this.extensions.dispose(reason));
        await run(() => this.global.dispose());
        this.ui.dispose();
        this.disposeViewportChanged?.();
        this.disposeViewportChanged = undefined;
        this.viewport.dispose();
        this.lifecycle.dispose();
        if (failure) {
            throw failure;
        }
    }

    public snapshot(): AppRuntimeSnapshot {
        return {
            viewport: this.viewport.profile,
            releaseScope: this.releaseScope.snapshot(),
            ownership: this.ownership.snapshot(),
            bundles: this.bundles.snapshots(),
            libraries: this.libraries.snapshots(),
            modules: Array.from(this.modules.values()).map((handle) => this.snapshotModule(handle)),
            navigator: this.navigator.snapshot(),
            ui: this.ui.snapshot(),
        };
    }

    private async createModule<TParams>(ref: ModuleRef<TParams>): Promise<LoadedModule> {
        let instance: Module | undefined;
        const moduleScope = this.releaseScope.child('module', ref.name);
        try {
            for (const library of ref.libraries) {
                await this.libraries.acquire(library, moduleScope);
            }

            const bundle = await this.bundles.loadBundle(ref.bundle, { owner: moduleScope });
            const entry = await this.entries.waitForModule(ref);
            this.entries.validateModule(ref, entry);

            instance = new entry.type();
            const assets = new ModuleAssets(
                ref.name,
                bundle,
                this.logger.child(`module:${ref.name}`),
                moduleScope.child('assets', ref.name),
                this.ownership,
            );
            const libraries = new ModuleLibraryManager(this, moduleScope);
            const contentPacks = new ContentPackManager(this, ref.name, moduleScope);
            const ui = this.ui.createForModule(ref.name, instance);
            const config = await this.configs.loadScope(entry.config, assets);

            instance.__yzforgeBind({
                app: this,
                ref,
                assets,
                config,
                libraries,
                contentPacks,
                ui,
                logger: this.logger.child(`module:${ref.name}`),
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
            await this.ui.disposeModule(ref.name, 'module_load_failed');
            await instance?.contentPacks.unloadAll?.();
            await moduleScope.release({ type: 'module_load_failed', module: ref.name });
            throw error;
        }
    }

    private async ensureBeforeFirstModuleExtensions(): Promise<void> {
        if (!this.beforeFirstModuleExtensionsTask) {
            this.beforeFirstModuleExtensionsTask = this.extensions.installBeforeFirstModule();
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
