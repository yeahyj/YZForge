import { YZForgeError } from './errors';
import type { ConfigScope } from './config';
import type { LibraryRef, ModuleRef } from './refs';
import type { Constructor } from './types';
import type { Module } from './module';
import type { TokenProvider } from './tokens';

export interface ModuleEntry<TModule extends Module = Module> {
    readonly name: string;
    readonly bundle: string;
    readonly type: Constructor<TModule>;
    readonly assets: unknown;
    readonly config: ConfigScope | Record<string, unknown>;
    readonly libraries: readonly LibraryRef[];
}

export interface LibraryEntry<TTokens extends Record<string, unknown> = Record<string, unknown>> {
    readonly name: string;
    readonly bundle: string;
    readonly assets: unknown;
    readonly config: ConfigScope | Record<string, unknown>;
    readonly libraries: readonly LibraryRef[];
    readonly tokens: { readonly [TKey in keyof TTokens]: TokenProvider<TTokens[TKey]> };
}

export function defineModuleEntry<TModule extends Module>(entry: ModuleEntry<TModule>): ModuleEntry<TModule> {
    return entry;
}

export function defineLibraryEntry<TTokens extends Record<string, unknown>>(
    entry: LibraryEntry<TTokens>,
): LibraryEntry<TTokens> {
    return entry;
}

export class EntryRegistry {
    private readonly modules = new Map<string, ModuleEntry>();
    private readonly libraries = new Map<string, LibraryEntry>();

    public registerModule(entry: ModuleEntry): void {
        this.modules.set(entry.name, entry);
    }

    public registerLibrary(entry: LibraryEntry): void {
        this.libraries.set(entry.name, entry);
    }

    public getModule(name: string): ModuleEntry | undefined {
        return this.modules.get(name);
    }

    public getLibrary(name: string): LibraryEntry | undefined {
        return this.libraries.get(name);
    }

    public async waitForModule(ref: ModuleRef, timeoutMs = 1500): Promise<ModuleEntry> {
        return this.waitFor(() => this.getModule(ref.name), `ModuleEntry missing: ${ref.name}`, timeoutMs);
    }

    public async waitForLibrary(ref: LibraryRef, timeoutMs = 1500): Promise<LibraryEntry> {
        return this.waitFor(() => this.getLibrary(ref.name), `LibraryEntry missing: ${ref.name}`, timeoutMs);
    }

    public validateModule(ref: ModuleRef, entry: ModuleEntry): void {
        this.validateCommon(ref, entry, 'module');
    }

    public validateLibrary(ref: LibraryRef, entry: LibraryEntry): void {
        this.validateCommon(ref, entry, 'library');
    }

    private validateCommon(
        ref: Pick<ModuleRef | LibraryRef, 'name' | 'bundle' | 'libraries'>,
        entry: Pick<ModuleEntry | LibraryEntry, 'name' | 'bundle' | 'libraries'>,
        kind: string,
    ): void {
        if (ref.name !== entry.name || ref.bundle !== entry.bundle) {
            throw new YZForgeError(`${kind} ref and entry mismatch: ${ref.name}`, 'entry.ref_mismatch', {
                ref,
                entry,
            });
        }
        const refLibraries = ref.libraries.map((item) => item.name).sort();
        const entryLibraries = entry.libraries.map((item) => item.name).sort();
        if (refLibraries.join('|') !== entryLibraries.join('|')) {
            throw new YZForgeError(`${kind} libraries mismatch: ${ref.name}`, 'entry.library_mismatch', {
                refLibraries,
                entryLibraries,
            });
        }
    }

    private async waitFor<T>(read: () => T | undefined, message: string, timeoutMs: number): Promise<T> {
        const started = Date.now();
        while (Date.now() - started <= timeoutMs) {
            const value = read();
            if (value) {
                return value;
            }
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
        throw new YZForgeError(message, 'entry.missing');
    }
}

const defaultEntryRegistry = new EntryRegistry();

export function getDefaultEntryRegistry(): EntryRegistry {
    return defaultEntryRegistry;
}

export function registerModuleEntry(entry: ModuleEntry): void {
    defaultEntryRegistry.registerModule(entry);
}

export function registerLibraryEntry(entry: LibraryEntry): void {
    defaultEntryRegistry.registerLibrary(entry);
}
