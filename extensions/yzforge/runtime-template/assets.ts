import { Asset, instantiate, isValid, Node, Prefab } from 'cc';
import type { BundleLease } from './bundle-manager';
import type { OwnerRef, OwnershipLedger, ReleaseScope } from './lifetime';
import type { LoadableAssetRef, PartRef } from './refs';
import type { Logger } from './logger';
import { YZForgeError } from './errors';
import { disposePartRuntime, initializePartRuntime, type Part } from './ui';
import { CompensationStack, runCleanupSteps } from './compensation';

interface LoadedAssetRecord {
    readonly ref: LoadableAssetRef;
    asset?: Asset;
    task?: Promise<Asset>;
    refCount: number;
    releaseWhenLoaded?: boolean;
}

export type AssetRecordState = 'loading' | 'loaded' | 'release-pending';

export interface AssetRecordSnapshot {
    readonly key: string;
    readonly path: string;
    readonly type: string;
    readonly refCount: number;
    readonly state: AssetRecordState;
}

export interface AssetScopeSnapshot {
    readonly ownerName: string;
    readonly loadedCount: number;
    readonly trackedNodeCount: number;
    readonly assets: readonly AssetRecordSnapshot[];
}

export interface InstantiateOptions {
    readonly parent?: Node | null;
    readonly active?: boolean;
    readonly acquireAsset?: boolean;
}

export interface LoadAssetOptions {
    readonly acquire?: boolean;
}

export interface PartLease<TPart extends Part = Part> {
    readonly leaseId: string;
    readonly instance: TPart;
    readonly released: boolean;
    release(reason?: unknown): Promise<void>;
}

export class AssetScope {
    private readonly loaded = new Map<string, LoadedAssetRecord>();
    private readonly nodes = new Set<Node>();
    private readonly nodeKeys = new WeakMap<Node, string>();
    private readonly owner: OwnerRef;
    private nextNodeId = 0;

    public constructor(
        public readonly ownerName: string,
        protected readonly bundle: BundleLease,
        protected readonly logger: Logger | undefined,
        protected readonly releaseScope: ReleaseScope,
        private readonly ledger?: OwnershipLedger,
    ) {
        this.owner = releaseScope;
        releaseScope.defer(`assets:${ownerName}`, () => this.releaseAll());
    }

    public getLoadedCount(): number {
        return this.loaded.size;
    }

    public getTrackedNodeCount(): number {
        return this.nodes.size;
    }

    public getRefCount(ref: LoadableAssetRef): number {
        return this.loaded.get(this.assetKey(ref))?.refCount ?? 0;
    }

    public has(ref: LoadableAssetRef): boolean {
        return this.loaded.has(this.assetKey(ref));
    }

    public listLoaded(): AssetRecordSnapshot[] {
        return Array.from(this.loaded.entries()).map(([key, record]) => this.snapshotRecord(key, record));
    }

    public snapshot(): AssetScopeSnapshot {
        return {
            ownerName: this.ownerName,
            loadedCount: this.getLoadedCount(),
            trackedNodeCount: this.getTrackedNodeCount(),
            assets: this.listLoaded(),
        };
    }

    public async preload<TAsset extends Asset>(ref: LoadableAssetRef<TAsset>): Promise<TAsset> {
        return this.load(ref, { acquire: false });
    }

    public async load<TAsset extends Asset>(
        ref: LoadableAssetRef<TAsset>,
        options: LoadAssetOptions = {},
    ): Promise<TAsset> {
        const acquire = options.acquire !== false;
        const key = this.assetKey(ref);
        const existing = this.loaded.get(key);
        if (existing) {
            if (acquire) {
                existing.refCount += 1;
            }
            if (existing.asset) {
                return existing.asset as TAsset;
            }
            return await existing.task as TAsset;
        }

        const record: LoadedAssetRecord = {
            ref,
            refCount: acquire ? 1 : 0,
        };
        record.task = this.bundle.loadAsset<TAsset>(ref.path, ref.type);
        this.loaded.set(key, record);
        this.ledger?.acquire(this.owner, 'asset', key, {
            bundleName: this.bundle.name,
            path: ref.path,
            type: ref.type?.name ?? 'Asset',
        });

        try {
            const asset = await record.task as TAsset;
            record.asset = asset;
            record.task = undefined;
            this.logger?.debug(`Asset loaded: ${this.ownerName}/${ref.path}`, { refCount: record.refCount });
            if (record.releaseWhenLoaded) {
                this.releaseRecord(key, record);
            }
            return asset;
        } catch (error) {
            this.loaded.delete(key);
            this.ledger?.release(this.owner, 'asset', key);
            throw error;
        }
    }

