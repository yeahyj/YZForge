import { invariant } from '../core/errors';
import { AssetAddress, AssetKey, AssetKind, NamespaceIndex } from './asset-types';
const kinds: Record<AssetKind, string> = { Prefab: 'prefab', SpriteFrame: 'sprite', Texture2D: 'texture', ImageAsset: 'image', AudioClip: 'audio', JsonAsset: 'json', TextAsset: 'text', Material: 'material', SpriteAtlas: 'atlas', Font: 'font', SceneAsset: 'scene' };
export const assetKinds = Object.freeze(kinds);
const segment = /^[a-z][a-z0-9-]*$/;
export function logicalKey(name: string, type: AssetKind, namespace?: string): AssetKey {
  invariant(type in kinds, 'ASSET_TYPE_UNKNOWN', `Unsupported asset kind: ${type}`);
  const id = name.includes('/') ? name : `${namespace ?? ''}/${kinds[type]}/${name}`;
  const parts = id.split('/');
  invariant(parts.length === 4 && parts.every(part => segment.test(part)) && parts[2] === kinds[type], 'ASSET_ID_INVALID', `Use a complete logical id or an explicit namespace: ${id}`);
  return { id, type };
}
export function validateIndex(value: unknown, namespace: string): NamespaceIndex {
  const index = value as NamespaceIndex;
  invariant(index?.formatVersion === 1 && index.namespace === namespace && index.assets && typeof index.assets === 'object', 'ASSET_INDEX_INVALID', `Invalid namespace index: ${namespace}`);
  for (const [id, address] of Object.entries(index.assets)) {
    logicalKey(id, address.type);
    invariant(id.startsWith(`${namespace}/`) && typeof address.bundle === 'string' && typeof address.path === 'string' && address.path.length > 0 && !address.path.split('/').includes('..'), 'ASSET_ADDRESS_INVALID', `Invalid address: ${id}`);
    invariant(address.atlasFrame === undefined || (address.type === 'SpriteFrame' && address.atlasFrame.length > 0), 'ASSET_ADDRESS_INVALID', `Invalid atlas frame: ${id}`);
  }
  return index;
}
export function resolveIndex(index: NamespaceIndex, key: AssetKey): AssetAddress {
  const address = index.assets[key.id];
  invariant(address, 'ASSET_NOT_REGISTERED', `Resource is not registered: ${key.id}`);
  invariant(address.type === key.type, 'ASSET_TYPE_MISMATCH', `Resource kind differs: ${key.id}`);
  return address;
}
