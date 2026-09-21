import type {
    AudioClip,
    Font,
    ImageAsset,
    JsonAsset,
    Material,
    Prefab,
    SceneAsset,
    SpriteAtlas,
    SpriteFrame,
    TextAsset,
    Texture2D,
} from 'cc';
export interface AssetTypes {
    Prefab: Prefab;
    SpriteFrame: SpriteFrame;
    Texture2D: Texture2D;
    ImageAsset: ImageAsset;
    AudioClip: AudioClip;
    JsonAsset: JsonAsset;
    TextAsset: TextAsset;
    Material: Material;
    SpriteAtlas: SpriteAtlas;
    Font: Font;
    SceneAsset: SceneAsset;
}
export type AssetKind = keyof AssetTypes;
export interface AssetKey<K extends AssetKind = AssetKind> {
    readonly id: string;
    readonly type: K;
}
export interface AssetAddress<K extends AssetKind = AssetKind> {
    readonly bundle: string;
    readonly path: string;
    readonly type: K;
    readonly revision?: string;
    readonly atlasFrame?: string;
    readonly codeModule?: string;
    readonly requiredCodeModules?: readonly string[];
}
export interface BundleDefinition {
    readonly id: string;
    readonly location?: string;
    readonly version?: string;
    readonly dependencies?: readonly string[];
    readonly namespace?: string;
}
export interface NamespaceIndex {
    readonly formatVersion: 1 | 2;
    readonly namespace: string;
    readonly assets: Readonly<Record<string, AssetAddress>>;
    readonly aliases?: Readonly<Record<string, string>>;
}
export interface TableRoute {
    readonly bundle: string;
    readonly path: string;
    readonly dataRevision: string;
}
export interface ContentRelease {
    readonly releaseId: string;
    readonly bundles: Readonly<Record<string, BundleDefinition>>;
    readonly namespaces: Readonly<Record<string, { readonly bundle: string; readonly path: string }>>;
    readonly tables: Readonly<Record<string, readonly TableRoute[]>>;
}
export type BundleRef = string | { readonly id: string };
export const bundleId = (ref: BundleRef): string => (typeof ref === 'string' ? ref : ref.id);
