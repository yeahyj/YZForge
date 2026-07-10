import { LibraryAssets, type AssetScopeSnapshot } from './assets';
import type { ConfigScope } from './config';
import type { BundleLease } from './bundle-manager';
import type { LibraryEntry } from './entry-registry';
import { YZForgeError } from './errors';
import type { AppKernel } from './kernel';
import { ownerIdentityOf, type OwnerIdentity, type ReleaseScope } from './lifetime';
import type { LibraryRef } from './refs';
import type { LibraryToken, TokenProvider } from './tokens';
import { CompensationStack, runCleanupSteps } from './compensation';

export interface LibraryLease<TTokens = unknown, TConfig extends object = object> {
    readonly leaseId: string;
    readonly ref: LibraryRef<TTokens, TConfig>;
    readonly bundleName: string;
    readonly assets: LibraryAssets;
    readonly config: ConfigScope<TConfig>;
    readonly released: boolean;
    use<TKey extends keyof TTokens>(token: LibraryToken<TTokens, TKey>): TTokens[TKey];
    release(reason?: unknown): Promise<void>;
}

export interface LibraryRecordSnapshot {
    readonly name: string;
    readonly bundleName: string;
    readonly leaseCount: number;
    readonly owners: readonly { readonly ownerId: string; readonly ownerPath: string; readonly leaseCount: number }[];
    readonly dependencies: readonly string[];
    readonly tokenInstanceCount: number;
    readonly assets: AssetScopeSnapshot;
}

interface LibraryRecord {
    readonly ref: LibraryRef;
    readonly entry: LibraryEntry;
    readonly bundle: BundleLease;
    readonly scope: ReleaseScope;
    readonly assets: LibraryAssets;
    readonly config: ConfigScope<unknown>;
    readonly leases: Map<string, LibraryLeaseImpl>;
    readonly tokenInstances: Map<string, unknown>;
}

class LibraryLeaseImpl implements LibraryLease<Record<string, unknown>, object> {
    private leaseReleased = false;
    private detachOwnerRelease?: () => void;

    public constructor(
        private readonly registry: LibraryRegistry,
        private readonly record: LibraryRecord,
        public readonly leaseId: string,
        public readonly owner: OwnerIdentity,
    ) {}

    public get ref(): LibraryRef<Record<string, unknown>, object> {
        return this.record.ref as LibraryRef<Record<string, unknown>, object>;
    }

    public get bundleName(): string {
        return this.record.ref.bundle;
    }

    public get assets(): LibraryAssets {
        return this.record.assets;
    }

    public get config(): ConfigScope<object> {
        return this.record.config as ConfigScope<object>;
    }

    public get released(): boolean {
        return this.leaseReleased;
    }

    public use<TKey extends string>(token: LibraryToken<Record<string, unknown>, TKey>): Record<string, unknown>[TKey] {
        this.assertActive();
        return this.registry.useToken(this.record, token);
    }

    public async release(reason: unknown = { type: 'library_lease_release' }): Promise<void> {
        if (this.leaseReleased) {
            return;
        }
        this.leaseReleased = true;
        this.detachOwnerRelease?.();
        this.detachOwnerRelease = undefined;
        await this.registry.releaseLease(this.record, this, reason);
    }

    public attachOwnerRelease(detach: () => void): void {
        this.detachOwnerRelease = detach;
    }

    private assertActive(): void {
        if (!this.leaseReleased) {
            return;
        }
        throw new YZForgeError(`Library lease is released: ${this.ref.name}/${this.leaseId}`, 'library.lease_released', {
            library: this.ref.name,
            leaseId: this.leaseId,
            ownerId: this.owner.id,
        });
    }
}

export class LibraryRegistry {
    private readonly records = new Map<string, LibraryRecord>();
    private readonly inFlight = new Map<string, Promise<LibraryRecord>>();
    private nextLeaseId = 0;

    public constructor(private readonly kernel: AppKernel) {}

    public async acquire<TTokens, TConfig extends object = object>(
        ref: LibraryRef<TTokens, TConfig>,
        owner: ReleaseScope,
    ): Promise<LibraryLease<TTokens, TConfig>> {
        if (!owner.active) {
            throw this.acquireCancelled(ref, owner);
        }
        let record = this.records.get(ref.name);
        if (!record) {
            let task = this.inFlight.get(ref.name);
            if (!task) {
                task = this.createRecord(ref);
                this.inFlight.set(ref.name, task);
            }
            try {
                record = await task;
            } finally {
                if (this.inFlight.get(ref.name) === task) {
                    this.inFlight.delete(ref.name);
                }
            }
        }
        if (!owner.active) {
            await this.releaseRecordIfUnused(record, { type: 'library_acquire_cancelled' });
            throw this.acquireCancelled(ref, owner);
        }
        return await this.createLease<TTokens, TConfig>(record, owner);
    }

    public snapshot(name: string): LibraryRecordSnapshot | undefined {
        const record = this.records.get(name);
        return record ? this.snapshotRecord(record) : undefined;
    }

    public snapshots(): LibraryRecordSnapshot[] {
        return Array.from(this.records.values()).map((record) => this.snapshotRecord(record));
    }