    public async instantiate(ref: LoadableAssetRef<Prefab>, options: InstantiateOptions = {}): Promise<Node> {
        const transaction = new CompensationStack(`asset.instantiate:${this.ownerName}/${ref.path}`);
        try {
            const acquireAsset = options.acquireAsset !== false;
            const prefab = await this.load(ref, { acquire: acquireAsset });
            if (acquireAsset) {
                transaction.defer('release partial instance prefab', () => this.release(ref));
            }
            const node = instantiate(prefab);
            transaction.defer('destroy partial instance node', () => this.destroyNode(node));
            if (options.active !== undefined) {
                node.active = options.active;
            }
            if (options.parent) {
                options.parent.addChild(node);
            }
            this.trackNode(node);
            transaction.commit();
            return node;
        } catch (error) {
            return await transaction.fail(error, { type: 'asset_instantiate_failed', path: ref.path });
        }
    }

    public trackNode(node: Node): void {
        if (!isValid(node)) {
            return;
        }
        if (this.nodes.has(node)) {
            return;
        }
        this.nodes.add(node);
        const key = this.nodeKey(node);
        this.nodeKeys.set(node, key);
        this.ledger?.acquire(this.owner, 'node', key, {
            name: node.name,
            ownerName: this.ownerName,
        });
    }

    public untrackNode(node: Node): void {
        if (!this.nodes.delete(node)) {
            return;
        }
        const key = this.nodeKeys.get(node);
        if (key) {
            this.ledger?.release(this.owner, 'node', key);
            this.nodeKeys.delete(node);
        }
    }

    public destroyNode(node: Node): void {
        this.untrackNode(node);
        if (isValid(node)) {
            node.destroy();
        }
    }

    public release(ref: LoadableAssetRef, count = 1): void {
        const key = this.assetKey(ref);
        const record = this.loaded.get(key);
        const releaseCount = Math.max(1, count);
        if (!record) {
            this.logger?.warn(`Asset release ignored because it was not loaded: ${this.ownerName}/${ref.path}`, {
                path: ref.path,
                type: ref.type?.name ?? 'Asset',
                releaseCount,
            });
            return;
        }
        if (record.refCount > 0 && releaseCount > record.refCount) {
            this.logger?.warn(`Asset release exceeded refCount: ${this.ownerName}/${ref.path}`, {
                path: ref.path,
                type: ref.type?.name ?? 'Asset',
                refCount: record.refCount,
                releaseCount,
            });
        }
        record.refCount = Math.max(0, record.refCount - releaseCount);
        if (record.refCount > 0) {
            return;
        }
        if (record.task && !record.asset) {
            record.releaseWhenLoaded = true;
            return;
        }
        this.releaseRecord(key, record);
    }

    public releaseAll(): void {
        const failures: Array<{ readonly step: string; readonly key: string; readonly error: unknown }> = [];
        for (const node of Array.from(this.nodes)) {
            try {
                this.destroyNode(node);
            } catch (error) {
                failures.push({ step: 'destroyNode', key: this.nodeKeys.get(node) ?? node.name, error });
            }
        }

        for (const [key, record] of Array.from(this.loaded.entries())) {
            try {
                this.releaseRecord(key, record);
            } catch (error) {
                failures.push({ step: 'releaseAsset', key, error });
            }
        }
        if (failures.length > 0) {
            throw new YZForgeError(`AssetScope release completed with errors: ${this.ownerName}`, 'asset.release_failed', {
                ownerName: this.ownerName,
                failures: failures.map((failure) => ({
                    step: failure.step,
                    key: failure.key,
                    error: describeError(failure.error),
                })),
            });
        }
    }

