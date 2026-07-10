import { Asset, Component, Prefab } from 'cc';
import type { Constructor } from './types';
import type { YZForgeRuntimeAbi } from './runtime-version';

export interface NamedRef {
    readonly abi: YZForgeRuntimeAbi;
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
    readonly name: string;
    readonly bundle: string;
    readonly dependencies: readonly string[];
    readonly contentHash: string;
    readonly refs: Readonly<Record<string, ContentPackManifestRef>>;
}

export interface ContentPackRef<TContract = unknown, TConfig = unknown> {
    readonly kind: 'content-pack';
    readonly abi: YZForgeRuntimeAbi;
    readonly id: string;
    readonly owner: string;
    readonly name: string;
    readonly bundle: string;
    readonly libraries: readonly LibraryRef[];
    readonly contract: TContract;
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

export interface ContentPackAssetContract<TAsset extends Asset = Asset> {
    readonly kind: 'content-pack-asset-contract';
    readonly type: Constructor<TAsset>;
}

export interface ContentPackConfigContract<TValue = unknown> {
    readonly kind: 'content-pack-config-contract';
    readonly primaryKey: string;
    readonly __value?: TValue;
}

export type MaterializedContentPackRef<TContract> = TContract extends ContentPackAssetContract<infer TAsset>
    ? ContentPackAssetRef<TAsset>
    : TContract extends ContentPackConfigContract<infer TValue>
        ? ContentPackConfigRef<TValue>
        : never;

export type MaterializedContentPackRefs<TContract> = {
    readonly [TKey in keyof TContract]: MaterializedContentPackRef<TContract[TKey]>;
};

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

export function defineContentPack<TContract = unknown, TConfig = unknown>(
    options: Omit<ContentPackRef<TContract, TConfig>, 'kind'>,
): ContentPackRef<TContract, TConfig> {
    const libraries = options.libraries ?? [];
    return {
        ...options,
        kind: 'content-pack',
        libraries,
    };
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

export function contentPackAssetContract<TAsset extends Asset>(
    type: Constructor<TAsset>,
): ContentPackAssetContract<TAsset> {
    return {
        kind: 'content-pack-asset-contract',
        type,
    };
}

export function contentPackConfigContract<TValue = unknown>(
    options: { readonly primaryKey?: string } = {},
): ContentPackConfigContract<TValue> {
    return {
        kind: 'content-pack-config-contract',
        primaryKey: options.primaryKey ?? 'id',
    };
}

export function defineAssets<TManifest>(manifest: TManifest): TManifest {
    return manifest;
}
