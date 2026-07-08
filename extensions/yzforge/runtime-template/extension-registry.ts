import type { App } from './app';
import { configCodecs } from './config';
import type { ConfigCodec } from './config';
import { YZForgeError } from './errors';
import type { AppLifecycleEvents } from './lifecycle';
import { Logger } from './logger';
import type { Module } from './module';
import type { SystemUIProvider } from './system-ui';
import type { ExtensionToken, ModuleExtensionToken } from './tokens';

export type ExtensionInstallPhase = 'before-start' | 'after-main-binding' | 'before-first-module';
export type ExtensionPhase = ExtensionInstallPhase | 'dispose';

export interface ExtensionPhaseRollbackReason {
    readonly type: 'extension_phase_rollback';
    readonly phase: ExtensionInstallPhase;
    readonly failedExtension: string;
    readonly cause: unknown;
}

export interface ExtensionAppServiceOptions<TValue> {
    dispose?(value: TValue): void;
}

export interface ExtensionContext {
    readonly app: App;
    readonly viewport: App['viewport'];
    readonly logger: Logger;
    readonly phase: ExtensionPhase;
    provide<TValue>(token: ExtensionToken<TValue>, value: TValue): void;
    provideModule<TValue>(
        token: ModuleExtensionToken<TValue>,
        factory: ModuleTokenFactory<TValue>,
    ): void;
    onLifecycle<TKey extends keyof AppLifecycleEvents>(
        event: TKey,
        handler: (payload: AppLifecycleEvents[TKey]) => void,
    ): () => void;
    registerConfigCodec(codec: ConfigCodec): () => void;
    registerAppService<TValue>(
        token: ExtensionToken<TValue>,
        value: TValue,
        options?: ExtensionAppServiceOptions<TValue>,
    ): () => void;
    registerSystemUIProvider(provider: SystemUIProvider): () => void;
}

export interface Extension {
    readonly name: string;
    readonly dependencies?: readonly string[];
    install?(context: ExtensionContext): void | Promise<void>;
    installBeforeStart?(context: ExtensionContext): void | Promise<void>;
    installAfterMainBinding?(context: ExtensionContext): void | Promise<void>;
    installBeforeFirstModule?(context: ExtensionContext): void | Promise<void>;
    rollbackBeforeStart?(context: ExtensionContext, reason: ExtensionPhaseRollbackReason): void | Promise<void>;
    rollbackAfterMainBinding?(context: ExtensionContext, reason: ExtensionPhaseRollbackReason): void | Promise<void>;
    rollbackBeforeFirstModule?(context: ExtensionContext, reason: ExtensionPhaseRollbackReason): void | Promise<void>;
    dispose?(context: ExtensionContext, reason?: unknown): void | Promise<void>;
    uninstall?(context: ExtensionContext): void | Promise<void>;
}

export type ModuleTokenFactory<TValue> = (module: Module) => TValue;

const INSTALL_PHASES: readonly ExtensionInstallPhase[] = ['before-start', 'after-main-binding', 'before-first-module'];

interface TransactionValue<TValue> {
    readonly hadValue: boolean;
    readonly value?: TValue;
}

interface ExtensionTransaction {
    readonly appValues: Map<string, TransactionValue<unknown>>;
    readonly moduleFactories: Map<string, TransactionValue<ModuleTokenFactory<unknown>>>;
    readonly lifecycleDisposers: TransactionDisposer[];
    readonly configCodecDisposers: TransactionDisposer[];
    readonly appServiceDisposers: TransactionDisposer[];
    readonly systemUiProviderDisposers: TransactionDisposer[];
}

interface TransactionDisposer {
    readonly extensionName: string;
    readonly dispose: () => void;
}

interface RollbackFailure {
    readonly extensionName: string;
    readonly error: unknown;
}

export interface ExtensionRegistryOptions {
    readonly systemUI?: {
        registerProvider(provider: SystemUIProvider): () => void;
    };
}

