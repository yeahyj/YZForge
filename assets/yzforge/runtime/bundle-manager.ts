import { Asset, assetManager, AssetManager } from 'cc';
import { YZForgeError } from './errors';
import { ownerIdentityOf, type OwnerIdentity, type OwnershipLedger, type ReleaseScope } from './lifetime';
import type { Logger } from './logger';

export enum BundleState {
    Empty = 'empty',
    Loading = 'loading',
    Loaded = 'loaded',
    Releasing = 'releasing',
    Failed = 'failed',
    FailedRelease = 'failed-release',
}

export type BundleCacheState = 'empty' | 'owned' | 'hot' | 'releasing' | 'failed';
export type BundleCachePolicy = 'purge-immediate' | 'keep-hot';

interface BundleRecord {
    state: BundleState;
    readonly leases: Map<string, OwnerIdentity>;
    bundle?: AssetManager.Bundle;
    task?: Promise<AssetManager.Bundle>;
}

export interface BundleRecordSnapshot {
    readonly name: string;
    readonly state: BundleState;
    readonly cacheState: BundleCacheState;
    readonly leaseCount: number;
    readonly owners: readonly { readonly ownerId: string; readonly ownerPath: string; readonly leaseCount: number }[];
    readonly loaded: boolean;
    readonly loading: boolean;
}

export interface BundleLease {
    readonly leaseId: string;
    readonly owner: OwnerIdentity;
    readonly name: string;
    readonly state: BundleState;
    readonly released: boolean;
    snapshot(): BundleRecordSnapshot;
    loadAsset<TAsset extends Asset>(path: string, type: unknown): Promise<TAsset>;
    releaseAsset(path: string, type?: unknown, asset?: Asset): void;
    release(reason?: unknown): Promise<void>;
}

export interface BundleManagerOptions {
    readonly cachePolicy?: BundleCachePolicy;
}

export interface BundlePurgeResult {
    readonly name: string;
    readonly purged: boolean;
    readonly state: BundleState;
}

class ManagedBundleLease implements BundleLease {
    private leaseReleased = false;
    private detachOwnerRelease?: () => void;

    public constructor(
        private readonly manager: BundleManager,
        public readonly leaseId: string,
        public readonly owner: OwnerIdentity,
        public readonly name: string,
    ) {}

    public get state(): BundleState {
        return this.manager.getState(this.name);
    }

    public get released(): boolean {
        return this.leaseReleased;
    }

    public snapshot(): BundleRecordSnapshot {
        return this.manager.snapshot(this.name);
    }

    public async loadAsset<TAsset extends Asset>(path: string, type: unknown): Promise<TAsset> {
        this.assertActive();
        return await this.manager.loadAssetFromBundle<TAsset>(this.name, path, type);
    }

    public releaseAsset(path: string, type?: unknown, asset?: Asset): void {
        this.manager.releaseAssetFromBundle(this.name, path, type, asset);
    }

    public async release(reason: unknown = { type: 'bundle_lease_release' }): Promise<void> {
        if (this.leaseReleased) {
            return;
        }
        this.leaseReleased = true;
        this.detachOwnerRelease?.();
        this.detachOwnerRelease = undefined;
        await this.manager.releaseLease(this, reason);
    }

    public attachOwnerRelease(detach: () => void): void {
        this.detachOwnerRelease = detach;
    }

    private assertActive(): void {
        if (!this.leaseReleased) {
            return;
        }
        throw new YZForgeError(`Bundle lease is released: ${this.name}/${this.leaseId}`, 'bundle.lease_released', {
            bundleName: this.name,
            leaseId: this.leaseId,
            ownerId: this.owner.id,
        });
    }
}

export class BundleManager {
    private readonly records = new Map<string, BundleRecord>();
    private nextLeaseId = 0;

    public constructor(
        private readonly logger?: Logger,
        private readonly options: BundleManagerOptions = {},
        private readonly ledger?: OwnershipLedger,
    ) {}

    public getState(bundleName: string): BundleState {
        return this.records.get(bundleName)?.state ?? BundleState.Empty;
    }

    public snapshot(bundleName: string): BundleRecordSnapshot {
        const record = this.records.get(bundleName);
        if (!record) {
            return {
                name: bundleName,
                state: BundleState.Empty,
                cacheState: 'empty',
                leaseCount: 0,
                owners: [],
                loaded: Boolean(assetManager.getBundle(bundleName)),
                loading: false,
            };
        }
        return this.snapshotRecord(bundleName, record);
    }

