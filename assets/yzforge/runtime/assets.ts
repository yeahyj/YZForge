import { Asset, AssetManager, assetManager, instantiate, isValid, Node, Prefab } from 'cc';
import type { LoadableAssetRef } from './refs';
import type { Logger } from './logger';

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

export class AssetScope {
    private readonly loaded = new Map<string, LoadedAssetRecord>();
    private readonly nodes = new Set<Node>();

    public constructor(
        public readonly ownerName: string,
        protected readonly bundle: AssetManager.Bundle,
        protected readonly logger?: Logger,
    ) {}

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
        record.task = new Promise<TAsset>((resolve, reject) => {
            this.bundle.load(ref.path, ref.type as never, (error: Error | null, value: TAsset) => {
                if (error || !value) {
                    reject(error ?? new Error(`Asset not returned: ${ref.path}`));
                    return;
                }
                resolve(value);
            });
        });
        this.loaded.set(key, record);

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
            throw error;
        }
    }

    public async instantiate(ref: LoadableAssetRef<Prefab>, options: InstantiateOptions = {}): Promise<Node> {
        const prefab = await this.load(ref, { acquire: options.acquireAsset });
        const node = instantiate(prefab);
        if (options.active !== undefined) {
            node.active = options.active;
        }
        if (options.parent) {
            options.parent.addChild(node);
        }
        this.trackNode(node);
        return node;
    }

    public trackNode(node: Node): void {
        if (!isValid(node)) {
            return;
        }
        this.nodes.add(node);
    }

    public untrackNode(node: Node): void {
        this.nodes.delete(node);
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
        for (const node of Array.from(this.nodes)) {
            this.destroyNode(node);
        }
        this.nodes.clear();

        for (const [key, record] of Array.from(this.loaded.entries())) {
            this.releaseRecord(key, record);
        }
        this.loaded.clear();
    }

    private assetKey(ref: LoadableAssetRef): string {
        return `${ref.path}::${ref.type?.name ?? 'Asset'}`;
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
        this.loaded.delete(key);
        record.refCount = 0;
        if (!record.asset) {
            record.releaseWhenLoaded = true;
            return;
        }
        const bundle = this.bundle as unknown as { release?: (path: string, type?: unknown) => void };
        if (typeof bundle.release === 'function') {
            bundle.release(record.ref.path, record.ref.type);
        } else {
            assetManager.releaseAsset(record.asset);
        }
        this.logger?.debug(`Asset released: ${this.ownerName}/${record.ref.path}`);
    }
}

export class ModuleAssets extends AssetScope {}
export class LibraryAssets extends AssetScope {}
export class ContentPackAssetScope extends AssetScope {}
export class GlobalAssets extends AssetScope {}
export class SharedAssets extends AssetScope {}
