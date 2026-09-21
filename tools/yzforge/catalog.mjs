import { readFile } from 'node:fs/promises';
import { relative, resolve, extname } from 'node:path';
import { json, files } from './project.mjs';
const kinds = {
    Prefab: 'prefab',
    SceneAsset: 'scene',
    SpriteFrame: 'sprite',
    Texture2D: 'texture',
    ImageAsset: 'image',
    AudioClip: 'audio',
    JsonAsset: 'json',
    TextAsset: 'text',
    Material: 'material',
    SpriteAtlas: 'atlas',
    Font: 'font',
};
const types = {
    prefab: 'Prefab',
    scene: 'SceneAsset',
    'sprite-frame': 'SpriteFrame',
    texture: 'Texture2D',
    image: 'ImageAsset',
    'audio-clip': 'AudioClip',
    json: 'JsonAsset',
    text: 'TextAsset',
    material: 'Material',
    'sprite-atlas': 'SpriteAtlas',
    'ttf-font': 'Font',
    'bitmap-font': 'Font',
};
export const identityFile = 'project-settings/generated/resource-identities.json';
export function logicalPath(value) {
    return value
        .split('/')
        .map((part) => {
            const name = part
                .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                .replace(/[ _]+/g, '-')
                .toLowerCase();
            if (!/^[a-z][a-z0-9-]*$/.test(name))
                throw Error(`资源路径无法自动生成稳定标识：${value}；请使用英文字母、数字和短横线`);
            return name;
        })
        .join('/');
}
export async function scanCatalog(root, modules, metadata, sources) {
    let previous = { formatVersion: 2, entries: {}, aliases: {} };
    try {
        previous = await json(resolve(root, identityFile));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (previous.formatVersion !== 2) throw Error('Unsupported resource identity version');
    const entries = Object.fromEntries(
        Object.entries(previous.entries).map(([id, item]) => [id, { ...item, active: false }]),
    );
    const issues = [],
        owners = new Map(),
        generatedTables = new Set();
    for (const module of modules) {
        for (const [id, registration] of Object.entries(module.assets ?? {})) {
            const key = registration.uuid + (registration.atlasFrame ? `#${registration.atlasFrame}` : '');
            const current = entries[key];
            if (current && current.id !== id) throw Error(`同一 UUID 被重复命名：${id} / ${current.id}`);
            entries[key] ??= { id, type: registration.type, active: false };
        }
        if (module.layoutVersion !== 2) continue;
        module.assets = {};
        for (const [group, bundle] of Object.entries(module.bundles)) {
            const dynamic = resolve(module.directory, bundle.root, 'dynamic');
            for (const table of sources.tables.filter((table) => table.id.split('.')[0] === module.id)) {
                const targets = table.shards ? Object.values(table.shards.targets) : [table.bundle ?? 'default'];
                if (targets.includes(group))
                    generatedTables.add(resolve(dynamic, 'config', `${table.id.split('.')[1]}.json`).toLowerCase());
            }
            for (const [uuid, asset] of metadata) {
                const local = relative(dynamic, asset.source).replaceAll('\\', '/');
                if (
                    !local ||
                    local.startsWith('../') ||
                    /^[a-z]:/i.test(local) ||
                    generatedTables.has(asset.source.toLowerCase())
                )
                    continue;
                const type = types[asset.importer];
                if (!type) {
                    if (!['directory', 'typescript', 'javascript', 'effect', 'auto-atlas'].includes(asset.importer))
                        issues.push(`${local}: 尚不支持动态入口类型 ${asset.importer}`);
                    continue;
                }
                const extension = extname(local),
                    path = local.slice(0, local.length - extension.length);
                // A texture's one SpriteFrame keeps the image name; atlas frames retain their own subasset names.
                const rootAsset = metadata.get(uuid.split('@')[0]);
                const suffix =
                    rootAsset?.importer === 'sprite-atlas' && asset.suffix
                        ? asset.suffix.replace(/^\//, '').replace(/\.[^./]+$/, '')
                        : '';
                const suggested = `${module.id}/${group}/${kinds[type]}/${logicalPath(path + (suffix ? '/' + suffix : ''))}`;
                const existing = entries[uuid];
                if (existing && !existing.id.startsWith(`${module.id}/${group}/`))
                    throw Error(`跨包移动需要显式迁移逻辑名：${existing.id} → ${suggested}`);
                const id = existing?.id ?? suggested;
                if (owners.has(id) && owners.get(id) !== uuid)
                    throw Error(`逻辑名冲突：${id} (${owners.get(id)} / ${uuid})`);
                const retired = Object.entries(entries).find(([other, item]) => other !== uuid && item.id === id);
                if (retired) throw Error(`名字属于旧资源 UUID：${id}；请显式替换或改名`);
                owners.set(id, uuid);
                entries[uuid] = { id, type, active: true, source: relative(root, asset.source).replaceAll('\\', '/') };
                module.assets[id] = { uuid, type };
            }
        }
    }
    if (issues.length) throw Error([...new Set(issues)].join('\n'));
    for (const module of modules.filter((item) => item.layoutVersion !== 2))
        for (const registration of Object.values(module.assets ?? {}))
            if (entries[registration.uuid]) entries[registration.uuid].active = true;
    return {
        formatVersion: 2,
        entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))),
        aliases: previous.aliases ?? {},
    };
}
/** Read-only serialization analysis; never rewrites .prefab/.scene/.meta. */
export async function scriptDependencies(modules, metadata) {
    const classes = new Map(),
        assets = new Map(),
        parsed = new Map();
    for (const [uuid, asset] of metadata) if (!uuid.includes('@')) assets.set(uuid, asset.source);
    for (const module of modules) {
        for (const file of await files(resolve(module.directory, 'code'), '.ts')) {
            const source = await readFile(file, 'utf8');
            for (const match of source.matchAll(/@ccclass\(\s*['"]([^'"]+)['"]\s*\)/g))
                classes.set(match[1], module.id);
            const meta = await json(`${file}.meta`).catch((error) => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            if (meta?.uuid) classes.set(meta.uuid, module.id);
        }
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const decode = (input) => {
        if (input.length !== 22 && input.length !== 23) return input;
        const start = input.length === 22 ? 2 : 5;
        let hex = input.slice(0, start);
        for (let i = start; i + 1 < input.length; i += 2) {
            const a = chars.indexOf(input[i]),
                b = chars.indexOf(input[i + 1]);
            if (a < 0 || b < 0) return input;
            hex += (a >> 2).toString(16) + (((a & 3) << 2) | (b >> 4)).toString(16) + (b & 15).toString(16);
        }
        return hex.length === 32
            ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
            : input;
    };
    async function direct(uuid) {
        if (parsed.has(uuid)) return parsed.get(uuid);
        const file = assets.get(uuid),
            result = { modules: new Set(), assets: new Set() };
        if (file && /\.(prefab|scene)$/.test(file)) {
            const body = await json(file);
            function walk(value) {
                if (!value || typeof value !== 'object') return;
                if (typeof value.__type__ === 'string') {
                    const module = classes.get(value.__type__) ?? classes.get(decode(value.__type__));
                    if (module) result.modules.add(module);
                }
                if (typeof value.__uuid__ === 'string') result.assets.add(value.__uuid__.split('@')[0]);
                for (const child of Object.values(value)) walk(child);
            }
            walk(body);
        }
        parsed.set(uuid, result);
        return result;
    }
    return async (uuid) => {
        const visited = new Set(),
            result = new Set();
        async function visit(id) {
            if (visited.has(id)) return;
            visited.add(id);
            const entry = await direct(id);
            for (const module of entry.modules) result.add(module);
            for (const next of entry.assets) await visit(next);
        }
        await visit(uuid.split('@')[0]);
        return [...result].sort();
    };
}