    public snapshots(): BundleRecordSnapshot[] {
        return Array.from(this.records.entries()).map(([name, record]) => this.snapshotRecord(name, record));
    }

    public async preloadBundle(bundleName: string, owner: ReleaseScope): Promise<BundleLease> {
        return await this.loadBundle(bundleName, owner);
    }

    public async loadBundle(bundleName: string, owner: ReleaseScope): Promise<BundleLease> {
        if (!owner.active) {
            throw this.acquireCancelled(bundleName, owner);
        }

        let lease: ManagedBundleLease | undefined;
        let cancelled = false;
        const recordTask = this.requireRecord(bundleName);
        let detachScopeRelease: () => void;
        try {
            detachScopeRelease = owner.defer(`bundle-lease:${bundleName}`, async (reason) => {
                cancelled = true;
                try {
                    await recordTask;
                } catch (_error) {
                    return;
                }
                await lease?.release(reason);
            });
        } catch (error) {
            try {
                const record = await recordTask;
                await this.purgeRecordIfUnused(bundleName, record, { type: 'bundle_lease_attach_failed' });
            } catch (rollbackError) {
                throw new YZForgeError(`Bundle lease attach and rollback failed: ${bundleName}`, 'compensation.failed', {
                    operation: `bundle.lease.attach:${bundleName}`,
                    primary: error,
                    rollbackFailures: [{ step: 'purge unused bundle record', error: rollbackError }],
                });
            }
            throw error;
        }

        try {
            const record = await recordTask;
            if (cancelled || !owner.active) {
                detachScopeRelease();
                await this.purgeRecordIfUnused(bundleName, record, { type: 'bundle_acquire_cancelled' });
                throw this.acquireCancelled(bundleName, owner);
            }
            const identity = ownerIdentityOf(owner);
            const leaseId = `bundle-lease-${++this.nextLeaseId}`;
            lease = new ManagedBundleLease(this, leaseId, identity, bundleName);
            lease.attachOwnerRelease(detachScopeRelease);
            record.leases.set(leaseId, identity);
            this.ledger?.acquire(identity, 'bundle', bundleName, { bundleName, leaseId });
            this.logger?.debug(`Bundle lease acquired: ${bundleName}`, {
                leaseId,
                ownerId: identity.id,
                leaseCount: record.leases.size,
            });
            return lease;
        } catch (error) {
            if (!cancelled) {
                detachScopeRelease();
            }
            throw error;
        }
    }

    public async releaseLease(lease: BundleLease, reason: unknown): Promise<void> {
        const record = this.records.get(lease.name);
        if (!record || !record.leases.delete(lease.leaseId)) {
            return;
        }
        this.ledger?.release(lease.owner, 'bundle', lease.name);
        this.logger?.debug(`Bundle lease released: ${lease.name}`, {
            leaseId: lease.leaseId,
            ownerId: lease.owner.id,
            leaseCount: record.leases.size,
        });
        await this.purgeRecordIfUnused(lease.name, record, reason);
    }

    public async purgeUnusedBundles(reason: unknown = { type: 'cache_purge' }): Promise<BundlePurgeResult[]> {
        const results: BundlePurgeResult[] = [];
        for (const [bundleName, record] of Array.from(this.records.entries())) {
            if (!record.bundle || record.leases.size > 0) {
                results.push({ name: bundleName, purged: false, state: record.state });
                continue;
            }
            await this.releasePhysicalBundle(bundleName, record, reason);
            results.push({ name: bundleName, purged: true, state: BundleState.Empty });
        }
        return results;
    }

    public async loadAssetFromBundle<TAsset extends Asset>(
        bundleName: string,
        path: string,
        type: unknown,
    ): Promise<TAsset> {
        const bundle = await this.requireBundle(bundleName);
        return await new Promise<TAsset>((resolve, reject) => {
            bundle.load(path, type as never, (error: Error | null, value: TAsset) => {
                if (error || !value) {
                    reject(error ?? new Error(`Asset not returned: ${path}`));
                    return;
                }
                resolve(value);
            });
        });
    }

    public releaseAssetFromBundle(bundleName: string, path: string, type?: unknown, asset?: Asset): void {
        const bundle = this.records.get(bundleName)?.bundle;
        const releaseBundle = bundle as unknown as { release?: (assetPath: string, assetType?: unknown) => void };
        if (typeof releaseBundle?.release === 'function') {
            releaseBundle.release(path, type);
            return;
        }
        if (asset) {
            assetManager.releaseAsset(asset);
        }
    }

