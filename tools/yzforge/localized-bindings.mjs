import { relative } from 'node:path';
import { json } from './project.mjs';
import { decodeUuid } from './catalog.mjs';

/** 检查原生组件保存的字符串键，错误在生成/构建前定位到预制体和节点。 */
export function validateLocalizedRecords(records, classes, catalogs) {
    if (!Array.isArray(records)) throw Error('无效的 Creator 序列化记录');
    const dereference = (value) => (value?.__id__ === undefined ? value : records[value.__id__]);
    for (const component of records) {
        if (!component || typeof component !== 'object') continue;
        const kind = classes.get(component.__type__) ?? classes.get(decodeUuid(component.__type__));
        if (!kind || (!component.key && !component.namespace)) continue;
        const label = `${dereference(component.node)?._name ?? '节点'}/${component.key || '(空键)'}`;
        const catalog = catalogs.get(component.namespace);
        if (!catalog) throw Error(`${label}: 未登记多语言业务包 ${component.namespace}`);
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

export async function validateLocalizedBindings(root, metadata, localization) {
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
    for (const [uuid, asset] of metadata) {
        if (uuid.includes('@') || !['prefab', 'scene'].includes(asset.importer)) continue;
        try {
            validateLocalizedRecords(await json(asset.source), classes, catalogs);
        } catch (error) {
            throw Error(`${relative(root, asset.source)}: ${error.message}`, { cause: error });
        }
    }
}
