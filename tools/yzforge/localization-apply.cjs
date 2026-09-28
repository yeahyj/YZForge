'use strict';

/** Editor-only shared rules for live nodes and saved Creator assets. */
function textParameters(values = []) {
    const parameters = Object.create(null);
    for (const entry of values) {
        if (!entry?.name || Object.hasOwn(parameters, entry.name) || typeof entry.value !== 'string')
            throw Error('固定参数名为空、重复或参数值无效');
        parameters[entry.name] = entry.value;
    }
    return parameters;
}

function resolveValue(binding, current, fallback, assetUuid) {
    const field = binding.kind === 'sprite' ? 'assets' : 'texts';
    const catalog = Object.hasOwn(current[field], binding.key) ? current : fallback;
    if (!Object.hasOwn(catalog[field], binding.key)) throw Error('语言键不存在：' + binding.key);
    if (binding.kind === 'sprite') {
        const key = catalog.assets[binding.key];
        if (key.type !== 'SpriteFrame') throw Error('语言键不是图片：' + binding.key);
        return { spriteFrame: assetUuid(key), locale: catalog.locale };
    }
    const parameters = textParameters(binding.parameters);
    const text = catalog.texts[binding.key].replace(/\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g, (token, name) => {
        if (!name) return token === '{{' ? '{' : '}';
        if (!Object.hasOwn(parameters, name)) throw Error('缺少固定参数：' + name);
        return parameters[name];
    });
    const font = catalog.font ?? fallback.font;
    return { text, font: font ? assetUuid(font) : null, locale: catalog.locale };
}

/** Only alter existing native component fields; preserve node IDs, prefab links and overrides. */
function savedBindings(records, classes, source, decodeUuid) {
    if (!Array.isArray(records)) throw Error('无效的 Creator 序列化记录');
    const dereference = (value) => (value?.__id__ === undefined ? value : records[value.__id__]);
    const result = [];
    let nested = 0;
    for (const component of records) {
        if (!component || typeof component !== 'object') continue;
        const kind = classes.get(component.__type__) ?? classes.get(decodeUuid(component.__type__));
        if (!kind || !component.key) continue;
        const node = dereference(component.node);
        if (!node) throw Error('语言绑定缺少所属节点');
        let owner = source;
        const visited = new Set();
        for (let ancestor = node; ancestor && !visited.has(ancestor); ancestor = dereference(ancestor._parent)) {
            visited.add(ancestor);
            const uuid = dereference(ancestor._prefab)?.asset?.__uuid__;
            if (uuid) {
                owner = decodeUuid(uuid);
                break;
            }
        }
        // Nested instances are edited through Creator's live property API so their overrides remain valid.
        if (owner !== source) {
            nested++;
            continue;
        }
        const target = (node._components ?? [])
            .map(dereference)
            .find((item) => item?.__type__ === (kind === 'text' ? 'cc.Label' : 'cc.Sprite'));
        if (!target) throw Error(`${node._name}/${component.key}: 缺少原生显示组件`);
        result.push({
            node: node._name,
            kind,
            key: component.key,
            namespace: component.namespace || '',
            source: owner,
            parameters: (component.parameters ?? []).map(dereference),
            font: target._font?.__uuid__ ? decodeUuid(target._font.__uuid__) : '',
            target,
        });
    }
    return { bindings: result, nested };
}

function writeSavedValue(target, value, clearFont = false) {
    const asset = (uuid, type) => ({ __uuid__: uuid, __expectedType__: type });
    if (value.spriteFrame) target._spriteFrame = asset(value.spriteFrame, 'cc.SpriteFrame');
    else {
        target._string = value.text;
        if (value.font || clearFont) {
            target._font = value.font ? asset(value.font, 'cc.Font') : null;
            target._isSystemFontUsed = !value.font;
        }
    }
}

exports.textParameters = textParameters;
exports.resolveValue = resolveValue;
exports.savedBindings = savedBindings;
exports.writeSavedValue = writeSavedValue;
