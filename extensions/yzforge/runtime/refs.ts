import { Asset, Component, Prefab } from 'cc';
import type { Constructor } from './types';

export interface NamedRef {
    readonly name: string;
    readonly bundle: string;
}

export interface LibraryRef<TTokens = unknown> extends NamedRef {
    readonly kind: 'library';
    readonly libraries: readonly LibraryRef[];
    readonly __tokens?: TTokens;
}

export interface ModuleRef<TParams = unknown> extends NamedRef {
    readonly kind: 'module';
    readonly libraries: readonly LibraryRef[];
    readonly __params?: TParams;
}

export interface ContentPackRef<TRefs = unknown, TConfig = unknown> {
    readonly kind: 'content-pack';
    readonly id: string;
    readonly owner: string;
    readonly name?: string;
    readonly bundle: string;
    readonly libraries: readonly LibraryRef[];
    readonly refs: TRefs;
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

export function defineModuleRef<TParams = unknown>(
    options: Omit<ModuleRef<TParams>, 'kind'>,
): ModuleRef<TParams> {
    return {
        ...options,
        kind: 'module',
        libraries: options.libraries ?? [],
    };
}

export function defineLibraryRef<TTokens = unknown>(
    options: Omit<LibraryRef<TTokens>, 'kind'>,
): LibraryRef<TTokens> {
    return {
        ...options,
        kind: 'library',
        libraries: options.libraries ?? [],
    };
}

export function defineContentPack<TRefs = unknown, TConfig = unknown>(
    options: Omit<ContentPackRef<TRefs, TConfig>, 'kind'>,
): ContentPackRef<TRefs, TConfig> {
    return {
        ...options,
        kind: 'content-pack',
        libraries: options.libraries ?? [],
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
    component: Constructor<TView>,
    path: string,
    policy: ViewPolicyLike,
): ViewRef<TData, TResult, TView> {
    return {
        kind: 'view',
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

export function contentPackConfigRef<TValue = unknown>(table: string): ContentPackConfigRef<TValue> {
    return {
        kind: 'content-pack-config',
        table,
    };
}

export function defineAssets<TManifest>(manifest: TManifest): TManifest {
    return manifest;
}
