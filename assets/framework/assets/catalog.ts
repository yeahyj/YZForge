import { invariant } from '../core/errors';
import { AssetAddress, AssetKey, AssetKind, NamespaceIndex } from './asset-types';
const kinds: Record<AssetKind, string> = {
    Prefab: 'prefab',
    SpriteFrame: 'sprite',
    Texture2D: 'texture',
    ImageAsset: 'image',
    AudioClip: 'audio',
    JsonAsset: 'json',
    TextAsset: 'text',
    Material: 'material',
    SpriteAtlas: 'atlas',
    Font: 'font',
    SceneAsset: 'scene',
};
export const assetKinds = Object.freeze(kinds);
const segment = /^[a-z][a-z0-9-]*$/;
export function logicalKey(name: string, type: AssetKind, namespace?: string): AssetKey {
    invariant(type in kinds, 'ASSET_TYPE_UNKNOWN', `Unsupported asset kind: ${type}`);
    const id = namespace ? `${namespace}/${kinds[type]}/${name}` : name;
    const parts = id.split('/');
    invariant(
        parts.length >= 4 && parts.every((part) => segment.test(part)) && parts[2] === kinds[type],
        'ASSET_ID_INVALID',
        `Use a complete logical id or an explicit namespace: ${id}`,
    );
    return { id, type };
}
export function validateIndex(value: unknown, namespace: string): NamespaceIndex {
    const index = value as NamespaceIndex;
    invariant(
        (index?.formatVersion === 1 || index?.formatVersion === 2) &&
            index.namespace === namespace &&
            index.assets &&
            typeof index.assets === 'object' &&
            !Array.isArray(index.assets),
        'ASSET_INDEX_INVALID',
        `Invalid namespace index: ${namespace}`,
    );
    for (const [id, address] of Object.entries(index.assets)) {
        invariant(address && typeof address === 'object', 'ASSET_ADDRESS_INVALID', id);
        logicalKey(id, address.type);
        invariant(index.formatVersion !== 1 || id.split('/').length === 4, 'ASSET_INDEX_INVALID', id);
        invariant(
            id.startsWith(`${namespace}/`) &&
                typeof address.bundle === 'string' &&
                typeof address.path === 'string' &&
                address.path.length > 0 &&
                !address.path.split('/').includes('..'),
            'ASSET_ADDRESS_INVALID',
            `Invalid address: ${id}`,
        );
        invariant(
            address.atlasFrame === undefined || (address.type === 'SpriteFrame' && address.atlasFrame.length > 0),
            'ASSET_ADDRESS_INVALID',
            `Invalid atlas frame: ${id}`,
        );
        invariant(
            address.requiredCodeModules === undefined ||
                (Array.isArray(address.requiredCodeModules) &&
                    address.requiredCodeModules.every((module) => segment.test(module))),
            'ASSET_ADDRESS_INVALID',
            `Invalid code dependencies: ${id}`,
        );
    }
    invariant(
        index.aliases === undefined ||
            (!!index.aliases && typeof index.aliases === 'object' && !Array.isArray(index.aliases)),
        'ASSET_ALIAS_INVALID',
        namespace,
    );
    for (const [alias, target] of Object.entries(index.aliases ?? {})) {
        invariant(typeof target === 'string', 'ASSET_ALIAS_INVALID', alias);
        const address = index.assets[target];
        invariant(address && !index.assets[alias] && !index.aliases?.[target], 'ASSET_ALIAS_INVALID', alias);
        logicalKey(alias, address.type);
        invariant(alias.startsWith(`${namespace}/`), 'ASSET_ALIAS_INVALID', alias);
    }
    return index;
}
export function resolveIndex(index: NamespaceIndex, key: AssetKey, shortName = false): AssetAddress {
    let id = index.aliases?.[key.id] ?? key.id;
    if (shortName && !index.aliases?.[key.id] && key.id.split('/').length === 4) {
        const basename = key.id.split('/').pop();
        const candidates = Object.keys(index.assets).filter(
            (candidate) => index.assets[candidate].type === key.type && candidate.split('/').pop() === basename,
        );
        invariant(
            candidates.length <= 1,
            'ASSET_NAME_AMBIGUOUS',
            `Use a relative path or AssetKey: ${candidates.join(', ')}`,
        );
        if (candidates.length === 1 && !index.aliases?.[key.id]) id = candidates[0];
    }
    const address = index.assets[id];
    invariant(address, 'ASSET_NOT_REGISTERED', `Resource is not registered: ${key.id}`);
    invariant(address.type === key.type, 'ASSET_TYPE_MISMATCH', `Resource kind differs: ${key.id}`);
    return address;
}
