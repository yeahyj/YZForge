import { LibraryAssets, type AssetScopeSnapshot } from './assets';
import type { ConfigScope } from './config';
import type { BundleAssetAccess } from './bundle-manager';
import type { LibraryEntry } from './entry-registry';
import { YZForgeError } from './errors';
import type { AppKernel } from './kernel';
import { ownerKeyOf, type OwnerRef, type ReleaseScope } from './lifetime';
import type { LibraryRef } from './refs';
import type { LibraryToken, TokenProvider } from './tokens';

export interface LoadedLibrary<TTokens = unknown, TConfig extends object = object> {
    readonly ref: LibraryRef<TTokens, TConfig>;
    readonly bundleName: string;
    readonly assets: LibraryAssets;
    readonly config: ConfigScope<TConfig>;
    use<TKey extends keyof TTokens>(token: LibraryToken<TTokens, TKey>): TTokens[TKey];
    unload(): Promise<void>;
}

export interface LibraryRecordSnapshot {
    readonly name: string;
    readonly bundleName: string;
    readonly owners: readonly string[];
    readonly ownerCount: number;
    readonly dependencies: readonly string[];
    readonly tokenInstanceCount: number;
    readonly assets: AssetScopeSnapshot;
}

interface LibraryRecord {
    readonly ref: LibraryRef;
    readonly entry: LibraryEntry;
    readonly bundle: BundleAssetAccess;
    readonly scope: ReleaseScope;
    readonly assets: LibraryAssets;
    readonly handle: LoadedLibrary;
    readonly owners: Set<string>;
    readonly tokenInstances: Map<string, unknown>;
}

export class LibraryRegistry {
    private readonly records = new Map<string, LibraryRecord>();
    private readonly ownerRefs = new Map<string, Set<string>>();
    private readonly inFlight = new Map<string, Promise<LoadedLibrary>>();

    public constructor(private readonly kernel: AppKernel) {}

    public async acquire<TTokens, TConfig extends object = object>(
        ref: LibraryRef<TTokens, TConfig>,
        owner: OwnerRef,
    ): Promise<LoadedLibrary<TTokens, TConfig>> {
        const ownerKey = ownerKeyOf(owner);
        const existing = this.records.get(ref.name);
        if (existing) {
            this.acquireOwner(existing, owner);
            return existing.handle as LoadedLibrary<TTokens, TConfig>;
        }

        const running = this.inFlight.get(ref.name);
        if (running) {
            const handle = await running;
            const record = this.records.get(ref.name);
            if (record) {
                this.acquireOwner(record, owner);
            }
            return handle as LoadedLibrary<TTokens, TConfig>;
        }

        const task = this.create(ref, owner);
        this.inFlight.set(ref.name, task);
        try {
            return (await task) as LoadedLibrary<TTokens, TConfig>;
        } finally {
            this.inFlight.delete(ref.name);
        }
    }

    public get<TTokens, TConfig extends object = object>(ref: LibraryRef<TTokens, TConfig>): LoadedLibrary<TTokens, TConfig> | undefined {
        return this.records.get(ref.name)?.handle as LoadedLibrary<TTokens, TConfig> | undefined;
    }

    public snapshot(name: string): LibraryRecordSnapshot | undefined {
        const record = this.records.get(name);
        return record ? this.snapshotRecord(record) : undefined;
    }

    public snapshots(): LibraryRecordSnapshot[] {
        return Array.from(this.records.values()).map((record) => this.snapshotRecord(record));
    }

    public async releaseOwner(owner: OwnerRef): Promise<void> {
        const ownerKey = ownerKeyOf(owner);
        const names = this.ownerRefs.get(ownerKey);
        if (!names) {
            return;
        }
        for (const name of Array.from(names)) {
            await this.release(name, ownerKey);
        }
        this.ownerRefs.delete(ownerKey);
    }

