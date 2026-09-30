'use strict';
const path = require('node:path');
const version = 3;
const idPattern = /^[a-z][a-z0-9-]*$/;
const derivedItem = ['directory', 'script', 'binding', 'types', 'presenter'];
function itemPaths(kind, id, item) {
    if (!idPattern.test(id)) throw Error(`无效条目标识：${id}`);
    const name = item.className?.split('.').at(-1);
    if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name)) throw Error(`${id}: 缺少有效组件 className`);
    const directory = `code/${kind === 'view' ? 'ui' : 'components'}/${id}`;
    return {
        directory,
        script: `${directory}/${name}.ts`,
        binding: `${directory}/generated/${name}Binding.ts`,
        ...(kind === 'view'
            ? {
                  types: `${item.visibility === 'public' ? 'contracts' : directory}/${name}.types.ts`,
                  presenter: `${directory}/${name}Presenter.ts`,
              }
            : {}),
    };
}
function sourceManifest(module) {
    const { directory, manifestPath, assets, ...source } = module;
    source.layoutVersion = version;
    source.code = { mode: 'eager', ...source.code };
    delete source.code.root;
    source.bundles = Object.fromEntries(
        Object.entries(source.bundles ?? {})
            .filter(([, bundle]) => !bundle.language)
            .map(([group, bundle]) => {
                const { root, ...declaration } = bundle;
                return [group, declaration];
            }),
    );
    for (const key of ['views', 'components'])
        if (source[key])
            source[key] = Object.fromEntries(
                Object.entries(source[key]).map(([id, item]) => {
                    const declaration = { ...item };
                    for (const field of derivedItem) delete declaration[field];
                    return [id, declaration];
                }),
            );
    return source;
}
/** 只接受当前源声明。目录是规则的结果，不允许源 JSON 覆盖。 */
function resolveModule(source) {
    if (source.layoutVersion !== version) throw Error(`${source.id}: 不支持的模块 layoutVersion`);
    if (!idPattern.test(source.id)) throw Error('无效模块标识');
    if ('assets' in source) throw Error('module.json 不支持手工登记 assets，资源由 dynamic 目录生成');
    if (!source.code || !['none', 'eager', 'bundled'].includes(source.code.mode))
        throw Error(`${source.id}: 必须声明 code.mode`);
    if ('root' in source.code) throw Error(`${source.id}: code.root 已由固定目录规则决定`);
    const module = { ...source, code: { ...source.code, root: 'code' }, bundles: {} };
    for (const [group, bundle] of Object.entries(source.bundles ?? {})) {
        if (!idPattern.test(group) || 'root' in bundle || 'language' in bundle)
            throw Error(`${source.id}/${group}: 资源包目录由固定规则决定`);
        module.bundles[group] = { ...bundle, root: `bundles/${group}` };
    }
    for (const [key, kind] of [
        ['views', 'view'],
        ['components', 'component'],
    ]) {
        module[key] = {};
        for (const [id, item] of Object.entries(source[key] ?? {})) {
            if (derivedItem.some((field) => field in item))
                throw Error(`${source.id}/${id}: 脚本和绑定目录由固定规则决定`);
            module[key][id] = { ...item, ...itemPaths(kind, id, item) };
        }
    }
    return module;
}
/** 相对模块的 TypeScript 导入路径。 */
function importPath(from, to) {
    const value = path.posix.relative(path.posix.dirname(from), to).replace(/\.ts$/, '');
    return value.startsWith('.') ? value : './' + value;
}
exports.layoutVersion = version;
exports.itemPaths = itemPaths;
exports.sourceManifest = sourceManifest;
exports.resolveModule = resolveModule;
exports.importPath = importPath;
