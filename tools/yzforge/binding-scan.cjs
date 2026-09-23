'use strict';

/** 扫描命名节点；只进入当前预制体，嵌套预制体仅暴露根节点。 */
function scanBindings(cc, root, prefixes) {
    const fields = [],
        names = new Set();
    const builtin = (ctor) => Object.values(cc).includes(ctor) || cc.js.getClassName(ctor).startsWith('cc.');
    const visit = (node, path, descend = true) => {
        const match = /^([a-z]+)_([a-zA-Z][a-zA-Z0-9_]*?)$/.exec(node.name);
        if (match && Object.hasOwn(prefixes, match[1])) {
            const type = prefixes[match[1]],
                ctor = cc[type];
            if (!ctor) throw Error(`${path || node.name}: 不支持的绑定类型 ${type}`);
            if (match[2].split('_').some((part) => !part))
                throw Error(`${path || node.name}: 绑定名称不能以下划线结尾或包含连续下划线`);
            const candidates =
                type === 'Node'
                    ? [node]
                    : node
                          .getComponents(ctor)
                          .filter((component) => type !== 'Component' || !builtin(component.constructor));
            if (!candidates.length)
                throw Error(`${path || node.name}: 未找到 ${type === 'Component' ? '自定义组件' : type}`);
            // 与 getComponent 一致，按 Inspector 顺序取第一个匹配项。
            const target = candidates[0],
                actual = target.constructor;
            const suffix = match[2]
                .split('_')
                .map((part) => part[0].toUpperCase() + part.slice(1))
                .join('');
            const name = `${match[1]}${suffix}`,
                field = `_bind${name[0].toUpperCase()}${name.slice(1)}`;
            if (names.has(name)) throw Error(`${path || node.name}: 绑定名称重复 ${name}，请重命名节点`);
            names.add(name);
            // 引擎内置派生类保留前缀类型；项目脚本必须解析到真实导出，不能静默退回基础类型。
            const custom =
                type !== 'Node' && !builtin(actual)
                    ? {
                          classId: cc.js._getClassId(actual),
                          className: cc.js.getClassName(actual),
                          runtimeName: actual.name,
                      }
                    : undefined;
            fields.push({ name, field, type, path, nodeName: node.name, ...(custom ? { custom } : {}), target });
        }
        if (descend)
            for (const child of node.children)
                visit(child, path ? `${path}/${child.name}` : child.name, child._prefab?.root !== child);
    };
    visit(root, '');
    return fields;
}

/** 删除引擎对象及源码解析结果，供扫描和写入阶段核对同一组绑定。 */
function bindingShape(fields) {
    return fields.map(({ target: _target, imported: _imported, ...field }) => field);
}

exports.scanBindings = scanBindings;
exports.bindingShape = bindingShape;
