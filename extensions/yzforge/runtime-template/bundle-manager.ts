import { Asset, assetManager, AssetManager } from 'cc';
import { YZForgeError } from './errors';
import { ownerKeyOf, type OwnerRef, type OwnershipLedger, type ReleaseScope } from './lifetime';
import type { Logger } from './logger';

export enum BundleState {
    Empty = 'empty',
    Loading = 'loading',
    Loaded = 'loaded',
    Releasing = 'releasing',
    Failed = 'failed',
    FailedRelease = 'failed-release',
}

interface BundleRecord {
    state: BundleState;
    readonly owners: Map<string, number>;
    readonly handle: ManagedBundleHandle;
    bundle?: AssetManager.Bundle;
    task?: Promise<AssetManager.Bundle>;
}

export interface BundleRecordSnapshot {
    readonly name: string;
    readonly state: BundleState;
    readonly refCount: number;
    readonly owners: readonly { readonly ownerKey: string; readonly count: number }[];
    readonly loaded: boolean;
    readonly loading: boolean;
}

export interface BundleHandle {
    readonly name: string;
    readonly state: BundleState;
    readonly refCount: number;
    snapshot(): BundleRecordSnapshot;
}

export interface BundleAssetAccess extends BundleHandle {
    loadAsset<TAsset extends Asset>(path: string, type: unknown): Promise<TAsset>;
    releaseAsset(path: string, type?: unknown, asset?: Asset): void;
    releaseAllAssets(): void;
}

export interface BundleManagerOptions {
    readonly unload?: 'immediate' | 'manual';
}

export interface LoadBundleOptions {
    readonly acquire?: boolean;
    readonly owner?: OwnerRef;
}

export interface ReleaseBundleOptions {
    readonly owner?: OwnerRef;
    readonly unload?: boolean;
    readonly force?: boolean;
    readonly count?: number;
}

const MANUAL_OWNER = 'manual:bundle';

class ManagedBundleHandle implements BundleAssetAccess {
    public constructor(
        private readonly manager: BundleManager,
        public readonly name: string,
    ) {}

    public get state(): BundleState {
        return this.manager.getState(this.name);
    }

    public get refCount(): number {
        return this.manager.getRefCount(this.name);
    }

    public snapshot(): BundleRecordSnapshot {
        return this.manager.snapshot(this.name);
    }

    public async loadAsset<TAsset extends Asset>(path: string, type: unknown): Promise<TAsset> {
        return this.manager.loadAssetFromBundle<TAsset>(this.name, path, type);
    }

    public releaseAsset(path: string, type?: unknown, asset?: Asset): void {
        this.manager.releaseAssetFromBundle(this.name, path, type, asset);
    }

    public releaseAllAssets(): void {
        this.manager.releaseAllAssetsFromBundle(this.name);
    }
}

export class BundleManager {
    private readonly records = new Map<string, BundleRecord>();

    public constructor(
        private readonly logger?: Logger,
        private readonly options: BundleManagerOptions = {},
        private readonly ledger?: OwnershipLedger,
    ) {}

    public getState(bundleName: string): BundleState {
        return this.records.get(bundleName)?.state ?? BundleState.Empty;
    }

    public getRefCount(bundleName: string): number {
        const record = this.records.get(bundleName);
        return record ? this.refCount(record) : 0;
    }

