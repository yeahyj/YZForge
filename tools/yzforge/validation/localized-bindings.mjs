import { relative, resolve, isAbsolute } from 'node:path';
import { json } from '../project/project.mjs';
import { decodeUuid } from '../project/catalog.mjs';
import layout from '../project/localization-layout.cjs';

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
        if (!['text', 'sprite'].includes(kind) || (!component.key && !component.namespace)) continue;
        const node = dereference(component.node);
        const label = `${node?._name ?? '节点'}/${component.key || '(空键)'}`;
        const has = (target, type) =>
            target &&
            records.some(
                (item) =>
                    item &&
                    dereference(item.node) === target &&
                    (classes.get(item.__type__) ?? classes.get(decodeUuid(item.__type__)) ?? item.__type__) === type,
            );
        if (kind === 'text' && has(node, 'countdown'))
            throw Error(`${label}: CountdownLabel 不能叠加 LocalizedLabel，请使用 bindCountdownFormat 绑定计时格式`);
        if (kind === 'text' && (has(node, 'marquee') || has(dereference(node?._parent), 'marquee')))
            throw Error(`${label}: 滚动文字请使用 bindText(MarqueeLabel, key)，不要绑定内部 Label`);
        if (kind === 'sprite' && has(node, 'async-sprite'))
            throw Error(`${label}: AsyncSprite 与 LocalizedSprite 会争抢图片，请使用普通 Sprite 进行语言绑定`);
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

