import { Asset, Component, Prefab } from 'cc';
import type { Constructor } from './types';

export interface NamedRef {
    readonly name: string;
    readonly bundle: string;
}

export interface LibraryRef<TTokens = unknown, TConfig extends object = object> extends NamedRef {
    readonly kind: 'library';
    readonly libraries: readonly LibraryRef[];
    readonly __tokens?: TTokens;
    readonly __config?: TConfig;
}

export interface ModuleRef<TParams = unknown, TConfig extends object = object> extends NamedRef {
    readonly kind: 'module';
    readonly libraries: readonly LibraryRef[];
    readonly __params?: TParams;
    readonly __config?: TConfig;
}

export type ContentPackManifestRefKind = 'asset' | 'config' | 'unknown';

export interface ContentPackManifestRef {
    readonly kind: ContentPackManifestRefKind;
    readonly path?: string;
    readonly type?: string;
    readonly table?: string;
    readonly primaryKey?: string;
    readonly codec?: string;
}

export interface ContentPackManifest {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly owner: string;
    readonly name?: string;
    readonly bundle: string;
    readonly refs: Readonly<Record<string, ContentPackManifestRef>>;
}

export interface ContentPackRef<TRefs = unknown, TConfig = unknown> {
    readonly kind: 'content-pack';
    readonly id: string;
    readonly owner: string;
    readonly name?: string;
    readonly bundle: string;
    readonly libraries: readonly LibraryRef[];
    readonly refs: TRefs;
    readonly manifest: ContentPackManifest;
    readonly __config?: TConfig;
}

export interface LoadableAssetRef<TAsset extends Asset = Asset> {
    readonly path: string;
    readonly type: Constructor<TAsset>;
    readonly preload?: boolean;
}

export interface AssetRef<TAsset extends Asset = Asset> extends LoadableAssetRef<TAsset> {
    readonly kind: 'asset';
}

export interface PartRef<TPart extends Component = Component, TData = unknown> extends LoadableAssetRef<Prefab> {
    readonly kind: 'part';
    readonly component: Constructor<TPart>;
    readonly __data?: TData;
}

export interface ViewRef<TData = unknown, TResult = unknown, TView extends Component = Component> extends LoadableAssetRef<Prefab> {
    readonly kind: 'view';
    readonly owner: string;
    readonly component: Constructor<TView>;
    readonly policy: ViewPolicyLike;
    readonly __data?: TData;
    readonly __result?: TResult;
}

export interface ContentPackAssetRef<TAsset extends Asset = Asset> extends LoadableAssetRef<TAsset> {
    readonly kind: 'content-pack-asset';
}

export interface ContentPackConfigRef<TValue = unknown> {
    readonly kind: 'content-pack-config';
    readonly table: string;
    readonly primaryKey: string;
    readonly codec: string;
    readonly __value?: TValue;
}

export interface ViewPolicyLike {
    readonly kind?: string;
    readonly layer?: number;
    readonly stack?: string;
    readonly modal?: boolean;
    readonly mask?: 'none' | 'dim' | 'transparent';
    readonly singleton?: boolean;
    readonly duplicate?: 'focus' | 'reject' | 'reopen';
    readonly closeOnBack?: boolean;
    readonly closeWithOwner?: boolean;
    readonly pauseWithOwner?: boolean;
    readonly cache?: 'none' | 'asset' | 'node';
}

export function defineModuleRef<TParams = unknown, TConfig extends object = object>(
    options: Omit<ModuleRef<TParams, TConfig>, 'kind'>,
): ModuleRef<TParams, TConfig> {
    return {
        ...options,
        kind: 'module',
        libraries: options.libraries ?? [],
    };
}

export function defineLibraryRef<TTokens = unknown, TConfig extends object = object>(
    options: Omit<LibraryRef<TTokens, TConfig>, 'kind'>,
): LibraryRef<TTokens, TConfig> {
    return {
        ...options,
        kind: 'library',
        libraries: options.libraries ?? [],
    };
}