    public snapshot(bundleName: string): BundleRecordSnapshot {
        const record = this.records.get(bundleName);
        if (!record) {
            return {
                name: bundleName,
                state: BundleState.Empty,
                refCount: 0,
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

    public async preloadBundle(
        bundleName: string,
        options: LoadBundleOptions = {},
    ): Promise<BundleHandle> {
        return this.loadBundle(bundleName, {
            ...options,
            acquire: options.acquire ?? Boolean(options.owner),
        });
    }

    public async loadBundle(
        bundleName: string,
        options: LoadBundleOptions = {},
    ): Promise<BundleAssetAccess> {
        const acquire = options.acquire !== false;
        const ownerKey = options.owner ? ownerKeyOf(options.owner) : MANUAL_OWNER;
        let record = this.records.get(bundleName);
        const loaded = assetManager.getBundle(bundleName);
        if (loaded) {
            if (!record) {
                record = this.createRecord(bundleName);
                this.records.set(bundleName, record);
            }
            record.state = BundleState.Loaded;
            record.bundle = loaded;
            if (acquire) {
                this.acquireOwner(bundleName, record, ownerKey);
                this.bindScopeRelease(bundleName, options.owner);
            }
            return record.handle;
        }

        if (record?.task) {
            await record.task;
            if (acquire) {
                this.acquireOwner(bundleName, record, ownerKey);
                this.bindScopeRelease(bundleName, options.owner);
            }
            return record.handle;
        }

        record = record ?? this.createRecord(bundleName);
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
            const bundle = await record.task;
            record.bundle = bundle;
            record.state = BundleState.Loaded;
            record.task = undefined;
            if (acquire) {
                this.acquireOwner(bundleName, record, ownerKey);
                this.bindScopeRelease(bundleName, options.owner);
            }
            this.logger?.debug(`Bundle loaded: ${bundleName}`, { refCount: this.refCount(record) });
            return record.handle;
        } catch (error) {
            record.state = BundleState.Failed;
            record.task = undefined;
            throw new YZForgeError(`Failed to load bundle: ${bundleName}`, 'bundle.load_failed', error);
        }
    }

    public async releaseBundle(bundleName: string, options: ReleaseBundleOptions = {}): Promise<void> {
        const record = this.records.get(bundleName);
        if (!record) {
            this.logger?.warn(`Bundle release ignored because it was not managed: ${bundleName}`);
            return;
        }
        if (options.force) {
            this.releaseAllOwners(bundleName, record);
        } else {
            this.releaseOwner(bundleName, record, options.owner ? ownerKeyOf(options.owner) : MANUAL_OWNER, options.count);
        }
        if (this.refCount(record) > 0 || !record.bundle) {
            return;
        }
        const unload = options.unload ?? this.options.unload !== 'manual';
        if (!unload && !options.force) {
            return;
        }
        record.state = BundleState.Releasing;
        try {
            record.bundle.releaseAll();
            assetManager.removeBundle(record.bundle);
            this.records.delete(bundleName);
            this.logger?.debug(`Bundle released: ${bundleName}`);
        } catch (error) {
            record.state = BundleState.FailedRelease;
            throw new YZForgeError(`Failed to release bundle: ${bundleName}`, 'bundle.release_failed', error);
        }
    }

    public async unloadBundle(bundleName: string): Promise<void> {
        await this.releaseBundle(bundleName, { force: true });
    }

    public async loadAssetFromBundle<TAsset extends Asset>(
        bundleName: string,
        path: string,
        type: unknown,
    ): Promise<TAsset> {
        const bundle = await this.requireBundle(bundleName);
        return new Promise<TAsset>((resolve, reject) => {
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

    public releaseAllAssetsFromBundle(bundleName: string): void {
        this.records.get(bundleName)?.bundle?.releaseAll();
    }

    private createRecord(bundleName: string): BundleRecord {
        return {
            state: BundleState.Empty,
            owners: new Map(),
            handle: new ManagedBundleHandle(this, bundleName),
        };
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
            return record.task;
        }
        throw new YZForgeError(`Bundle is not loaded: ${bundleName}`, 'bundle.not_loaded');
    }

    private acquireOwner(bundleName: string, record: BundleRecord, ownerKey: string): void {
        record.owners.set(ownerKey, (record.owners.get(ownerKey) ?? 0) + 1);
        this.ledger?.acquire(ownerKey, 'bundle', bundleName, { bundleName });
    }

    private bindScopeRelease(bundleName: string, owner?: OwnerRef): void {
        if (!owner || typeof owner === 'string') {
            return;
        }
        const scope = owner as ReleaseScope;
        scope.defer(`bundle:${bundleName}`, () => this.releaseBundle(bundleName, { owner: scope }));
    }

    private releaseOwner(bundleName: string, record: BundleRecord, ownerKey: string, count = 1): void {
        const releaseCount = Math.max(1, count);
        const current = record.owners.get(ownerKey) ?? 0;
        if (current === 0) {
            this.logger?.warn(`Bundle release ignored because owner does not hold it: ${bundleName}`, { ownerKey });
            return;
        }
        if (releaseCount > current) {
            this.logger?.warn(`Bundle release exceeded owner refCount: ${bundleName}`, {
                ownerKey,
                refCount: current,
                releaseCount,
            });
        }
        const next = Math.max(0, current - releaseCount);
        if (next === 0) {
            record.owners.delete(ownerKey);
        } else {
            record.owners.set(ownerKey, next);
        }
        this.ledger?.release(ownerKey, 'bundle', bundleName, releaseCount);
    }

    private releaseAllOwners(bundleName: string, record: BundleRecord): void {
        for (const [ownerKey, count] of Array.from(record.owners.entries())) {
            this.ledger?.release(ownerKey, 'bundle', bundleName, count);
        }
        record.owners.clear();
    }

    private refCount(record: BundleRecord): number {
        let count = 0;
        for (const value of record.owners.values()) {
            count += value;
        }
        return count;
    }

    private snapshotRecord(name: string, record: BundleRecord): BundleRecordSnapshot {
        return {
            name,
            state: record.state,
            refCount: this.refCount(record),
            owners: Array.from(record.owners.entries())
                .map(([ownerKey, count]) => ({ ownerKey, count }))
                .sort((a, b) => a.ownerKey.localeCompare(b.ownerKey)),
            loaded: Boolean(record.bundle),
            loading: Boolean(record.task),
        };
    }
}
