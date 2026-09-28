'use strict';
const { randomUUID } = require('crypto');

exports.createMethods = function (cc, editRoot) {
    const pending = new Map();
    return {
        collectLocalizedNodes(source, selection) {
            const root = editRoot();
            if (!root) throw Error('请打开场景或预制体');
            const selected = selection ? new Set(selection) : null;
            if (selected && !selected.size) throw Error('请先选择节点');
            const bindings = [];
            const found = new Set();
            const visit = (node, included) => {
                if (selected?.has(node.uuid)) found.add(node.uuid);
                included ||= !selected || selected.has(node.uuid);
                if (included)
                    for (const component of node.components) {
                        const name = cc.js.getClassName(component);
                        const kind =
                            name === 'yzforge.LocalizedLabel'
                                ? 'text'
                                : name === 'yzforge.LocalizedSprite'
                                  ? 'sprite'
                                  : '';
                        if (!kind || !component.key) continue;
                        const target = node.getComponent(kind === 'text' ? cc.Label : cc.Sprite);
                        if (!target) throw Error(`${node.name}/${component.key}: 缺少原生显示组件`);
                        let owner = source;
                        for (let parent = node; parent; parent = parent.parent) {
                            const uuid = parent.prefab?.asset?.uuid;
                            if (uuid) {
                                owner = uuid;
                                break;
                            }
                        }
                        bindings.push({
                            node: node.uuid,
                            name: node.name,
                            component: component.uuid,
                            target: node.components.indexOf(target),
                            kind,
                            key: component.key,
                            namespace: component.namespace || '',
                            source: owner,
                            parameters: (component.parameters ?? []).map(({ name, value }) => ({ name, value })),
                            font: target.font?.uuid || '',
                            original:
                                kind === 'text'
                                    ? {
                                          string: target.string,
                                          font: target.font?.uuid || '',
                                          useSystemFont: target.useSystemFont,
                                      }
                                    : { spriteFrame: target.spriteFrame?.uuid || '' },
                        });
                    }
                for (const child of node.children) visit(child, included);
            };
            visit(root, false);
            if (selected && found.size !== selected.size) throw Error('选中节点不属于当前编辑内容');
            return { root: root.uuid, scene: cc.director.getScene()?.uuid, bindings };
        },
        async retainLocalizedAssets(values) {
            const assets = [];
            const token = randomUUID();
            try {
                const ids = new Map();
                for (const value of values) {
                    if (value.spriteFrame) ids.set(value.spriteFrame, cc.SpriteFrame);
                    if (value.font) ids.set(value.font, cc.Font);
                }
                for (const [uuid, type] of ids) {
                    const asset = await new Promise((resolve, reject) =>
                        cc.assetManager.loadAny(uuid, (error, value) => (error ? reject(error) : resolve(value))),
                    );
                    if (!(asset instanceof type)) throw Error('语言资源类型不匹配：' + uuid);
                    asset.addRef();
                    assets.push(asset);
                }
                pending.set(token, assets);
                return token;
            } catch (error) {
                for (const asset of assets) asset.decRef();
                throw error;
            }
        },
        releaseLocalizedAssets(token) {
            for (const asset of pending.get(token) ?? []) asset.decRef();
            pending.delete(token);
        },
    };
};