export function defineContentPack<TRefs = unknown, TConfig = unknown>(
    options: Omit<ContentPackRef<TRefs, TConfig>, 'kind' | 'manifest'> & {
        readonly manifest?: ContentPackManifest;
    },
): ContentPackRef<TRefs, TConfig> {
    const libraries = options.libraries ?? [];
    const manifest = options.manifest ?? createContentPackManifest({
        id: options.id,
        owner: options.owner,
        name: options.name,
        bundle: options.bundle,
        refs: options.refs,
    });
    return {
        ...options,
        kind: 'content-pack',
        libraries,
        manifest,
    };
}

function createContentPackManifest(options: {
    readonly id: string;
    readonly owner: string;
    readonly name?: string;
    readonly bundle: string;
    readonly refs: unknown;
}): ContentPackManifest {
    return {
        schemaVersion: 1,
        id: options.id,
        owner: options.owner,
        name: options.name,
        bundle: options.bundle,
        refs: describeContentPackRefs(options.refs),
    };
}

function describeContentPackRefs(refs: unknown): Readonly<Record<string, ContentPackManifestRef>> {
    if (!refs || typeof refs !== 'object') {
        return {};
    }
    const values = refs as Record<string, unknown>;
    const manifestRefs: Record<string, ContentPackManifestRef> = {};
    for (const key of Object.keys(values)) {
        manifestRefs[key] = describeContentPackRef(values[key]);
    }
    return manifestRefs;
}

function describeContentPackRef(value: unknown): ContentPackManifestRef {
    const ref = value as Partial<ContentPackAssetRef> | Partial<ContentPackConfigRef> | undefined;
    if (!ref || typeof ref !== 'object') {
        return { kind: 'unknown' };
    }
    if (ref.kind === 'content-pack-asset') {
        return {
            kind: 'asset',
            path: ref.path,
            type: ref.type?.name ?? 'Asset',
        };
    }
    if (ref.kind === 'content-pack-config') {
        return {
            kind: 'config',
            table: ref.table,
            primaryKey: ref.primaryKey,
            codec: ref.codec,
        };
    }
    return { kind: 'unknown' };
}

export function assetRef<TAsset extends Asset>(
    type: Constructor<TAsset>,
    path: string,
    options: Pick<AssetRef<TAsset>, 'preload'> = {},
): AssetRef<TAsset> {
    return {
        kind: 'asset',
        type,
        path,
        ...options,
    };
}

export function viewRef<TData, TResult, TView extends Component>(
    owner: string,
    component: Constructor<TView>,
    path: string,
    policy: ViewPolicyLike,
): ViewRef<TData, TResult, TView> {
    return {
        kind: 'view',
        owner,
        type: Prefab as unknown as Constructor<Prefab>,
        component,
        path,
        policy,
    };
}

export function partRef<TPart extends Component, TData = unknown>(
    component: Constructor<TPart>,
    path: string,
): PartRef<TPart, TData> {
    return {
        kind: 'part',
        type: Prefab as unknown as Constructor<Prefab>,
        component,
        path,
    };
}

export function contentPackAssetRef<TAsset extends Asset>(
    type: Constructor<TAsset>,
    path: string,
): ContentPackAssetRef<TAsset> {
    return {
        kind: 'content-pack-asset',
        type,
        path,
    };
}

export function contentPackConfigRef<TValue = unknown>(
    table: string,
    options: { readonly primaryKey?: string; readonly codec?: string } = {},
): ContentPackConfigRef<TValue> {
    return {
        kind: 'content-pack-config',
        table,
        primaryKey: options.primaryKey ?? 'id',
        codec: options.codec ?? 'yzforge-json',
    };
}

export function defineAssets<TManifest>(manifest: TManifest): TManifest {
    return manifest;
}
