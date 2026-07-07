import { JsonAsset } from 'cc';
import { ContentPackAssetScope, type AssetScopeSnapshot } from './assets';
import type { BundleAssetAccess } from './bundle-manager';
import type { ConfigScope } from './config';
import { YZForgeError } from './errors';
import type { AppKernel } from './kernel';
import type { ReleaseScope } from './lifetime';
import { assetRef, type ContentPackManifest, type ContentPackRef } from './refs';

export interface ContentPackLoadPlan {
    readonly id: string;
    readonly owner: string;
    readonly name?: string;
    readonly bundleName: string;
    readonly dependencies: readonly string[];
    readonly manifest: ContentPackManifest;
}

export interface LoadedContentPack<TRefs = unknown, TConfig = unknown> {
    readonly ref: ContentPackRef<TRefs, TConfig>;
    readonly bundleName: string;
    readonly refs: TRefs;
    readonly manifest: ContentPackManifest;
    readonly assets: ContentPackAssetScope;
    readonly config: ConfigScope | Record<string, unknown>;
    unload(): Promise<void>;
}

export interface ContentPackRecordSnapshot {
    readonly id: string;
    readonly owner: string;
    readonly name?: string;
    readonly bundleName: string;
    readonly refCount: number;
    readonly dependencies: readonly string[];
    readonly manifest: ContentPackManifest;
    readonly assets: AssetScopeSnapshot;
}

interface ContentPackRecord {
    readonly ref: ContentPackRef;
    readonly bundle: BundleAssetAccess;
    readonly scope: ReleaseScope;
    readonly assets: ContentPackAssetScope;
    readonly handle: LoadedContentPack;
    refCount: number;
}

export interface UnloadContentPackOptions {
    readonly force?: boolean;
}

export class ContentPackManager {
    private readonly records = new Map<string, ContentPackRecord>();
    private readonly inFlight = new Map<string, Promise<LoadedContentPack>>();
    private unloadVersion = 0;

    public constructor(
        private readonly kernel: AppKernel,
        private readonly ownerModuleName: string,
        private readonly ownerScope: ReleaseScope,
    ) {}

    public async load<TRefs, TConfig>(
        ref: ContentPackRef<TRefs, TConfig>,
    ): Promise<LoadedContentPack<TRefs, TConfig>> {
        this.assertOwner(ref);
        const existing = this.records.get(ref.id);
        if (existing) {
            existing.refCount += 1;
            this.kernel.ownership.acquire(this.ownerScope, 'content-pack', ref.id, { bundleName: ref.bundle });
            return existing.handle as LoadedContentPack<TRefs, TConfig>;
        }

        const running = this.inFlight.get(ref.id);
        if (running) {
            const handle = await running;
            const record = this.records.get(ref.id);
            if (record) {
                record.refCount += 1;
                this.kernel.ownership.acquire(this.ownerScope, 'content-pack', ref.id, { bundleName: ref.bundle });
            }
            return handle as LoadedContentPack<TRefs, TConfig>;
        }

        const version = this.unloadVersion;
        const task = this.create(ref, version);
        this.inFlight.set(ref.id, task);
        try {
            return await task as LoadedContentPack<TRefs, TConfig>;
        } finally {
            this.inFlight.delete(ref.id);
        }
    }

    public explain<TRefs, TConfig>(ref: ContentPackRef<TRefs, TConfig>): ContentPackLoadPlan {
        this.assertOwner(ref);
        return explainContentPack(ref);
    }

    public getRefCount(id: string): number {
        return this.records.get(id)?.refCount ?? 0;
    }

    public get<TRefs, TConfig>(ref: ContentPackRef<TRefs, TConfig>): LoadedContentPack<TRefs, TConfig> | undefined {
        return this.records.get(ref.id)?.handle as LoadedContentPack<TRefs, TConfig> | undefined;
    }

    public snapshot(id: string): ContentPackRecordSnapshot | undefined {
        const record = this.records.get(id);
        return record ? this.snapshotRecord(record) : undefined;
    }

    public snapshots(): ContentPackRecordSnapshot[] {
        return Array.from(this.records.values()).map((record) => this.snapshotRecord(record));
    }

