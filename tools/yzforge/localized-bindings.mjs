import { relative, resolve, isAbsolute } from 'node:path';
import { json } from './project.mjs';
import { decodeUuid } from './catalog.mjs';
import layout from './localization-layout.cjs';

/** 与运行时一致：最近源预制体优先，普通场景回退文件归属。 */
export function localizedNamespace(records, component, namespace = '', sources = {}) {
    if (component.namespace) return component.namespace;
    const dereference = (value) => (value?.__id__ === undefined ? value : records[value.__id__]);
    const visited = new Set();
    for (let node = dereference(component.node); node && !visited.has(node); node = dereference(node._parent)) {
        visited.add(node);
        const source = dereference(node._prefab)?.asset?.__uuid__;
        if (source) return sources[decodeUuid(source)] ?? '';
    }
    return namespace;
}

/** 检查原生组件保存的字符串键，错误在生成/构建前定位到预制体和节点。 */
export function validateLocalizedRecords(records, classes, catalogs, namespace = '', sources = {}) {
    if (!Array.isArray(records)) throw Error('无效的 Creator 序列化记录');
    const dereference = (value) => (value?.__id__ === undefined ? value : records[value.__id__]);
    for (const component of records) {
        if (!component || typeof component !== 'object') continue;
        const kind = classes.get(component.__type__) ?? classes.get(decodeUuid(component.__type__));
        if (!kind || (!component.key && !component.namespace)) continue;
        const node = dereference(component.node);
        const label = `${node?._name ?? '节点'}/${component.key || '(空键)'}`;
        const resolved = localizedNamespace(records, component, namespace, sources);
        const catalog = catalogs.get(resolved);
        if (!catalog) throw Error(`${label}: 未登记多语言业务包 ${resolved || '自动归属失败，请指定跨包来源'}`);
        if (kind === 'sprite') {
            if (catalog.assets[component.key]?.type !== 'SpriteFrame')
                throw Error(`${label}: 找不到 SpriteFrame 语言键`);
        } else {
            if (!Object.hasOwn(catalog.texts, component.key)) throw Error(`${label}: 找不到文案语言键`);
            const parameters = new Map();
            for (const value of component.parameters ?? []) {
                const item = dereference(value);
                if (!item?.name || parameters.has(item.name) || typeof item.value !== 'string')
                    throw Error(`${label}: 固定参数无效或重复`);
                parameters.set(item.name, item.value);
            }
            for (const match of catalog.texts[component.key].matchAll(/\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g))
                if (match[1] && !parameters.has(match[1])) throw Error(`${label}: 缺少固定参数 ${match[1]}`);
        }
    }
}

/** 构建前定位误存入资源的其他语言图片、字体等直接引用。普通编辑/生成允许查看其他语言。 */
export function validateDefaultLanguageReferences(records, languageAssets, defaultLocale) {
    const dereference = (value) => (value?.__id__ === undefined ? value : records[value.__id__]);
    const scan = (value, label) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.__uuid__ === 'string') {
            const [base, sub] = value.__uuid__.split('@');
            const uuid = decodeUuid(base) + (sub ? '@' + sub : '');
            const locale = languageAssets.get(uuid) ?? languageAssets.get(decodeUuid(base));
            if (locale && locale !== defaultLocale)
                throw Error(
                    `${label}: 直接引用了 ${locale} 语言资源 ${value.__uuid__}，请在多语言面板应用默认语言 ${defaultLocale}`,
                );
        }
        for (const child of Object.values(value)) scan(child, label);
    };
    for (const record of records)
        scan(record, dereference(record?.node)?._name ?? record?._name ?? record?.__type__ ?? '节点');
}

export async function validateLocalizedBindings(root, metadata, localization, modules = [], { forBuild = false } = {}) {
    const classes = new Map([
        ['yzforge.LocalizedLabel', 'text'],
        ['yzforge.LocalizedSprite', 'sprite'],
    ]);
    for (const [uuid, asset] of metadata) {
        const file = relative(root, asset.source).replaceAll('\\', '/');
        if (file === 'assets/framework/localization/localized-label.ts') classes.set(uuid, 'text');
        if (file === 'assets/framework/localization/localized-sprite.ts') classes.set(uuid, 'sprite');
    }
    const catalogs = new Map();
    for (const [path, content] of Object.entries(localization.output)) {
        if (!path.endsWith('/yz-locale.json')) continue;
        const catalog = JSON.parse(content);
        if (catalog.locale === localization.release?.defaultLocale) catalogs.set(catalog.namespace, catalog);
    }
    const sources = {};
    for (const [uuid, asset] of metadata) {
        if (uuid.includes('@') || !['prefab', 'scene'].includes(asset.importer)) continue;
        const namespace = layout.sourceNamespace(asset.source, modules);
        if (catalogs.has(namespace)) sources[uuid] = namespace;
    }
    if (localization.release) localization.release.sources = sources;
    const languageRoots = modules.flatMap((module) =>
        Object.values(layout.physicalBundles(module))
            .filter((bundle) => bundle.language)
            .map((bundle) => ({ directory: resolve(module.directory, bundle.root), locale: bundle.language.locale })),
    );
    const languageAssets = new Map();
    const languageOf = (source) =>
        languageRoots.find(({ directory }) => {
            const local = relative(directory, source);
            return local && !local.startsWith('..') && !isAbsolute(local);
        })?.locale;
    if (forBuild)
        for (const [uuid, asset] of metadata) {
            const locale = languageOf(asset.source);
            if (locale) languageAssets.set(uuid, locale);
        }
    for (const [uuid, asset] of metadata) {
        if (uuid.includes('@') || !['prefab', 'scene'].includes(asset.importer)) continue;
        try {
            const records = await json(asset.source);
            validateLocalizedRecords(records, classes, catalogs, sources[uuid], sources);
            if (forBuild && !languageOf(asset.source))
                validateDefaultLanguageReferences(records, languageAssets, localization.release?.defaultLocale);
        } catch (error) {
            throw Error(`${relative(root, asset.source)}: ${error.message}`, { cause: error });
        }
    }
}