    private async requireRecord(bundleName: string): Promise<BundleRecord> {
        let record = this.records.get(bundleName);
        const loaded = assetManager.getBundle(bundleName);
        if (loaded) {
            record = record ?? this.createRecord();
            record.bundle = loaded;
            record.state = BundleState.Loaded;
            this.records.set(bundleName, record);
            return record;
        }
        if (record?.task) {
            await record.task;
            return record;
        }

        record = record ?? this.createRecord();
        record.state = BundleState.Loading;
        record.task = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(bundleName, (error, bundle) => {
                if (error || !bundle) {
                    reject(error ?? new Error(`Bundle not returned: ${bundleName}`));
                    return;
                }
                resolve(bundle);
            });
        });
        this.records.set(bundleName, record);
        try {
            record.bundle = await record.task;
            record.task = undefined;
            record.state = BundleState.Loaded;
            this.logger?.debug(`Bundle loaded: ${bundleName}`);
            return record;
        } catch (error) {
            record.task = undefined;
            record.state = BundleState.Failed;
            throw new YZForgeError(`Failed to load bundle: ${bundleName}`, 'bundle.load_failed', error);
        }
    }

    private createRecord(): BundleRecord {
        return { state: BundleState.Empty, leases: new Map() };
    }

    private async requireBundle(bundleName: string): Promise<AssetManager.Bundle> {
        const record = this.records.get(bundleName);
        if (!record) {
            throw new YZForgeError(`Bundle is not managed: ${bundleName}`, 'bundle.not_managed');
        }
        if (record.bundle) {
            return record.bundle;
        }
        if (record.task) {
            return await record.task;
        }
        throw new YZForgeError(`Bundle is not loaded: ${bundleName}`, 'bundle.not_loaded');
    }

    private async purgeRecordIfUnused(bundleName: string, record: BundleRecord, reason: unknown): Promise<void> {
        if (record.leases.size > 0 || !record.bundle || this.cachePolicy() === 'keep-hot') {
            return;
        }
        await this.releasePhysicalBundle(bundleName, record, reason);
    }

    private async releasePhysicalBundle(bundleName: string, record: BundleRecord, reason: unknown): Promise<void> {
        if (!record.bundle || record.leases.size > 0) {
            return;
        }
        record.state = BundleState.Releasing;
        try {
            assetManager.removeBundle(record.bundle);
            this.records.delete(bundleName);
            this.logger?.debug(`Bundle resource container purged: ${bundleName}`, { reason });
        } catch (error) {
            record.state = BundleState.FailedRelease;
            throw new YZForgeError(`Failed to purge bundle resource container: ${bundleName}`, 'bundle.purge_failed', {
                bundleName,
                reason,
                error,
            });
        }
    }

    private cachePolicy(): BundleCachePolicy {
        return this.options.cachePolicy ?? 'purge-immediate';
    }

    private snapshotRecord(name: string, record: BundleRecord): BundleRecordSnapshot {
        const owners = new Map<string, { owner: OwnerIdentity; count: number }>();
        for (const owner of record.leases.values()) {
            const current = owners.get(owner.id);
            owners.set(owner.id, { owner, count: (current?.count ?? 0) + 1 });
        }
        return {
            name,
            state: record.state,
            cacheState: this.cacheState(record),
            leaseCount: record.leases.size,
            owners: Array.from(owners.values())
                .map(({ owner, count }) => ({ ownerId: owner.id, ownerPath: owner.path, leaseCount: count }))
                .sort((left, right) => left.ownerId.localeCompare(right.ownerId)),
            loaded: Boolean(record.bundle),
            loading: Boolean(record.task),
        };
    }

    private cacheState(record: BundleRecord): BundleCacheState {
        if (record.state === BundleState.Failed || record.state === BundleState.FailedRelease) {
            return 'failed';
        }
        if (record.state === BundleState.Releasing) {
            return 'releasing';
        }
        if (!record.bundle) {
            return 'empty';
        }
        return record.leases.size > 0 ? 'owned' : 'hot';
    }

    private acquireCancelled(bundleName: string, owner: ReleaseScope): YZForgeError {
        return new YZForgeError(`Bundle acquire was cancelled because owner scope is closing: ${bundleName}`, 'bundle.acquire_cancelled', {
            bundleName,
            ownerId: owner.ownerId,
            ownerPath: owner.ownerPath,
        });
    }
}