export class ExtensionRegistry {
    private readonly appValues = new Map<string, unknown>();
    private readonly moduleFactories = new Map<string, ModuleTokenFactory<unknown>>();
    private readonly installed = new Map<string, Extension>();
    private readonly completedPhases = new Set<ExtensionInstallPhase>();
    private readonly phaseDone = new Map<string, Set<ExtensionInstallPhase>>();
    private readonly lifecycleDisposers = new Map<string, Set<() => void>>();
    private readonly configCodecDisposers = new Map<string, Set<() => void>>();
    private readonly appServiceDisposers = new Map<string, Set<() => void>>();
    private readonly systemUiProviderDisposers = new Map<string, Set<() => void>>();
    private readonly disposedExtensions = new Set<string>();
    private disposed = false;

    public constructor(
        private readonly app: App,
        private readonly logger: Logger = new Logger(),
        private readonly options: ExtensionRegistryOptions = {},
    ) {}

    public provide<TValue>(token: ExtensionToken<TValue>, value: TValue): void {
        this.appValues.set(token.id, value);
    }

    public provideModule<TValue>(
        token: ModuleExtensionToken<TValue>,
        factory: ModuleTokenFactory<TValue>,
    ): void {
        this.moduleFactories.set(token.id, factory as ModuleTokenFactory<unknown>);
    }

    public use<TValue>(token: ExtensionToken<TValue>): TValue {
        if (!this.appValues.has(token.id)) {
            throw new YZForgeError(`Extension token is not registered: ${token.id}`, 'extension.token_missing');
        }
        return this.appValues.get(token.id) as TValue;
    }

    public useModuleToken<TValue>(module: Module, token: ModuleExtensionToken<TValue>): TValue {
        const factory = this.moduleFactories.get(token.id);
        if (!factory) {
            throw new YZForgeError(`Module extension token is not registered: ${token.id}`, 'extension.module_token_missing');
        }
        return factory(module) as TValue;
    }

    public async install(extension: Extension): Promise<void> {
        if (this.disposed) {
            throw new YZForgeError(`Extension registry is disposed: ${extension.name}`, 'extension.registry_disposed');
        }
        if (this.installed.has(extension.name)) {
            return;
        }
        this.installed.set(extension.name, extension);
        try {
            for (const phase of INSTALL_PHASES) {
                if (this.completedPhases.has(phase)) {
                    await this.runPhase(phase);
                }
            }
        } catch (error) {
            this.installed.delete(extension.name);
            this.phaseDone.delete(extension.name);
            this.disposedExtensions.delete(extension.name);
            throw error;
        }
        this.logger.info(`Extension registered: ${extension.name}`);
    }

    public async installBeforeStart(): Promise<void> {
        await this.runPhase('before-start');
    }

    public async installAfterMainBinding(): Promise<void> {
        await this.runPhase('after-main-binding');
    }

    public async installBeforeFirstModule(): Promise<void> {
        await this.runPhase('before-first-module');
    }

