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
}

export class ContentPackManager {
    private readonly records = new Map<string, ContentPackRecord>();

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
            return existing.handle as LoadedContentPack<TRefs, TConfig>;
        }

        for (const library of ref.libraries) {
            await this.app.libraries.acquire(library, `content-pack:${ref.id}`);
        }

        const bundle = await this.app.bundles.loadBundle(ref.bundle);
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
        });
        return handle;
    }

    public async unload(id: string): Promise<void> {
        const record = this.records.get(id);
        if (!record) {
            return;
        }
        record.assets.releaseAll();
        this.records.delete(id);
        await this.app.bundles.releaseBundle(record.ref.bundle);
        await this.app.libraries.releaseOwner(`content-pack:${record.ref.id}`);
    }

    public async unloadAll(): Promise<void> {
        for (const id of Array.from(this.records.keys())) {
            await this.unload(id);
        }
    }
}
