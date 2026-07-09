import { BundleManager } from './bundle-manager';
import { normalizeAppBootProfile, type AppBootProfile } from './boot';
import { ConfigManager } from './config';
import { EntryRegistry, getDefaultEntryRegistry } from './entry-registry';
import { ExtensionRegistry } from './extension-registry';
import { GlobalRoot } from './global-root';
import { LibraryRegistry } from './library';
import { AppLifecycle } from './lifecycle';
import { OwnershipLedger, ReleaseScope } from './lifetime';
import { Logger } from './logger';
import { ModuleNavigator } from './navigator';
import { SharedRegistry } from './shared-registry';
import { UIManager } from './ui';
import { ViewportManager } from './viewport';
import type { App, AppOptions } from './app';
import type { MainBinding } from './main-binding';

export class AppKernel {
    public readonly logger: Logger;
    public readonly boot: AppBootProfile;
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

    public constructor(app: App, options: AppOptions = {}) {
        this.boot = normalizeAppBootProfile(options.boot);
        this.logger = options.logger ?? new Logger();
        this.entries = options.entries ?? getDefaultEntryRegistry();
        this.ownership = new OwnershipLedger();
        this.releaseScope = new ReleaseScope('app', 'root', this.ownership);
        this.configs = new ConfigManager();
        this.bundles = new BundleManager(this.logger.child('bundle'), {}, this.ownership);
        this.shared = new SharedRegistry();
        this.libraries = new LibraryRegistry(this);
        this.global = new GlobalRoot(app);
        this.lifecycle = new AppLifecycle();
        this.viewport = new ViewportManager();
        this.ui = new UIManager({}, this.ownership);
        this.extensions = new ExtensionRegistry(app, this.logger.child('extension'), { systemUI: this.ui.system });
        this.navigator = new ModuleNavigator(app);
    }
}