    private async create<TRefs, TConfig>(
        ref: ContentPackRef<TRefs, TConfig>,
        version: number,
    ): Promise<LoadedContentPack<TRefs, TConfig>> {
        const scope = this.ownerScope.child('content-pack', ref.id);
        let bundle: BundleAssetAccess | undefined;
        try {
            for (const library of ref.libraries) {
                await this.kernel.libraries.acquire(library, scope);
            }
            this.ensureNotCancelled(ref, version);

            bundle = await this.kernel.bundles.loadBundle(ref.bundle, { owner: scope });
            this.ensureNotCancelled(ref, version);
            const assets = new ContentPackAssetScope(
                ref.id,
                bundle,
                this.kernel.logger.child(`content-pack:${ref.id}`),
                scope.child('assets', ref.id),
                this.kernel.ownership,
            );
            const manifestAsset = await assets.load(assetRef(JsonAsset, 'manifest.generated'));
            const manifest = readContentPackManifest(ref, manifestAsset);
            const config = await this.kernel.configs.loadContentPackScope(ref.refs, assets);
            const handle: LoadedContentPack<TRefs, TConfig> = {
                ref,
                bundleName: ref.bundle,
                refs: ref.refs,
                manifest,
                assets,
                config,
                unload: async () => this.unload(ref.id),
            };
            this.records.set(ref.id, {
                ref,
                bundle,
                scope,
                assets,
                handle,
                refCount: 1,
            });
            this.kernel.ownership.acquire(this.ownerScope, 'content-pack', ref.id, { bundleName: ref.bundle });
            return handle;
        } catch (error) {
            await scope.release({ type: 'content_pack_load_failed', contentPack: ref.id });
            throw error;
        }
    }

    public async unload(id: string, options: UnloadContentPackOptions = {}): Promise<void> {
        const record = this.records.get(id);
        if (!record) {
            return;
        }
        if (!options.force) {
            record.refCount = Math.max(0, record.refCount - 1);
            this.kernel.ownership.release(this.ownerScope, 'content-pack', id);
            if (record.refCount > 0) {
                return;
            }
        } else {
            this.kernel.ownership.release(this.ownerScope, 'content-pack', id, record.refCount);
            record.refCount = 0;
        }
        this.records.delete(id);
        await record.scope.release({ type: 'content_pack_unload', contentPack: id });
    }

    public async unloadAll(): Promise<void> {
        this.unloadVersion += 1;
        for (const id of Array.from(this.records.keys())) {
            await this.unload(id, { force: true });
        }
    }

    private ensureNotCancelled(ref: ContentPackRef, version: number): void {
        if (version !== this.unloadVersion) {
            throw new YZForgeError(`ContentPack load was cancelled: ${ref.id}`, 'content_pack.load_cancelled');
        }
    }

    private assertOwner(ref: ContentPackRef): void {
        if (ref.owner !== this.ownerModuleName) {
            throw new YZForgeError(`ContentPack owner mismatch: ${ref.id}`, 'content_pack.owner_mismatch', {
                expected: this.ownerModuleName,
                actual: ref.owner,
            });
        }
    }

    private snapshotRecord(record: ContentPackRecord): ContentPackRecordSnapshot {
        return {
            id: record.ref.id,
            owner: record.ref.owner,
            name: record.ref.name,
            bundleName: record.ref.bundle,
            refCount: record.refCount,
            dependencies: record.ref.libraries.map((library) => library.name),
            manifest: record.handle.manifest,
            assets: record.assets.snapshot(),
        };
    }
}

function readContentPackManifest(ref: ContentPackRef, asset: JsonAsset): ContentPackManifest {
    const manifest = asset.json as Partial<ContentPackManifest> | undefined;
    if (!manifest || typeof manifest !== 'object') {
        throw new YZForgeError(`ContentPack manifest is invalid: ${ref.id}`, 'content_pack.manifest_invalid', {
            id: ref.id,
        });
    }

    const mismatches: string[] = [];
    if (manifest.schemaVersion !== 1) {
        mismatches.push('schemaVersion');
    }
    if (manifest.id !== ref.id) {
        mismatches.push('id');
    }
    if (manifest.owner !== ref.owner) {
        mismatches.push('owner');
    }
    if (manifest.bundle !== ref.bundle) {
        mismatches.push('bundle');
    }
    if (!manifest.refs || typeof manifest.refs !== 'object') {
        mismatches.push('refs');
    }
    if (mismatches.length > 0) {
        throw new YZForgeError(
            `ContentPack manifest mismatch: ${ref.id} (${mismatches.join(', ')})`,
            'content_pack.manifest_mismatch',
            {
                id: ref.id,
                expected: {
                    id: ref.id,
                    owner: ref.owner,
                    bundle: ref.bundle,
                },
                actual: manifest,
                mismatches,
            },
        );
    }

    return manifest as ContentPackManifest;
}

export function explainContentPack(ref: ContentPackRef): ContentPackLoadPlan {
    return {
        id: ref.id,
        owner: ref.owner,
        name: ref.name,
        bundleName: ref.bundle,
        dependencies: ref.libraries.map((library) => library.name),
        manifest: ref.manifest,
    };
}