/** Prefab 实例只保存差异；按 Creator 的 localID 链定位源组件，再检查叠加后的语言字段。 */
export function validateLocalizedOverrides(records, classes, catalogs, sources, prefabs) {
    const deref = (list, value) => (value?.__id__ === undefined ? value : list[value.__id__]);
    const unpack = (list, value) => {
        value = deref(list, value);
        if (!value || typeof value !== 'object') return value;
        return Array.isArray(value)
            ? value.map((item) => unpack(list, item))
            : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(list, item)]));
    };
    const relevant = (change) => ['key', 'namespace', 'parameters'].includes(change?.propertyPath?.[0]);
    const apply = (target, list, overrides, ids) => {
        const kind = classes.get(target.component.__type__) ?? classes.get(decodeUuid(target.component.__type__));
        if (!['text', 'sprite'].includes(kind)) return target;
        for (const reference of overrides ?? []) {
            const change = deref(list, reference);
            if (!relevant(change) || JSON.stringify(deref(list, change.targetInfo)?.localID) !== JSON.stringify(ids))
                continue;
            const path = change.propertyPath;
            let object = target.component;
            for (const field of path.slice(0, -1)) {
                if (!Object.hasOwn(object, field) || !object[field] || typeof object[field] !== 'object')
                    throw Error('无效多语言参数覆盖：' + path.join('.'));
                object = object[field];
            }
            const field = path.at(-1);
            if (['__proto__', 'constructor', 'prototype'].includes(field)) throw Error('无效多语言覆盖字段');
            object[field] = unpack(list, change.value);
        }
        return target;
    };
    const sourceOf = (list, instance) => list.find((item) => deref(list, item?.instance) === instance)?.asset?.__uuid__;
    const targetOf = (uuid, ids, visiting = new Set()) => {
        uuid = decodeUuid(uuid);
        const signature = JSON.stringify([uuid, ids]);
        if (!ids?.length || visiting.has(signature)) throw Error('无效或循环的预制体覆盖目标');
        visiting.add(signature);
        const list = prefabs.get(uuid);
        if (!list) throw Error('找不到预制体覆盖来源：' + uuid);
        if (ids.length > 1) {
            const instance = list.find((item) => item?.__type__ === 'cc.PrefabInstance' && item.fileId === ids[0]);
            if (!instance) throw Error('找不到嵌套预制体实例：' + ids[0]);
            const rest = ids.slice(1);
            return apply(targetOf(sourceOf(list, instance), rest, visiting), list, instance.propertyOverrides, rest);
        }
        const source = list.find((item) => deref(list, item?.__prefab)?.fileId === ids[0]);
        if (!source) throw Error('找不到预制体覆盖组件：' + ids[0]);
        const kind = classes.get(source.__type__) ?? classes.get(decodeUuid(source.__type__));
        // 业务组件也可能有 key、namespace 字段，不把它们当成多语言绑定。
        if (!['text', 'sprite'].includes(kind)) return { component: { __type__: source.__type__ } };
        return {
            namespace: localizedNamespace(list, { ...source, namespace: '' }, sources[uuid], sources),
            component: {
                __type__: source.__type__,
                key: source.key,
                namespace: source.namespace,
                parameters: unpack(list, source.parameters ?? []),
                node: { __id__: 1 },
            },
            node: { _name: deref(list, source.node)?._name ?? '预制体实例' },
        };
    };
    for (const instance of records) {
        if (instance?.__type__ !== 'cc.PrefabInstance') continue;
        const targets = new Map();
        for (const reference of instance.propertyOverrides ?? []) {
            const change = deref(records, reference);
            if (!relevant(change)) continue;
            const ids = deref(records, change.targetInfo)?.localID;
            targets.set(JSON.stringify(ids), ids);
        }
        for (const ids of targets.values()) {
            const target = targetOf(sourceOf(records, instance), ids);
            const kind = classes.get(target.component.__type__) ?? classes.get(decodeUuid(target.component.__type__));
            if (!['text', 'sprite'].includes(kind)) continue;
            apply(target, records, instance.propertyOverrides, ids);
            validateLocalizedRecords([target.component, target.node], classes, catalogs, target.namespace);
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

export async function validateLocalizedBindings(
    root,
    metadata,
    localization,
    modules = [],
    { forBuild = false, collect = false } = {},
) {
    const errors = [];
    const classes = new Map([
        ['yzforge.LocalizedLabel', 'text'],
        ['yzforge.LocalizedSprite', 'sprite'],
        ['yzforge.CountdownLabel', 'countdown'],
        ['yzforge.MarqueeLabel', 'marquee'],
        ['yzforge.AsyncSprite', 'async-sprite'],
    ]);
    for (const [uuid, asset] of metadata) {
        const file = relative(root, asset.source).replaceAll('\\', '/');
        if (file === 'assets/framework/ui/localization/localized-label.ts') classes.set(uuid, 'text');
        if (file === 'assets/framework/ui/localization/localized-sprite.ts') classes.set(uuid, 'sprite');
        if (file === 'assets/framework/ui/components/countdown/countdown-label.ts') classes.set(uuid, 'countdown');
        if (file === 'assets/framework/ui/components/marquee/marquee-label.ts') classes.set(uuid, 'marquee');
        if (file === 'assets/framework/ui/components/async-sprite/async-sprite.ts') classes.set(uuid, 'async-sprite');
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
    const saved = new Map();
    for (const [uuid, asset] of metadata) {
        if (uuid.includes('@') || !['prefab', 'scene'].includes(asset.importer)) continue;
        saved.set(uuid, await json(asset.source));
    }
    for (const [uuid, asset] of metadata) {
        if (uuid.includes('@') || !['prefab', 'scene'].includes(asset.importer)) continue;
        try {
            const records = saved.get(uuid);
            validateLocalizedRecords(records, classes, catalogs, sources[uuid], sources);
            validateLocalizedOverrides(records, classes, catalogs, sources, saved);
            if (forBuild && !languageOf(asset.source))
                validateDefaultLanguageReferences(records, languageAssets, localization.release?.defaultLocale);
        } catch (error) {
            errors.push(`${relative(root, asset.source)}: ${error.message}`);
        }
    }
    if (errors.length && !collect) throw Error(errors.join('\n'));
    return errors;
}
