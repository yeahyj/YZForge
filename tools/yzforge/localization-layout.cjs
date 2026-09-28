'use strict';
const valid = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
/** 业务声明是唯一来源；语言包的目录、资源分组和归属在这里统一派生。 */
function languageBundle(module, base, locale, variant = {}) {
    if (typeof locale !== 'string' || Intl.getCanonicalLocales(locale)[0] !== locale)
        throw Error('无效语言标识：' + locale);
    const group = variant.group ?? `${base}-${locale.toLowerCase()}`;
    const id = variant.id ?? `${module.id}-${group}`;
    if (
        !valid(base) ||
        !valid(group) ||
        !valid(id) ||
        group === base ||
        Object.keys(variant).some((key) => !['id', 'group'].includes(key))
    )
        throw Error(`${module.id}/${base}/${locale}: 语言包声明无效`);
    return { group, id, root: `localization/${base}/${locale}`, language: { base, locale } };
}
function businessBundles(module) {
    const legacy = new Set(
        Object.entries(module.bundles).flatMap(([base, bundle]) =>
            Object.values(bundle.localization?.variants ?? {}).filter((group) => group !== base),
        ),
    );
    return Object.fromEntries(
        Object.entries(module.bundles).filter(([group, bundle]) => !bundle.language && !legacy.has(group)),
    );
}
function physicalBundles(module) {
    const bundles = { ...businessBundles(module) };
    for (const [base, bundle] of Object.entries(bundles)) {
        const declaration = bundle.localization;
        if (!declaration) continue;
        if (declaration.variants) throw Error(`${module.id}/${base}: 请先在多语言工作台迁移旧目录`);
        if (!declaration.locales || typeof declaration.locales !== 'object' || Array.isArray(declaration.locales))
            throw Error(`${module.id}/${base}: 缺少语言包声明 locales`);
        for (const [locale, variant] of Object.entries(declaration.locales)) {
            if (!variant || typeof variant !== 'object' || Array.isArray(variant))
                throw Error(`${module.id}/${base}/${locale}: 语言包声明必须是对象`);
            const { group, ...target } = languageBundle(module, base, locale, variant);
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
