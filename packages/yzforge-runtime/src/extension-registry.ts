import type { App } from './app';
import { YZForgeError } from './errors';
import { Logger } from './logger';
import type { Module } from './module';
import type { ExtensionToken, ModuleExtensionToken } from './tokens';

export type ExtensionPhase = 'before-start' | 'after-main-binding' | 'before-first-module' | 'dispose';

export interface ExtensionContext {
    readonly app: App;
    readonly lifecycle: App['lifecycle'];
    readonly viewport: App['viewport'];
    readonly logger: Logger;
    readonly phase: ExtensionPhase;
    provide<TValue>(token: ExtensionToken<TValue>, value: TValue): void;
    provideModule<TValue>(
        token: ModuleExtensionToken<TValue>,
        factory: ModuleTokenFactory<TValue>,
    ): void;
}

export interface Extension {
    readonly name: string;
    readonly dependencies?: readonly string[];
    install?(context: ExtensionContext): void | Promise<void>;
    installBeforeStart?(context: ExtensionContext): void | Promise<void>;
    installAfterMainBinding?(context: ExtensionContext): void | Promise<void>;
    installBeforeFirstModule?(context: ExtensionContext): void | Promise<void>;
    dispose?(context: ExtensionContext, reason?: unknown): void | Promise<void>;
    uninstall?(context: ExtensionContext): void | Promise<void>;
}

export type ModuleTokenFactory<TValue> = (module: Module) => TValue;

const INSTALL_PHASES: readonly ExtensionPhase[] = ['before-start', 'after-main-binding', 'before-first-module'];

interface TransactionValue<TValue> {
    readonly hadValue: boolean;
    readonly value?: TValue;
}

interface ExtensionTransaction {
    readonly appValues: Map<string, TransactionValue<unknown>>;
    readonly moduleFactories: Map<string, TransactionValue<ModuleTokenFactory<unknown>>>;
}

interface RollbackFailure {
    readonly extensionName: string;
    readonly error: unknown;
}

export class ExtensionRegistry {
    private readonly appValues = new Map<string, unknown>();
    private readonly moduleFactories = new Map<string, ModuleTokenFactory<unknown>>();
    private readonly installed = new Map<string, Extension>();
    private readonly completedPhases = new Set<ExtensionPhase>();
    private readonly phaseDone = new Map<string, Set<ExtensionPhase>>();
    private readonly disposedExtensions = new Set<string>();
    private disposed = false;

    public constructor(
        private readonly app: App,
        private readonly logger: Logger = new Logger(),
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
        const context = this.createContext('dispose');
        let failure: unknown;
        for (const extension of ordered) {
            if (this.disposedExtensions.has(extension.name)) {
                continue;
            }
            try {
                if (extension.dispose) {
                    await extension.dispose(context, reason);
                } else {
                    await extension.uninstall?.(context);
                }
                this.disposedExtensions.add(extension.name);
                this.logger.info(`Extension disposed: ${extension.name}`);
            } catch (error) {
                failure = failure ?? error;
            }
        }
        this.installed.clear();
        this.phaseDone.clear();
        this.completedPhases.clear();
        this.appValues.clear();
        this.moduleFactories.clear();
        this.disposedExtensions.clear();
        if (failure) {
            throw failure;
        }
    }

    private async runPhase(phase: ExtensionPhase): Promise<void> {
        const transaction = this.createTransaction();
        const context = this.createContext(phase, transaction);
        const completedInPhase: Extension[] = [];
        const markedInPhase: string[] = [];
        for (const extension of this.sortInstalled()) {
            if (this.isPhaseDone(extension.name, phase)) {
                continue;
            }
            const hook = this.phaseHook(extension, phase);
            if (hook) {
                try {
                    await hook.call(extension, context);
                } catch (error) {
                    this.rollbackTransaction(transaction);
                    for (const extensionName of markedInPhase) {
                        this.unmarkPhaseDone(extensionName, phase);
                    }
                    const rollbackFailures = await this.disposeCompletedPhaseExtensions(completedInPhase, phase, extension, error);
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
        phase: ExtensionPhase,
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

    private createContext(phase: ExtensionPhase, transaction?: ExtensionTransaction): ExtensionContext {
        return {
            app: this.app,
            lifecycle: this.app.lifecycle,
            viewport: this.app.viewport,
            logger: this.logger,
            phase,
            provide: (token, value) => transaction
                ? this.provideInTransaction(transaction, token, value)
                : this.provide(token, value),
            provideModule: (token, factory) => transaction
                ? this.provideModuleInTransaction(transaction, token, factory)
                : this.provideModule(token, factory),
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

    private rollbackTransaction(transaction: ExtensionTransaction): void {
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
    }

    private async disposeCompletedPhaseExtensions(
        extensions: readonly Extension[],
        phase: ExtensionPhase,
        failedExtension: Extension,
        cause: unknown,
    ): Promise<RollbackFailure[]> {
        const failures: RollbackFailure[] = [];
        const context = this.createContext('dispose');
        for (const extension of Array.from(extensions).reverse()) {
            if (this.disposedExtensions.has(extension.name)) {
                continue;
            }
            try {
                if (extension.dispose) {
                    await extension.dispose(context, {
                        type: 'extension_phase_rollback',
                        phase,
                        failedExtension: failedExtension.name,
                        cause,
                    });
                } else {
                    await extension.uninstall?.(context);
                }
                this.disposedExtensions.add(extension.name);
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

    private isPhaseDone(extensionName: string, phase: ExtensionPhase): boolean {
        return this.phaseDone.get(extensionName)?.has(phase) ?? false;
    }

    private markPhaseDone(extensionName: string, phase: ExtensionPhase): void {
        let done = this.phaseDone.get(extensionName);
        if (!done) {
            done = new Set();
            this.phaseDone.set(extensionName, done);
        }
        done.add(phase);
    }

    private unmarkPhaseDone(extensionName: string, phase: ExtensionPhase): void {
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