    public useToken<TTokens, TKey extends keyof TTokens>(
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

    public async releaseLease(record: LibraryRecord, lease: LibraryLeaseImpl, reason: unknown): Promise<void> {
        if (!record.leases.delete(lease.leaseId)) {
            return;
        }
        this.kernel.ownership.release(lease.owner, 'library', record.ref.name);
        await this.releaseRecordIfUnused(record, reason);
    }

    private async createRecord<TTokens, TConfig extends object>(ref: LibraryRef<TTokens, TConfig>): Promise<LibraryRecord> {
        const transaction = new CompensationStack(`library.load:${ref.name}`);
        const scope = this.kernel.releaseScope.child('library-record', ref.name);
        transaction.defer('release library record scope', (reason) => scope.release(reason));
        try {
            for (const dependency of ref.libraries) {
                await this.acquire(dependency, scope);
            }
            const bundle = await this.kernel.bundles.loadBundle(ref.bundle, scope);
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
            const record: LibraryRecord = {
                ref,
                entry,
                bundle,
                scope,
                assets,
                config,
                leases: new Map(),
                tokenInstances,
            };
            this.records.set(ref.name, record);
            transaction.commit();
            return record;
        } catch (error) {
            return await transaction.fail(error, { type: 'library_load_failed', library: ref.name });
        }
    }

    private async createLease<TTokens, TConfig extends object>(
        record: LibraryRecord,
        owner: ReleaseScope,
    ): Promise<LibraryLease<TTokens, TConfig>> {
        const identity = ownerIdentityOf(owner);
        const leaseId = `library-lease-${++this.nextLeaseId}`;
        const lease = new LibraryLeaseImpl(this, record, leaseId, identity);
        record.leases.set(leaseId, lease);
        this.kernel.ownership.acquire(identity, 'library', record.ref.name, {
            bundleName: record.ref.bundle,
            leaseId,
        });
        try {
            lease.attachOwnerRelease(owner.defer(`library-lease:${record.ref.name}:${leaseId}`, (reason) => lease.release(reason)));
        } catch (error) {
            record.leases.delete(leaseId);
            this.kernel.ownership.release(identity, 'library', record.ref.name);
            try {
                await this.releaseRecordIfUnused(record, { type: 'library_lease_attach_failed' });
            } catch (rollbackError) {
                throw new YZForgeError(`Library lease attach and rollback failed: ${record.ref.name}`, 'compensation.failed', {
                    operation: `library.lease.attach:${record.ref.name}`,
                    primary: error,
                    rollbackFailures: [{ step: 'release unused library record', error: rollbackError }],
                });
            }
            throw error;
        }
        return lease as unknown as LibraryLease<TTokens, TConfig>;
    }

    private async releaseRecordIfUnused(record: LibraryRecord, reason: unknown): Promise<void> {
        if (record.leases.size > 0 || this.records.get(record.ref.name) !== record) {
            return;
        }
        this.records.delete(record.ref.name);
        const tokenSteps = Array.from(record.tokenInstances.entries()).reverse().map(([tokenId, value]) => ({
            step: `dispose token:${tokenId}`,
            task: async () => {
                const disposable = value as { dispose?: () => unknown; onDispose?: () => unknown } | undefined;
                if (typeof disposable?.dispose === 'function') {
                    await disposable.dispose();
                } else if (typeof disposable?.onDispose === 'function') {
                    await disposable.onDispose();
                }
            },
        }));
        record.tokenInstances.clear();
        await runCleanupSteps(`library.release:${record.ref.name}`, [
            ...tokenSteps,
            { step: 'release library record scope', task: () => record.scope.release(reason) },
        ]);
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

    private snapshotRecord(record: LibraryRecord): LibraryRecordSnapshot {
        const owners = new Map<string, { owner: OwnerIdentity; count: number }>();
        for (const lease of record.leases.values()) {
            const current = owners.get(lease.owner.id);
            owners.set(lease.owner.id, { owner: lease.owner, count: (current?.count ?? 0) + 1 });
        }
        return {
            name: record.ref.name,
            bundleName: record.ref.bundle,
            leaseCount: record.leases.size,
            owners: Array.from(owners.values())
                .map(({ owner, count }) => ({ ownerId: owner.id, ownerPath: owner.path, leaseCount: count }))
                .sort((left, right) => left.ownerId.localeCompare(right.ownerId)),
            dependencies: record.ref.libraries.map((library) => library.name),
            tokenInstanceCount: record.tokenInstances.size,
            assets: record.assets.snapshot(),
        };
    }

    private acquireCancelled(ref: LibraryRef, owner: ReleaseScope): YZForgeError {
        return new YZForgeError(`Library acquire was cancelled because owner scope is closing: ${ref.name}`, 'library.acquire_cancelled', {
            library: ref.name,
            ownerId: owner.ownerId,
            ownerPath: owner.ownerPath,
        });
    }
}

export class ModuleLibraryManager {
    private readonly leases = new Set<LibraryLease>();

    public constructor(
        private readonly kernel: AppKernel,
        private readonly owner: ReleaseScope,
    ) {}

    public async load<TTokens, TConfig extends object = object>(ref: LibraryRef<TTokens, TConfig>): Promise<LibraryLease<TTokens, TConfig>> {
        const lease = await this.kernel.libraries.acquire(ref, this.owner);
        this.leases.add(lease);
        return lease;
    }

    public async releaseAll(reason: unknown = { type: 'module_library_release_all' }): Promise<void> {
        const leases = Array.from(this.leases).reverse();
        this.leases.clear();
        await runCleanupSteps('module.library.releaseAll', leases.map((lease) => ({
            step: `release library lease:${lease.ref.name}/${lease.leaseId}`,
            task: () => lease.release(reason),
        })));
    }
}
