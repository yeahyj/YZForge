import type { AssetManager } from 'cc';
import { ContentPackAssetScope } from './assets';
import type { App } from './app';
import type { ConfigScope } from './config';
import { YZForgeError } from './errors';
import type { ContentPackRef } from './refs';

export interface LoadedContentPack<TRefs = unknown, TConfig = unknown> {
    readonly ref: ContentPackRef<TRefs, TConfig>;
    readonly bundleName: string;
    readonly refs: TRefs;
    readonly assets: ContentPackAssetScope;
    readonly config: ConfigScope | Record<string, unknown>;
    unload(): Promise<void>;
}

interface ContentPackRecord {
    readonly ref: ContentPackRef;
    readonly bundle: AssetManager.Bundle;
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
        private readonly app: App,
        private readonly ownerModuleName: string,
    ) {}

    public async load<TRefs, TConfig>(
        ref: ContentPackRef<TRefs, TConfig>,
    ): Promise<LoadedContentPack<TRefs, TConfig>> {
        if (ref.owner !== this.ownerModuleName) {
            throw new YZForgeError(`ContentPack owner mismatch: ${ref.id}`, 'content_pack.owner_mismatch', {
                expected: this.ownerModuleName,
                actual: ref.owner,
            });
        }
        const existing = this.records.get(ref.id);
        if (existing) {
            existing.refCount += 1;
            return existing.handle as LoadedContentPack<TRefs, TConfig>;
        }

        const running = this.inFlight.get(ref.id);
        if (running) {
            const handle = await running;
            const record = this.records.get(ref.id);
            if (record) {
                record.refCount += 1;
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

    public getRefCount(id: string): number {
        return this.records.get(id)?.refCount ?? 0;
    }

    public get<TRefs, TConfig>(ref: ContentPackRef<TRefs, TConfig>): LoadedContentPack<TRefs, TConfig> | undefined {
        return this.records.get(ref.id)?.handle as LoadedContentPack<TRefs, TConfig> | undefined;
    }

    private async create<TRefs, TConfig>(
        ref: ContentPackRef<TRefs, TConfig>,
        version: number,
    ): Promise<LoadedContentPack<TRefs, TConfig>> {
        const ownerKey = `content-pack:${ref.id}`;
        let bundle: AssetManager.Bundle | undefined;
        try {
            for (const library of ref.libraries) {
                await this.app.libraries.acquire(library, ownerKey);
            }
            this.ensureNotCancelled(ref, version);

            bundle = await this.app.bundles.loadBundle(ref.bundle);
            this.ensureNotCancelled(ref, version);
            const assets = new ContentPackAssetScope(ref.id, bundle, this.app.logger.child(`content-pack:${ref.id}`));
            const handle: LoadedContentPack<TRefs, TConfig> = {
                ref,
                bundleName: ref.bundle,
                refs: ref.refs,
                assets,
                config: {},
                unload: async () => this.unload(ref.id),
            };
            this.records.set(ref.id, {
                ref,
                bundle,
                assets,
                handle,
                refCount: 1,
            });
            return handle;
        } catch (error) {
            if (bundle) {
                await this.app.bundles.releaseBundle(ref.bundle);
            }
            await this.app.libraries.releaseOwner(ownerKey);
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
            if (record.refCount > 0) {
                return;
            }
        } else {
            record.refCount = 0;
        }
        record.assets.releaseAll();
        this.records.delete(id);
        await this.app.bundles.releaseBundle(record.ref.bundle);
        await this.app.libraries.releaseOwner(`content-pack:${record.ref.id}`);
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
}
