import { YZForgeError } from './errors';
import type { Logger } from './logger';
import type { Module } from './module';
import type { ExtensionToken, ModuleExtensionToken } from './tokens';

export interface Extension {
    readonly name: string;
    readonly dependencies?: readonly string[];
    install(registry: ExtensionRegistry): void | Promise<void>;
    uninstall?(registry: ExtensionRegistry): void | Promise<void>;
}

export type ModuleTokenFactory<TValue> = (module: Module) => TValue;

export class ExtensionRegistry {
    private readonly appValues = new Map<string, unknown>();
    private readonly moduleFactories = new Map<string, ModuleTokenFactory<unknown>>();
    private readonly installed = new Map<string, Extension>();

    public constructor(private readonly logger?: Logger) {}

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
        if (this.installed.has(extension.name)) {
            return;
        }
        await extension.install(this);
        this.installed.set(extension.name, extension);
        this.logger?.info(`Extension installed: ${extension.name}`);
    }
}