    private assetKey(ref: LoadableAssetRef): string {
        return `${ref.path}::${ref.type?.name ?? 'Asset'}`;
    }

    private nodeKey(node: Node): string {
        this.nextNodeId += 1;
        return `${this.ownerName}:${node.name || 'Node'}:${this.nextNodeId}`;
    }

    private snapshotRecord(key: string, record: LoadedAssetRecord): AssetRecordSnapshot {
        const state: AssetRecordState = record.releaseWhenLoaded
            ? 'release-pending'
            : record.asset
                ? 'loaded'
                : 'loading';
        return {
            key,
            path: record.ref.path,
            type: record.ref.type?.name ?? 'Asset',
            refCount: record.refCount,
            state,
        };
    }

    private releaseRecord(key: string, record: LoadedAssetRecord): void {
        record.refCount = 0;
        if (!record.asset) {
            record.releaseWhenLoaded = true;
            return;
        }
        this.bundle.releaseAsset(record.ref.path, record.ref.type, record.asset);
        this.loaded.delete(key);
        this.ledger?.release(this.owner, 'asset', key);
        this.logger?.debug(`Asset released: ${this.ownerName}/${record.ref.path}`);
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

export class ModuleAssets extends AssetScope {
    private nextPartLeaseId = 0;

    public async createPart<TData, TPart extends Part<TData>>(
        ref: PartRef<TPart, TData>,
        data: TData,
        options: Omit<InstantiateOptions, 'acquireAsset'> = {},
    ): Promise<PartLease<TPart>> {
        const transaction = new CompensationStack(`part.create:${this.ownerName}/${ref.path}`);
        try {
            const node = await this.instantiate(ref, { ...options, acquireAsset: true });
            transaction.defer('release partial part node and asset', (reason) => runCleanupSteps('part.partial.release', [
                { step: 'destroy part node', task: () => this.destroyNode(node) },
                { step: 'release part prefab', task: () => this.release(ref) },
            ]));
            const instance = node.getComponent(ref.component);
            if (!instance) {
                throw new YZForgeError(`Part component not found after instantiate: ${ref.path}`, 'part.component_missing');
            }
            transaction.defer('dispose partial part lifecycle', (reason) => disposePartRuntime(instance, reason));
            await initializePartRuntime(instance, data);

            const leaseId = `part-lease-${++this.nextPartLeaseId}`;
            const state = { released: false };
            let detachOwnerRelease: (() => void) | undefined;
            const lease: PartLease<TPart> = {
                leaseId,
                instance,
                get released(): boolean {
                    return state.released;
                },
                release: async (reason: unknown = { type: 'part_lease_release' }) => {
                    if (state.released) {
                        return;
                    }
                    state.released = true;
                    detachOwnerRelease?.();
                    detachOwnerRelease = undefined;
                    await runCleanupSteps(`part.release:${this.ownerName}/${ref.path}`, [
                        { step: 'dispose part lifecycle', task: () => disposePartRuntime(instance, reason) },
                        { step: 'destroy part node', task: () => this.destroyNode(node) },
                        { step: 'release part prefab', task: () => this.release(ref) },
                    ]);
                },
            };
            detachOwnerRelease = this.releaseScope.defer(`part-lease:${ref.path}:${leaseId}`, (reason) => lease.release(reason));
            transaction.commit();
            return lease;
        } catch (error) {
            return await transaction.fail(error, { type: 'part_create_failed', path: ref.path });
        }
    }
}
export class LibraryAssets extends AssetScope {}
export class ContentPackAssetScope extends AssetScope {}
export class GlobalAssets extends AssetScope {}
export class SharedAssets extends AssetScope {}
