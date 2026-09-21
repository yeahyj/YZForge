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
/**
 * Cocos 资源种类对应的逻辑 ID 段，例如 SpriteFrame → sprite、Prefab → prefab。
 * 只读映射，生成器和运行时必须采用同一套命名。
 */
export const assetKinds = Object.freeze(kinds);
const segment = /^[a-z][a-z0-9-]*$/;
/**
 * 构造并校验逻辑资源键，不读取清单、不检查资源是否存在。
 * @param name - 未提供 namespace 时为完整 ID；提供 namespace 时为资源相对名称或路径。
 * @param type - Cocos 资源种类，例如 SpriteFrame。
 * @param namespace - 可选“模块/资源包”，例如 lobby/default。
 * @returns 校验后的 AssetKey。
 * @throws FrameworkError 名称段不满足小写字母开头、数字或连字符规则，或种类不匹配。
 */
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
/**
 * @internal
 * 检查索引版本、命名空间、资源地址和别名结构，供加载器使用；失败抛出 FrameworkError。
 * @param value - 从 JsonAsset 读取的未知数据。
 * @param namespace - 预期的“模块/资源包”。
 * @returns 通过校验的索引对象；不会加载其中的资源。
 */
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
/**
 * @internal
 * 从已经加载的清单解析资源地址，支持别名和可选的唯一短名称匹配。
 * @param index - 已校验的命名空间索引。
 * @param key - 待查的逻辑 ID 和资源种类。
 * @param shortName - 默认 false；为 true 且 ID 只有四段时，允许按文件末段查找唯一候选。
 * @returns 清单中的资源地址；不会下载目标资源。
 * @throws FrameworkError 名称有歧义、资源未登记或种类不匹配。
 */
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