    private async create<TTokens, TConfig extends object = object>(
        ref: LibraryRef<TTokens, TConfig>,
        owner: OwnerRef,
    ): Promise<LoadedLibrary<TTokens, TConfig>> {
        const ownerKey = ownerKeyOf(owner);
        const scope = this.kernel.releaseScope.child('library', ref.name);
        let bundle: BundleAssetAccess | undefined;
        try {
            for (const dependency of ref.libraries) {
                await this.acquire(dependency, scope);
            }

            bundle = await this.kernel.bundles.loadBundle(ref.bundle, { owner: scope });
            const entry = await this.kernel.entries.waitForLibrary(ref);
            this.kernel.entries.validateLibrary(ref, entry);

            const tokenInstances = new Map<string, unknown>();
            const assets = new LibraryAssets(
                ref.name,
                bundle,
                this.kernel.logger.child(`library:${ref.name}`),
                scope.child('assets', ref.name),
                this.kernel.ownership,
            );
            const config = await this.kernel.configs.loadScope<TConfig>(entry.config as never, assets) as ConfigScope<TConfig>;
            const record = {} as LibraryRecord;
            const handle: LoadedLibrary<TTokens, TConfig> = {
                ref,
                bundleName: ref.bundle,
                assets,
                config,
                use: (token) => this.useToken(record, token),
                unload: async () => this.release(ref.name, ownerKey),
            };
            Object.assign(record, {
                ref,
                entry,
                bundle,
                scope,
                assets,
                handle,
                owners: new Set<string>(),
                tokenInstances,
            });
            this.records.set(ref.name, record);
            this.acquireOwner(record, owner);
            return handle;
        } catch (error) {
            await scope.release({ type: 'library_load_failed', library: ref.name });
            throw error;
        }
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
        this.kernel.ownership.release(ownerKey, 'library', name);
        if (record.owners.size > 0) {
            return;
        }

        this.disposeTokenInstances(record);
        this.records.delete(name);
        await record.scope.release({ type: 'library_unload', library: name });
    }

    private disposeTokenInstances(record: LibraryRecord): void {
        for (const value of Array.from(record.tokenInstances.values()).reverse()) {
            const disposable = value as { dispose?: () => void; onDispose?: () => void } | undefined;
            try {
                if (typeof disposable?.dispose === 'function') {
                    disposable.dispose();
                } else if (typeof disposable?.onDispose === 'function') {
                    disposable.onDispose();
                }
            } catch (error) {
                this.kernel.logger.child(`library:${record.ref.name}`).warn('Library token dispose failed.', error);
            }
        }
        record.tokenInstances.clear();
    }

    private acquireOwner(record: LibraryRecord, owner: OwnerRef): void {
        const ownerKey = ownerKeyOf(owner);
        if (record.owners.has(ownerKey)) {
            return;
        }
        record.owners.add(ownerKey);
        this.rememberOwner(ownerKey, record.ref.name);
        this.kernel.ownership.acquire(ownerKey, 'library', record.ref.name, { bundleName: record.ref.bundle });
        this.bindScopeRelease(record.ref.name, owner);
    }

    private rememberOwner(ownerKey: string, libraryName: string): void {
        let refs = this.ownerRefs.get(ownerKey);
        if (!refs) {
            refs = new Set();
            this.ownerRefs.set(ownerKey, refs);
        }
        refs.add(libraryName);
    }

    private bindScopeRelease(libraryName: string, owner: OwnerRef): void {
        if (typeof owner === 'string') {
            return;
        }
        owner.defer(`library:${libraryName}`, () => this.release(libraryName, owner.ownerKey));
    }

    private snapshotRecord(record: LibraryRecord): LibraryRecordSnapshot {
        return {
            name: record.ref.name,
            bundleName: record.ref.bundle,
            owners: Array.from(record.owners),
            ownerCount: record.owners.size,
            dependencies: record.ref.libraries.map((library) => library.name),
            tokenInstanceCount: record.tokenInstances.size,
            assets: record.assets.snapshot(),
        };
    }
}

export class ModuleLibraryManager {
    public constructor(
        private readonly kernel: AppKernel,
        private readonly owner: ReleaseScope,
    ) {}

    public async load<TTokens, TConfig extends object = object>(ref: LibraryRef<TTokens, TConfig>): Promise<LoadedLibrary<TTokens, TConfig>> {
        return this.kernel.libraries.acquire(ref, this.owner);
    }

    public async releaseAll(): Promise<void> {
        await this.kernel.libraries.releaseOwner(this.owner);
    }
}
