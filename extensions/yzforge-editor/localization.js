'use strict';
const layout = require('../../tools/yzforge/project/localization-layout.cjs');
exports.createLocalizationTools = function ({ read, inside }) {
    async function languageResourceState(modules) {
        const result = [];
        for (const module of modules)
            for (const [base, bundle] of Object.entries(layout.businessBundles(module)))
                for (const locale of Object.keys(bundle.localization?.locales ?? {})) {
                    const target = layout.languageBundle(module, base, locale);
                    const catalog = await read(
                        inside(`assets/game/modules/${module.id}/${target.root}/yz-locale.json`),
                    ).catch((error) => {
                        if (error.code === 'ENOENT') return null;
                        throw error;
                    });
                    result.push({
                        namespace: `${module.id}/${base}`,
                        locale,
                        keys: catalog ? Object.keys(catalog.assets) : null,
                    });
                }
        return result;
    }
    return { languageResourceState };
};
