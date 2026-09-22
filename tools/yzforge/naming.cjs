'use strict';
const suffixes = Object.freeze({
    page: 'Page',
    popup: 'Popup',
    overlay: 'Overlay',
    toast: 'Toast',
    loading: 'Loading',
    part: 'Part',
    prefab: 'Prefab',
    component: 'Component',
    service: 'Service',
});
function slug(input) {
    const id = String(input ?? '')
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
        .replace(/[ _]+/g, '-')
        .toLowerCase();
    if (
        !/^[a-z][a-z0-9-]*$/.test(id) ||
        ['constructor', 'prototype', 'class', 'import', 'default', 'shared'].includes(id)
    )
        throw Error(`请输入英文语义名称，例如 Inventory 或 inventory-item：${input}`);
    return id;
}
function named(input, kind) {
    const suffix = suffixes[kind];
    if (!suffix) throw Error(`不支持的职责：${kind}`);
    const id = slug(input);
    let type = id
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('');
    if (!type.endsWith(suffix)) type += suffix;
    return { id: slug(type), className: type, suffix };
}
function dependencies(modules, id, values) {
    const map = new Map(modules.map((item) => [item.id, Object.values(item.dependencies ?? {})]));
    const selected = [...new Set(Array.isArray(values) ? values : Object.values(values))];
    for (const target of selected)
        if (modules.find((item) => item.id === target)?.code?.mode === 'none')
            throw Error(`资源模块 ${target} 无业务 API，请直接引用其公开数据合同`);
    map.set(id, selected);
    const active = new Set(),
        done = new Set();
    function visit(current) {
        if (done.has(current)) return;
        if (!map.has(current) || active.has(current))
            throw Error(`模块不存在或存在循环依赖：${[...active, current].join(' → ')}`);
        active.add(current);
        for (const next of map.get(current)) visit(next);
        active.delete(current);
        done.add(current);
    }
    for (const key of map.keys()) visit(key);
    const previous = Array.isArray(values) ? (modules.find((item) => item.id === id)?.dependencies ?? {}) : values;
    const entries = selected.map((value) => [
        Object.entries(previous).find(([, target]) => target === value)?.[0] ??
            value.replace(/-([a-z])/g, (_, char) => char.toUpperCase()),
        value,
    ]);
    if (new Set(entries.map(([alias]) => alias)).size !== entries.length)
        throw Error('依赖别名重复，请检查 module.json');
    return Object.fromEntries(entries);
}
module.exports = { suffixes, slug, named, dependencies };
