import { BundleManager, type BundleRecordSnapshot } from './bundle-manager';
import { ModuleAssets } from './assets';
import type { AssetScopeSnapshot } from './assets';
import { ContentPackManager, type ContentPackRecordSnapshot } from './content-pack';
import { EntryRegistry, getDefaultEntryRegistry } from './entry-registry';
import { ExtensionRegistry } from './extension-registry';
import { GlobalRoot } from './global-root';
import { LibraryRegistry, type LibraryRecordSnapshot, ModuleLibraryManager } from './library';
import { Logger } from './logger';
import type { LoadedModule, Module } from './module';
import { ModuleNavigator, type EnterModuleOptions, type NavigatorSnapshot } from './navigator';
import type { ModuleRef } from './refs';
import { SharedRegistry } from './shared-registry';
import type { ExtensionToken } from './tokens';
import { UIManager, type ViewSnapshot } from './ui';

export interface AppOptions {
    readonly logger?: Logger;
    readonly entries?: EntryRegistry;
}

export interface ModuleRuntimeSnapshot {
    readonly name: string;
    readonly bundleName: string;
    readonly state: string;
    readonly assets: AssetScopeSnapshot;
    readonly contentPacks: readonly ContentPackRecordSnapshot[];
}

export interface AppRuntimeSnapshot {
    readonly bundles: readonly BundleRecordSnapshot[];
    readonly libraries: readonly LibraryRecordSnapshot[];
    readonly modules: readonly ModuleRuntimeSnapshot[];
    readonly navigator: NavigatorSnapshot;
    readonly ui: readonly ViewSnapshot[];
}

export class App {
    public readonly logger: Logger;
    public readonly entries: EntryRegistry;
    public readonly bundles: BundleManager;
    public readonly shared: SharedRegistry;
    public readonly libraries: LibraryRegistry;
    public readonly extensions: ExtensionRegistry;
    public readonly global: GlobalRoot;
    public readonly ui: UIManager;
    public readonly navigator: ModuleNavigator;
    private readonly modules = new Map<string, LoadedModule>();
    private readonly moduleTasks = new Map<string, Promise<LoadedModule>>();

    public constructor(options: AppOptions = {}) {
        this.logger = options.logger ?? new Logger();
        this.entries = options.entries ?? getDefaultEntryRegistry();
        this.bundles = new BundleManager(this.logger.child('bundle'));
        this.shared = new SharedRegistry();
        this.libraries = new LibraryRegistry(this);
        this.extensions = new ExtensionRegistry(this.logger.child('extension'));
        this.global = new GlobalRoot(this);
        this.ui = new UIManager();
        this.navigator = new ModuleNavigator(this);
    }

    public async start(): Promise<void> {
        await this.global.initialize();
        this.ui.installBackKeyHandler(async () => this.navigator.back());
        this.logger.info('App started.');
    }

    public async preloadModule<TParams = unknown>(ref: ModuleRef<TParams>): Promise<void> {
        for (const library of ref.libraries) {
            await this.libraries.acquire(library, `preload:${ref.name}`);
        }
        await this.bundles.preloadBundle(ref.bundle);
    }

    public async loadModule<TModule extends Module, TParams = unknown>(
        ref: ModuleRef<TParams>,
    ): Promise<LoadedModule<TModule>> {
        const existing = this.modules.get(ref.name);
        if (existing) {
            return existing as LoadedModule<TModule>;
        }
        const running = this.moduleTasks.get(ref.name);
        if (running) {
            return await running as LoadedModule<TModule>;
        }

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
        const handle = this.modules.get(ref.name);
        if (!handle) {
            return;
        }
        await this.navigator.detach(handle);
        await this.ui.disposeModule(ref.name, 'module_unload');
        await handle.contentPacks.unloadAll?.();
        await handle.instance.__yzforgeUnload();
        handle.assets.releaseAll();
        await handle.instance.libraries.releaseAll?.();
        await this.libraries.releaseOwner(`preload:${ref.name}`);
        await this.bundles.releaseBundle(ref.bundle);
        this.modules.delete(ref.name);
    }

    public use<TValue>(token: ExtensionToken<TValue>): TValue {
        return this.extensions.use(token);
    }

    public snapshot(): AppRuntimeSnapshot {
        return {
            bundles: this.bundles.snapshots(),
            libraries: this.libraries.snapshots(),
            modules: Array.from(this.modules.values()).map((handle) => this.snapshotModule(handle)),
            navigator: this.navigator.snapshot(),
            ui: this.ui.snapshots(),
        };
    }

    private async createModule<TParams>(ref: ModuleRef<TParams>): Promise<LoadedModule> {
        let bundleLoaded = false;
        let instance: Module | undefined;
        let assets: ModuleAssets | undefined;
        try {
            for (const library of ref.libraries) {
                await this.libraries.acquire(library, `module:${ref.name}`);
            }

            const bundle = await this.bundles.loadBundle(ref.bundle);
            bundleLoaded = true;
            const entry = await this.entries.waitForModule(ref);
            this.entries.validateModule(ref, entry);

            instance = new entry.type();
            assets = new ModuleAssets(ref.name, bundle, this.logger.child(`module:${ref.name}`));
            const libraries = new ModuleLibraryManager(this, ref.name);
            const contentPacks = new ContentPackManager(this, ref.name);
            const ui = this.ui.createForModule(ref.name, instance);

            instance.__yzforgeBind({
                app: this,
                ref,
                assets,
                config: entry.config,
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
                config: entry.config,
                contentPacks,
                unload: async () => this.unloadModule(ref),
            };
            this.modules.set(ref.name, handle);
            return handle;
        } catch (error) {
            await this.ui.disposeModule(ref.name, 'module_load_failed');
            await instance?.contentPacks.unloadAll?.();
            await instance?.libraries.releaseAll?.();
            assets?.releaseAll();
            await this.libraries.releaseOwner(`module:${ref.name}`);
            if (bundleLoaded) {
                await this.bundles.releaseBundle(ref.bundle);
            }
            throw error;
        }
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
