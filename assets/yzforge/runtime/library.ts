import type { AssetManager } from 'cc';
import { LibraryAssets } from './assets';
import type { App } from './app';
import type { LibraryEntry } from './entry-registry';
import { YZForgeError } from './errors';
import type { LibraryRef } from './refs';
import type { LibraryToken, TokenProvider } from './tokens';

export interface LoadedLibrary<TTokens = unknown> {
    readonly ref: LibraryRef<TTokens>;
    readonly bundleName: string;
    readonly assets: LibraryAssets;
    readonly config: LibraryEntry['config'];
    use<TKey extends keyof TTokens>(token: LibraryToken<TTokens, TKey>): TTokens[TKey];
    unload(): Promise<void>;
}

interface LibraryRecord {
    readonly ref: LibraryRef;
    readonly entry: LibraryEntry;
    readonly bundle: AssetManager.Bundle;
    readonly assets: LibraryAssets;
    readonly handle: LoadedLibrary;
    readonly owners: Set<string>;
    readonly tokenInstances: Map<string, unknown>;
}

export class LibraryRegistry {
    private readonly records = new Map<string, LibraryRecord>();
    private readonly ownerRefs = new Map<string, Set<string>>();
    private readonly inFlight = new Map<string, Promise<LoadedLibrary>>();

    public constructor(private readonly app: App) {}

    public async acquire<TTokens>(
        ref: LibraryRef<TTokens>,
        ownerKey: string,
    ): Promise<LoadedLibrary<TTokens>> {
        const existing = this.records.get(ref.name);
        if (existing) {
            existing.owners.add(ownerKey);
            this.rememberOwner(ownerKey, ref.name);
            return existing.handle as LoadedLibrary<TTokens>;
        }

        const running = this.inFlight.get(ref.name);
        if (running) {
            const handle = await running;
            const record = this.records.get(ref.name);
            record?.owners.add(ownerKey);
            this.rememberOwner(ownerKey, ref.name);
            return handle as LoadedLibrary<TTokens>;
        }

        const task = this.create(ref, ownerKey);
        this.inFlight.set(ref.name, task);
        try {
            return (await task) as LoadedLibrary<TTokens>;
        } finally {
            this.inFlight.delete(ref.name);
        }
    }

    public get<TTokens>(ref: LibraryRef<TTokens>): LoadedLibrary<TTokens> | undefined {
        return this.records.get(ref.name)?.handle as LoadedLibrary<TTokens> | undefined;
    }

    public async releaseOwner(ownerKey: string): Promise<void> {
        const names = this.ownerRefs.get(ownerKey);
        if (!names) {
            return;
        }
        for (const name of Array.from(names)) {
            await this.release(name, ownerKey);
        }
        this.ownerRefs.delete(ownerKey);
    }

    private async create<TTokens>(
        ref: LibraryRef<TTokens>,
        ownerKey: string,
    ): Promise<LoadedLibrary<TTokens>> {
        for (const dependency of ref.libraries) {
            await this.acquire(dependency, `library:${ref.name}`);
        }

        const bundle = await this.app.bundles.loadBundle(ref.bundle);
        const entry = await this.app.entries.waitForLibrary(ref);
        this.app.entries.validateLibrary(ref, entry);

        const tokenInstances = new Map<string, unknown>();
        const assets = new LibraryAssets(ref.name, bundle, this.app.logger.child(`library:${ref.name}`));
        const record = {} as LibraryRecord;
        const handle: LoadedLibrary<TTokens> = {
            ref,
            bundleName: ref.bundle,
            assets,
            config: entry.config,
            use: (token) => this.useToken(record, token),
            unload: async () => this.release(ref.name, ownerKey),
        };
        Object.assign(record, {
            ref,
            entry,
            bundle,
            assets,
            handle,
            owners: new Set<string>([ownerKey]),
            tokenInstances,
        });
        this.records.set(ref.name, record);
        this.rememberOwner(ownerKey, ref.name);
        return handle;
    }

    private useToken<TTokens, TKey extends keyof TTokens>(
        record: LibraryRecord,
        token: LibraryToken<TTokens, TKey>,
    ): TTokens[TKey] {
        if (token.libraryName !== record.ref.name) {
            throw new YZForgeError(`Library token owner mismatch: ${token.id}`, 'library.token_owner_mismatch');
        }
        if (record.tokenInstances.has(token.id)) {
            return record.tokenInstances.get(token.id) as TTokens[TKey];
        }
        const provider = record.entry.tokens[token.key as string] as TokenProvider<TTokens[TKey]> | undefined;
        if (provider === undefined) {
            throw new YZForgeError(`Library token is not provided: ${token.id}`, 'library.token_missing');
        }
        const value = this.resolveProvider(provider);
        record.tokenInstances.set(token.id, value);
        return value as TTokens[TKey];
    }

    private resolveProvider<TValue>(provider: TokenProvider<TValue>): TValue {
        if (typeof provider === 'object' && provider && 'kind' in provider && provider.kind === 'class-token') {
            return new provider.type() as TValue;
        }
        if (typeof provider === 'function') {
            return (provider as () => TValue)();
        }
        return provider as TValue;
    }

    private async release(name: string, ownerKey: string): Promise<void> {
        const record = this.records.get(name);
        if (!record) {
            return;
        }
        record.owners.delete(ownerKey);
        this.ownerRefs.get(ownerKey)?.delete(name);
        if (record.owners.size > 0) {
            return;
        }

        record.assets.releaseAll();
        this.records.delete(name);
        await this.app.bundles.releaseBundle(record.ref.bundle);
        for (const dependency of record.ref.libraries) {
            await this.release(dependency.name, `library:${record.ref.name}`);
        }
    }

    private rememberOwner(ownerKey: string, libraryName: string): void {
        let refs = this.ownerRefs.get(ownerKey);
        if (!refs) {
            refs = new Set();
            this.ownerRefs.set(ownerKey, refs);
        }
        refs.add(libraryName);
    }
}

export class ModuleLibraryManager {
    private readonly ownerKey: string;

    public constructor(
        private readonly app: App,
        private readonly moduleName: string,
    ) {
        this.ownerKey = `module:${moduleName}`;
    }

    public async load<TTokens>(ref: LibraryRef<TTokens>): Promise<LoadedLibrary<TTokens>> {
        return this.app.libraries.acquire(ref, this.ownerKey);
    }

    public async releaseAll(): Promise<void> {
        await this.app.libraries.releaseOwner(this.ownerKey);
    }
}
