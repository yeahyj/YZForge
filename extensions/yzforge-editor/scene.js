'use strict';
const cc = require('cc');
const { randomBytes } = require('crypto');
const { scanBindings, bindingShape } = require('../../tools/yzforge/generators/binding-scan.cjs');
const serialize = (value) => {
    if (!global.cce?.Utils?.serialize) throw Error('Creator scene serializer is unavailable');
    const data = cce.Utils.serialize(value);
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
};
const load = (uuid) =>
    new Promise((resolve, reject) =>
        cc.assetManager.loadAny(uuid, (error, asset) => (error ? reject(error) : resolve(asset))),
    );
function nodes(root, includeNestedRoot = true) {
    const result = [];
    const visit = (node, path) => {
        result.push({ node, path });
        for (const child of node.children) {
            if (child._prefab?.root === child && child !== root) {
                if (includeNestedRoot) result.push({ node: child, path: path ? path + '/' + child.name : child.name });
                continue;
            }
            visit(child, path ? `${path}/${child.name}` : child.name);
        }
    };
    visit(root, '');
    return result;
}
function scan(root, prefixes) {
    return scanBindings(cc, root, prefixes);
}
function ensurePrefabIds(root, prefab) {
    const { PrefabInfo, CompPrefabInfo } = cc.Prefab._utils;
    if (!PrefabInfo || !CompPrefabInfo) throw Error('Creator prefab identity constructors unavailable');
    for (const { node } of nodes(root, false)) {
        if (!node._prefab) {
            node._prefab = new PrefabInfo();
            node._prefab.fileId = randomBytes(16).toString('base64').replace(/=+$/, '');
        }
        node._prefab.root = root;
        node._prefab.asset = prefab;
        for (const component of node.components)
            if (!component.__prefab) {
                component.__prefab = new CompPrefabInfo();
                component.__prefab.fileId = randomBytes(16).toString('base64').replace(/=+$/, '');
            }
    }
}
exports.load = function () {};
exports.unload = function () {};
exports.methods = {
    ...require('./localization-scene').createMethods(cc, () => cce.Scene.rootNode),
    createPrefab(className, name, ui = false) {
        const ctor = cc.js.getClassByName(className);
        if (!ctor) throw Error(`Script not compiled: ${className}`);
        const root = new cc.Node(name);
        root.active = false;
        if (ui) {
            root.layer = cc.Layers.Enum.UI_2D;
            root.addComponent(cc.UITransform).setContentSize(100, 100);
        }
        root.addComponent(ctor);
        const prefab = new cc.Prefab();
        prefab.name = name;
        prefab.data = root;
        ensurePrefabIds(root, prefab);
        root.active = true;
        try {
            return serialize(prefab);
        } finally {
            root.destroy();
        }
    },
    async attachComponent(uuid, className, prefixes, plan) {
        const prefab = await load(uuid),
            ctor = cc.js.getClassByName(className);
        if (!(prefab instanceof cc.Prefab) || !ctor) throw Error('Prefab or compiled component unavailable');
        if (prefab.data.getComponent(ctor)) throw Error('Root already has this component');
        let fields = [];
        if (plan) {
            fields = scan(prefab.data, prefixes);
            if (
                ctor.__yzforgeBindingSignature !== plan.signature ||
                JSON.stringify(bindingShape(fields)) !== JSON.stringify(plan.fields)
            )
                throw Error('绑定脚本或预制体在创建期间发生变化');
        }
        const component = prefab.data.addComponent(ctor);
        try {
            for (const field of fields) component[field.field] = field.target;
            ensurePrefabIds(prefab.data, prefab);
            return serialize(prefab);
        } finally {
            // 此步骤只生成候选序列化内容，真正保存由后续 AssetDB 步骤执行。
            component.destroy();
        }
    },
    classReady(name, expected = {}) {
        const ctor = cc.js.getClassByName(name);
        return (
            !!ctor &&
            (!expected.signature || ctor.__yzforgeSourceSignature === expected.signature) &&
            (!expected.binding || ctor.__yzforgeBindingSignature === expected.binding) &&
            (!expected.ids || expected.ids.includes(cc.js._getClassId(ctor)))
        );
    },
    async scanPrefab(uuid, prefixes) {
        const prefab = await load(uuid);
        if (!(prefab instanceof cc.Prefab) || !prefab.data) throw Error('Target is not a Prefab');
        return scan(prefab.data, prefixes).map(({ target, ...field }) => field);
    },
    async bindPrefab(uuid, className, prefixes, plan) {
        const prefab = await load(uuid);
        if (!(prefab instanceof cc.Prefab) || !prefab.data) throw Error('Target is not a Prefab');
        const ctor = cc.js.getClassByName(className);
        if (!ctor) throw Error(`Wait for script compilation: ${className}`);
        const component = prefab.data.getComponent(ctor);
        if (!component) throw Error(`Prefab root is missing ${className}`);
        const fields = scan(prefab.data, prefixes),
            serialized = new Set(ctor.__props__ || []);
        if (plan) {
            if (JSON.stringify(bindingShape(fields)) !== JSON.stringify(plan.fields))
                throw Error('预制体节点或组件在生成期间发生变化，请重新扫描绑定');
            if (ctor.__yzforgeBindingSignature !== plan.signature) throw Error('Generated binding is not compiled yet');
        }
        for (const field of fields)
            if (!serialized.has(field.field)) throw Error(`Generated field is not compiled yet: ${field.field}`);
        for (const name of serialized) if (name.startsWith('_bind')) component[name] = null;
        for (const field of fields) component[field.field] = field.target;
        for (const field of fields)
            if (component[field.field] !== field.target) throw Error(`Binding write failed: ${field.name}`);
        return { content: serialize(prefab), fields: fields.map(({ target, ...field }) => field) };
    },
    createView(className, name, size) {
        if (
            !size ||
            !Number.isFinite(size.width) ||
            !Number.isFinite(size.height) ||
            size.width <= 0 ||
            size.height <= 0
        )
            throw Error('View size must come from the project design resolution');
        const ctor = cc.js.getClassByName(className);
        if (!ctor) throw Error(`Script not compiled: ${className}`);
        const root = new cc.Node(name);
        root.layer = cc.Layers.Enum.UI_2D;
        root.active = false;
        root.addComponent(cc.UITransform).setContentSize(size.width, size.height);
        root.addComponent(ctor);
        const prefab = new cc.Prefab();
        prefab.name = name;
        prefab.data = root;
        ensurePrefabIds(root, prefab);
        root.active = true;
        try {
            return serialize(prefab);
        } finally {
            root.destroy();
        }
    },
    async validateBinding(uuid, className, prefixes) {
        const prefab = await load(uuid),
            ctor = cc.js.getClassByName(className);
        if (!ctor || !prefab?.data) throw Error('Prefab or compiled class unavailable');
        const component = prefab.data.getComponent(ctor);
        if (!component) throw Error('View component missing');
        const fields = scan(prefab.data, prefixes);
        const missing = fields.filter((field) => component[field.field] !== field.target).map((field) => field.path);
        if (missing.length) throw Error(`Stale bindings: ${missing.join(', ')}`);
        return { className, bound: fields.length, fields: fields.map((field) => field.name) };
    },
};