    public async dispose(reason?: unknown): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const ordered = this.sortInstalled().reverse();
        let failure: unknown;
        for (const extension of ordered) {
            if (this.disposedExtensions.has(extension.name)) {
                continue;
            }
            try {
                if (extension.dispose) {
                    await extension.dispose(this.createContext('dispose', undefined, extension.name), reason);
                } else {
                    await extension.uninstall?.(this.createContext('dispose', undefined, extension.name));
                }
                this.logger.info(`Extension disposed: ${extension.name}`);
            } catch (error) {
                failure = failure ?? error;
            } finally {
                const sideEffectFailure = this.disposeExtensionSideEffects(extension.name);
                failure = failure ?? sideEffectFailure;
                this.disposedExtensions.add(extension.name);
            }
        }
        this.installed.clear();
        this.phaseDone.clear();
        this.completedPhases.clear();
        this.appValues.clear();
        this.moduleFactories.clear();
        this.lifecycleDisposers.clear();
        this.configCodecDisposers.clear();
        this.appServiceDisposers.clear();
        this.systemUiProviderDisposers.clear();
        this.disposedExtensions.clear();
        if (failure) {
            throw failure;
        }
    }

    private async runPhase(phase: ExtensionInstallPhase): Promise<void> {
        const transaction = this.createTransaction();
        const completedInPhase: Extension[] = [];
        const markedInPhase: string[] = [];
        for (const extension of this.sortInstalled()) {
            if (this.isPhaseDone(extension.name, phase)) {
                continue;
            }
            const hook = this.phaseHook(extension, phase);
            if (hook) {
                const context = this.createContext(phase, transaction, extension.name);
                try {
                    await hook.call(extension, context);
                } catch (error) {
                    const transactionRollbackFailures = this.rollbackTransaction(transaction);
                    for (const extensionName of markedInPhase) {
                        this.unmarkPhaseDone(extensionName, phase);
                    }
                    const rollbackFailures = transactionRollbackFailures.concat(
                        await this.disposeCompletedPhaseExtensions(completedInPhase, phase, extension, error),
                    );
                    throw this.createPhaseError(extension, phase, error, rollbackFailures);
                }
                completedInPhase.push(extension);
                this.logger.info(`Extension phase completed: ${extension.name}/${phase}`);
            }
            this.markPhaseDone(extension.name, phase);
            markedInPhase.push(extension.name);
        }
        this.completedPhases.add(phase);
    }

    private phaseHook(
        extension: Extension,
        phase: ExtensionInstallPhase,
    ): ((context: ExtensionContext) => void | Promise<void>) | undefined {
        if (phase === 'before-start') {
            return extension.installBeforeStart ?? extension.install;
        }
        if (phase === 'after-main-binding') {
            return extension.installAfterMainBinding;
        }
        if (phase === 'before-first-module') {
            return extension.installBeforeFirstModule;
        }
        return undefined;
    }

    private phaseRollbackHook(
        extension: Extension,
        phase: ExtensionInstallPhase,
    ): ((context: ExtensionContext, reason: ExtensionPhaseRollbackReason) => void | Promise<void>) | undefined {
        if (phase === 'before-start') {
            return extension.rollbackBeforeStart;
        }
        if (phase === 'after-main-binding') {
            return extension.rollbackAfterMainBinding;
        }
        if (phase === 'before-first-module') {
            return extension.rollbackBeforeFirstModule;
        }
        return undefined;
    }

    private createContext(
        phase: ExtensionPhase,
        transaction?: ExtensionTransaction,
        extensionName = 'extension',
    ): ExtensionContext {
        return {
            app: this.app,
            viewport: this.app.viewport,
            logger: this.logger,
            phase,
            provide: (token, value) => transaction
                ? this.provideInTransaction(transaction, token, value)
                : this.provide(token, value),
            provideModule: (token, factory) => transaction
                ? this.provideModuleInTransaction(transaction, token, factory)
                : this.provideModule(token, factory),
            onLifecycle: (event, handler) => transaction
                ? this.onLifecycleInTransaction(transaction, extensionName, event, handler)
                : this.trackLifecycleDisposer(extensionName, this.app.lifecycle.on(event, handler)),
            registerConfigCodec: (codec) => transaction
                ? this.registerConfigCodecInTransaction(transaction, extensionName, codec)
                : this.trackConfigCodecDisposer(extensionName, configCodecs.register(codec)),
            registerAppService: (token, value, options) => transaction
                ? this.registerAppServiceInTransaction(transaction, extensionName, token, value, options)
                : this.registerAppServiceForExtension(extensionName, token, value, options),
            registerSystemUIProvider: (provider) => transaction
                ? this.registerSystemUIProviderInTransaction(transaction, extensionName, provider)
                : this.registerSystemUIProviderForExtension(extensionName, provider),
        };
    }

    private createPhaseError(
        extension: Extension,
        phase: ExtensionPhase,
        cause: unknown,
        rollbackFailures: readonly RollbackFailure[] = [],
    ): YZForgeError {
        const dependencyChain = this.dependencyChainFor(extension.name);
        return new YZForgeError(
            `Extension phase failed: ${extension.name}/${phase}. Dependency chain: ${dependencyChain.join(' -> ')}`,
            'extension.phase_failed',
            {
                extensionName: extension.name,
                phase,
                dependencyChain,
                cause,
                ...(rollbackFailures.length > 0
                    ? { rollbackFailures: rollbackFailures.map((failure) => ({
                        extensionName: failure.extensionName,
                        error: describeError(failure.error),
                    })) }
                    : {}),
            },
        );
    }

    private createTransaction(): ExtensionTransaction {
        return {
            appValues: new Map(),
            moduleFactories: new Map(),
            lifecycleDisposers: [],
            configCodecDisposers: [],
            appServiceDisposers: [],
            systemUiProviderDisposers: [],
        };
    }

    private provideInTransaction<TValue>(
        transaction: ExtensionTransaction,
        token: ExtensionToken<TValue>,
        value: TValue,
    ): void {
        if (!transaction.appValues.has(token.id)) {
            transaction.appValues.set(token.id, {
                hadValue: this.appValues.has(token.id),
                value: this.appValues.get(token.id),
            });
        }
        this.provide(token, value);
    }

    private provideModuleInTransaction<TValue>(
        transaction: ExtensionTransaction,
        token: ModuleExtensionToken<TValue>,
        factory: ModuleTokenFactory<TValue>,
    ): void {
        if (!transaction.moduleFactories.has(token.id)) {
            transaction.moduleFactories.set(token.id, {
                hadValue: this.moduleFactories.has(token.id),
                value: this.moduleFactories.get(token.id),
            });
        }
        this.provideModule(token, factory);
    }

    private onLifecycleInTransaction<TKey extends keyof AppLifecycleEvents>(
        transaction: ExtensionTransaction,
        extensionName: string,
        event: TKey,
        handler: (payload: AppLifecycleEvents[TKey]) => void,
    ): () => void {
        const dispose = this.trackLifecycleDisposer(extensionName, this.app.lifecycle.on(event, handler));
        transaction.lifecycleDisposers.push({ extensionName, dispose });
        return dispose;
    }

    private registerConfigCodecInTransaction(
        transaction: ExtensionTransaction,
        extensionName: string,
        codec: ConfigCodec,
    ): () => void {
        const dispose = this.trackConfigCodecDisposer(extensionName, configCodecs.register(codec));
        transaction.configCodecDisposers.push({ extensionName, dispose });
        return dispose;
    }

    private registerAppServiceInTransaction<TValue>(
        transaction: ExtensionTransaction,
        extensionName: string,
        token: ExtensionToken<TValue>,
        value: TValue,
        options?: ExtensionAppServiceOptions<TValue>,
    ): () => void {
        const dispose = this.registerAppServiceForExtension(extensionName, token, value, options);
        transaction.appServiceDisposers.push({ extensionName, dispose });
        return dispose;
    }

    private registerAppServiceForExtension<TValue>(
        extensionName: string,
        token: ExtensionToken<TValue>,
        value: TValue,
        options?: ExtensionAppServiceOptions<TValue>,
    ): () => void {
        if (this.appValues.has(token.id)) {
            throw new YZForgeError(`Extension app service is already registered: ${token.id}`, 'extension.app_service_duplicate', {
                token: token.id,
            });
        }
        this.provide(token, value);
        return this.trackAppServiceDisposer(extensionName, () => {
            if (this.appValues.get(token.id) === value) {
                this.appValues.delete(token.id);
            }
            options?.dispose?.(value);
        });
    }

    private registerSystemUIProviderInTransaction(
        transaction: ExtensionTransaction,
        extensionName: string,
        provider: SystemUIProvider,
    ): () => void {
        const dispose = this.registerSystemUIProviderForExtension(extensionName, provider);
        transaction.systemUiProviderDisposers.push({ extensionName, dispose });
        return dispose;
    }

    private registerSystemUIProviderForExtension(extensionName: string, provider: SystemUIProvider): () => void {
        const systemUI = this.options.systemUI;
        if (!systemUI) {
            throw new YZForgeError('SystemUI provider registry is not available.', 'extension.system_ui_unavailable', {
                provider: provider.name,
            });
        }
        return this.trackSystemUIProviderDisposer(extensionName, systemUI.registerProvider(provider));
    }

    private trackLifecycleDisposer(extensionName: string, dispose: () => void): () => void {
        let active = true;
        const tracked = (): void => {
            if (!active) {
                return;
            }
            active = false;
            dispose();
            const disposers = this.lifecycleDisposers.get(extensionName);
            disposers?.delete(tracked);
            if (disposers?.size === 0) {
                this.lifecycleDisposers.delete(extensionName);
            }
        };
        let disposers = this.lifecycleDisposers.get(extensionName);
        if (!disposers) {
            disposers = new Set();
            this.lifecycleDisposers.set(extensionName, disposers);
        }
        disposers.add(tracked);
        return tracked;
    }

    private trackConfigCodecDisposer(extensionName: string, dispose: () => void): () => void {
        let active = true;
        const tracked = (): void => {
            if (!active) {
                return;
            }
            active = false;
            dispose();
            const disposers = this.configCodecDisposers.get(extensionName);
            disposers?.delete(tracked);
            if (disposers?.size === 0) {
                this.configCodecDisposers.delete(extensionName);
            }
        };
        let disposers = this.configCodecDisposers.get(extensionName);
        if (!disposers) {
            disposers = new Set();
            this.configCodecDisposers.set(extensionName, disposers);
        }
        disposers.add(tracked);
        return tracked;
    }

    private trackAppServiceDisposer(extensionName: string, dispose: () => void): () => void {
        let active = true;
        const tracked = (): void => {
            if (!active) {
                return;
            }
            active = false;
            dispose();
            const disposers = this.appServiceDisposers.get(extensionName);
            disposers?.delete(tracked);
            if (disposers?.size === 0) {
                this.appServiceDisposers.delete(extensionName);
            }
        };
        let disposers = this.appServiceDisposers.get(extensionName);
        if (!disposers) {
            disposers = new Set();
            this.appServiceDisposers.set(extensionName, disposers);
        }
        disposers.add(tracked);
        return tracked;
    }

    private trackSystemUIProviderDisposer(extensionName: string, dispose: () => void): () => void {
        let active = true;
        const tracked = (): void => {
            if (!active) {
                return;
            }
            active = false;
            dispose();
            const disposers = this.systemUiProviderDisposers.get(extensionName);
            disposers?.delete(tracked);
            if (disposers?.size === 0) {
                this.systemUiProviderDisposers.delete(extensionName);
            }
        };
        let disposers = this.systemUiProviderDisposers.get(extensionName);
        if (!disposers) {
            disposers = new Set();
            this.systemUiProviderDisposers.set(extensionName, disposers);
        }
        disposers.add(tracked);
        return tracked;
    }

    private rollbackTransaction(transaction: ExtensionTransaction): RollbackFailure[] {
        const failures: RollbackFailure[] = [];
        for (const [id, previous] of Array.from(transaction.appValues.entries()).reverse()) {
            if (previous.hadValue) {
                this.appValues.set(id, previous.value);
            } else {
                this.appValues.delete(id);
            }
        }
        for (const [id, previous] of Array.from(transaction.moduleFactories.entries()).reverse()) {
            if (previous.hadValue && previous.value) {
                this.moduleFactories.set(id, previous.value);
            } else {
                this.moduleFactories.delete(id);
            }
        }
        for (const item of Array.from(transaction.lifecycleDisposers).reverse()) {
            try {
                item.dispose();
            } catch (error) {
                failures.push({ extensionName: item.extensionName, error });
            }
        }
        for (const item of Array.from(transaction.configCodecDisposers).reverse()) {
            try {
                item.dispose();
            } catch (error) {
                failures.push({ extensionName: item.extensionName, error });
            }
        }
        for (const item of Array.from(transaction.appServiceDisposers).reverse()) {
            try {
                item.dispose();
            } catch (error) {
                failures.push({ extensionName: item.extensionName, error });
            }
        }
        for (const item of Array.from(transaction.systemUiProviderDisposers).reverse()) {
            try {
                item.dispose();
            } catch (error) {
                failures.push({ extensionName: item.extensionName, error });
            }
        }
        return failures;
    }

    private disposeExtensionSideEffects(extensionName: string): unknown {
        const lifecycleFailure = this.disposeExtensionLifecycle(extensionName);
        const codecFailure = this.disposeExtensionConfigCodecs(extensionName);
        const appServiceFailure = this.disposeExtensionAppServices(extensionName);
        const systemUiProviderFailure = this.disposeExtensionSystemUIProviders(extensionName);
        return lifecycleFailure ?? codecFailure ?? appServiceFailure ?? systemUiProviderFailure;
    }

    private disposeExtensionLifecycle(extensionName: string): unknown {
        const disposers = this.lifecycleDisposers.get(extensionName);
        if (!disposers) {
            return undefined;
        }
        let failure: unknown;
        for (const dispose of Array.from(disposers).reverse()) {
            try {
                dispose();
            } catch (error) {
                failure = failure ?? error;
            }
        }
        this.lifecycleDisposers.delete(extensionName);
        return failure;
    }

    private disposeExtensionConfigCodecs(extensionName: string): unknown {
        const disposers = this.configCodecDisposers.get(extensionName);
        if (!disposers) {
            return undefined;
        }
        let failure: unknown;
        for (const dispose of Array.from(disposers).reverse()) {
            try {
                dispose();
            } catch (error) {
                failure = failure ?? error;
            }
        }
        this.configCodecDisposers.delete(extensionName);
        return failure;
    }

    private disposeExtensionAppServices(extensionName: string): unknown {
        const disposers = this.appServiceDisposers.get(extensionName);
        if (!disposers) {
            return undefined;
        }
        let failure: unknown;
        for (const dispose of Array.from(disposers).reverse()) {
            try {
                dispose();
            } catch (error) {
                failure = failure ?? error;
            }
        }
        this.appServiceDisposers.delete(extensionName);
        return failure;
    }

    private disposeExtensionSystemUIProviders(extensionName: string): unknown {
        const disposers = this.systemUiProviderDisposers.get(extensionName);
        if (!disposers) {
            return undefined;
        }
        let failure: unknown;
        for (const dispose of Array.from(disposers).reverse()) {
            try {
                dispose();
            } catch (error) {
                failure = failure ?? error;
            }
        }
        this.systemUiProviderDisposers.delete(extensionName);
        return failure;
    }

    private async disposeCompletedPhaseExtensions(
        extensions: readonly Extension[],
        phase: ExtensionInstallPhase,
        failedExtension: Extension,
        cause: unknown,
    ): Promise<RollbackFailure[]> {
        const failures: RollbackFailure[] = [];
        const rollbackReason: ExtensionPhaseRollbackReason = {
            type: 'extension_phase_rollback',
            phase,
            failedExtension: failedExtension.name,
            cause,
        };
        for (const extension of Array.from(extensions).reverse()) {
            if (this.disposedExtensions.has(extension.name)) {
                continue;
            }
            try {
                const rollbackHook = this.phaseRollbackHook(extension, phase);
                if (rollbackHook) {
                    await rollbackHook.call(extension, this.createContext(phase, undefined, extension.name), rollbackReason);
                    this.logger.info(`Extension phase rolled back: ${extension.name}/${phase}`);
                } else {
                    let lifecycleFailure: unknown;
                    try {
                        if (extension.dispose) {
                            await extension.dispose(this.createContext('dispose', undefined, extension.name), rollbackReason);
                        } else {
                            await extension.uninstall?.(this.createContext('dispose', undefined, extension.name));
                        }
                    } finally {
                        lifecycleFailure = this.disposeExtensionSideEffects(extension.name);
                        this.disposedExtensions.add(extension.name);
                    }
                    if (lifecycleFailure) {
                        throw lifecycleFailure;
                    }
                }
                this.logger.info(`Extension rolled back: ${extension.name}/${phase}`);
            } catch (error) {
                failures.push({ extensionName: extension.name, error });
            }
        }
        return failures;
    }

    private sortInstalled(): Extension[] {
        const sorted: Extension[] = [];
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const visit = (extension: Extension, chain: readonly string[]): void => {
            if (visited.has(extension.name)) {
                return;
            }
            if (visiting.has(extension.name)) {
                const cycleStart = chain.indexOf(extension.name);
                const dependencyChain = cycleStart >= 0
                    ? chain.slice(cycleStart).concat(extension.name)
                    : chain.concat(extension.name);
                throw new YZForgeError(
                    `Extension dependency cycle: ${dependencyChain.join(' -> ')}`,
                    'extension.dependency_cycle',
                    {
                        extensionName: extension.name,
                        dependencyChain,
                    },
                );
            }
            visiting.add(extension.name);
            const nextChain = chain.concat(extension.name);
            for (const dependencyName of extension.dependencies || []) {
                const dependency = this.installed.get(dependencyName);
                if (!dependency) {
                    const dependencyChain = nextChain.concat(dependencyName);
                    throw new YZForgeError(
                        `Extension dependency is not installed: ${dependencyChain.join(' -> ')}`,
                        'extension.dependency_missing',
                        {
                            extensionName: extension.name,
                            missingDependency: dependencyName,
                            dependencyChain,
                        },
                    );
                }
                visit(dependency, nextChain);
            }
            visiting.delete(extension.name);
            visited.add(extension.name);
            sorted.push(extension);
        };
        for (const extension of this.installed.values()) {
            visit(extension, []);
        }
        return sorted;
    }

    private dependencyChainFor(extensionName: string): string[] {
        const chain: string[] = [];
        const visiting = new Set<string>();
        const visit = (name: string): boolean => {
            if (visiting.has(name)) {
                chain.push(name);
                return true;
            }
            const extension = this.installed.get(name);
            if (!extension) {
                chain.push(name);
                return true;
            }
            visiting.add(name);
            chain.push(name);
            const [firstDependency] = extension.dependencies || [];
            if (firstDependency) {
                visit(firstDependency);
            }
            visiting.delete(name);
            return true;
        };
        visit(extensionName);
        return chain;
    }

    private isPhaseDone(extensionName: string, phase: ExtensionInstallPhase): boolean {
        return this.phaseDone.get(extensionName)?.has(phase) ?? false;
    }

    private markPhaseDone(extensionName: string, phase: ExtensionInstallPhase): void {
        let done = this.phaseDone.get(extensionName);
        if (!done) {
            done = new Set();
            this.phaseDone.set(extensionName, done);
        }
        done.add(phase);
    }

    private unmarkPhaseDone(extensionName: string, phase: ExtensionInstallPhase): void {
        const done = this.phaseDone.get(extensionName);
        if (!done) {
            return;
        }
        done.delete(phase);
        if (done.size === 0) {
            this.phaseDone.delete(extensionName);
        }
    }
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
