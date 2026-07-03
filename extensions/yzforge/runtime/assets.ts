import { Asset, AssetManager, assetManager, instantiate, isValid, Node, Prefab } from 'cc';
import type { LoadableAssetRef } from './refs';
import type { Logger } from './logger';

interface LoadedAssetRecord {
    readonly ref: LoadableAssetRef;
    readonly asset: Asset;
}

export interface InstantiateOptions {
    readonly parent?: Node | null;
    readonly active?: boolean;
}

export class AssetScope {
    private readonly loaded = new Map<string, LoadedAssetRecord>();
    private readonly nodes = new Set<Node>();

    public constructor(
        public readonly ownerName: string,
        protected readonly bundle: AssetManager.Bundle,
        protected readonly logger?: Logger,
    ) {}

    public async load<TAsset extends Asset>(ref: LoadableAssetRef<TAsset>): Promise<TAsset> {
        const existing = this.loaded.get(ref.path);
        if (existing) {
            return existing.asset as TAsset;
        }
        const asset = await new Promise<TAsset>((resolve, reject) => {
            this.bundle.load(ref.path, ref.type as never, (error: Error | null, value: TAsset) => {
                if (error || !value) {
                    reject(error ?? new Error(`Asset not returned: ${ref.path}`));
                    return;
                }
                resolve(value);
            });
        });
        this.loaded.set(ref.path, { ref, asset });
        this.logger?.debug(`Asset loaded: ${this.ownerName}/${ref.path}`);
        return asset;
    }

    public async instantiate(ref: LoadableAssetRef<Prefab>, options: InstantiateOptions = {}): Promise<Node> {
        const prefab = await this.load(ref);
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
        this.nodes.add(node);
    }

    public untrackNode(node: Node): void {
        this.nodes.delete(node);
    }

    public releaseAll(): void {
        for (const node of Array.from(this.nodes)) {
            if (isValid(node)) {
                node.destroy();
            }
        }
        this.nodes.clear();

        for (const record of Array.from(this.loaded.values())) {
            const bundle = this.bundle as unknown as { release?: (path: string, type?: unknown) => void };
            if (typeof bundle.release === 'function') {
                bundle.release(record.ref.path, record.ref.type);
            } else {
                assetManager.releaseAsset(record.asset);
            }
        }
        this.loaded.clear();
    }
}

export class ModuleAssets extends AssetScope {}
export class LibraryAssets extends AssetScope {}
export class ContentPackAssetScope extends AssetScope {}
export class GlobalAssets extends AssetScope {}
export class SharedAssets extends AssetScope {}
