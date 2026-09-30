'use strict';
const path = require('path');
const valid = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
/** 业务声明是唯一来源；语言包的目录、资源分组和归属在这里统一派生。 */
function languageBundle(module, base, locale) {
    if (typeof locale !== 'string' || Intl.getCanonicalLocales(locale)[0] !== locale)
        throw Error('无效语言标识：' + locale);
    const group = `${base}-${locale.toLowerCase()}`;
    const id = `${module.id}-${group}`;
    if (!valid(base) || !valid(group) || !valid(id)) throw Error(`${module.id}/${base}/${locale}: 语言包声明无效`);
    return { group, id, root: `localization/${base}/${locale}`, language: { base, locale } };
}
function businessBundles(module) {
    return Object.fromEntries(
        Object.entries(module.bundles)
            .filter(([, bundle]) => !bundle.language)
            .map(([group, bundle]) => [group, { ...bundle, root: `bundles/${group}` }]),
    );
}
function physicalBundles(module) {
    const bundles = { ...businessBundles(module) };
    for (const [base, bundle] of Object.entries(bundles)) {
        const declaration = bundle.localization;
        if (!declaration) continue;
        if (Object.keys(declaration).some((key) => !['source', 'locales'].includes(key)))
            throw Error(`${module.id}/${base}: 不支持的多语言声明字段`);
        if (!declaration.locales || typeof declaration.locales !== 'object' || Array.isArray(declaration.locales))
            throw Error(`${module.id}/${base}: 缺少语言包声明 locales`);
        for (const [locale, variant] of Object.entries(declaration.locales)) {
            if (!variant || typeof variant !== 'object' || Array.isArray(variant) || Object.keys(variant).length)
                throw Error(`${module.id}/${base}/${locale}: 语言包声明必须是空对象`);
            const { group, ...target } = languageBundle(module, base, locale);
            if (bundles[group]) throw Error(`语言资源分组与已有资源包冲突：${module.id}/${group}`);
            bundles[group] = target;
        }
    }
    return bundles;
}
exports.languageBundle = languageBundle;
exports.businessBundles = businessBundles;
exports.physicalBundles = physicalBundles;
exports.expandModule = (module) => ({ ...module, bundles: physicalBundles(module) });
/** 由源资源所在目录确定业务归属；不以实例的宿主模块猜测公共预制体的词条来源。 */
exports.sourceNamespace = (source, modules) => {
    for (const module of modules)
        for (const [group, bundle] of Object.entries(businessBundles(module))) {
            const local = path.relative(path.resolve(module.directory, bundle.root), source);
            if (local && !local.startsWith('..') && !path.isAbsolute(local)) return `${module.id}/${group}`;
        }
    return '';
};
