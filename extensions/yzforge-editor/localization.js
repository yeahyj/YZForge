'use strict';
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const { localizationSettings } = require('../../tools/yzforge/settings.cjs');

exports.createLocalizationTools = function (ctx) {
    const { root, inside, read, moduleInfo, saveJson, workbookTools } = ctx;
    const tools = () => import(pathToFileURL(inside('tools/yzforge/localization.mjs')).href);
    async function planLocalization(args) {
        const { manifest } = await moduleInfo(args.module),
            base = args.bundle;
        const settings = await read(inside('project-settings/framework.json')),
            config = localizationSettings(settings);
        if (!config) throw Error('请先在项目设置登记默认语言和支持语言');
        if (!manifest.bundles[base]) throw Error('请选择业务资源包');
        if (!config.locales.includes(args.locale) || !['base', 'dedicated'].includes(args.storage))
            throw Error('请选择有效的语言与存放方式');
        for (const [other, bundle] of Object.entries(manifest.bundles))
            if (other !== base && Object.values(bundle.localization?.variants ?? {}).includes(base))
                throw Error('专用语言包不能作为业务资源包');
        const previous = manifest.bundles[base].localization;
        const source = previous?.source ?? `config-source/${manifest.id}/localization-${base}.xlsx`;
        const group = args.storage === 'base' ? base : `${base}-${args.locale.toLowerCase()}`;
        if (previous?.variants?.[args.locale] && previous.variants[args.locale] !== group)
            throw Error('此语言已有存放位置；请显式迁移资源和引用后再修改声明');
        if (group !== base && manifest.bundles[group] && previous?.variants?.[args.locale] !== group)
            throw Error('同名资源包已存在，不能自动认领为语言专用包');
        const prefix = `assets/game/modules/${manifest.id}`,
            paths = [],
            folders = [],
            updates = [`${prefix}/module.json`];
        const exists = await fs.stat(inside(source)).then(
            () => true,
            (error) => {
                if (error.code === 'ENOENT') return false;
                throw error;
            },
        );
        let hash;
        if (previous && !exists) throw Error('源工作簿丢失，请先恢复文件');
        if (exists) {
            if (!previous) throw Error('同名工作簿已存在，不能覆盖');
            const workbook = await (await workbookTools()).readWorkbook(root(), source);
            if (workbook.kind !== 'localization' || !workbook.config.enabled) throw Error('多语言工作簿无效或已停用');
            hash = workbook.hash;
            updates.push(source);
        } else paths.push(source);
        if (group !== base && !manifest.bundles[group]) {
            folders.push(
                `${prefix}/bundles/${group}`,
                `${prefix}/bundles/${group}/dynamic`,
                `${prefix}/bundles/${group}/static`,
            );
            updates.push(
                `${prefix}/bundles/${group}/yz-index.json`,
                `${prefix}/contracts/generated/resources-${group}.ts`,
                'settings/v2/packages/builder.json',
            );
        }
        const variants = { [config.defaultLocale]: base, ...previous?.variants, [args.locale]: group };
        for (const [locale, target] of Object.entries(variants)) {
            const bundleRoot = manifest.bundles[target]?.root ?? `bundles/${target}`;
            updates.push(`${prefix}/${bundleRoot}/dynamic/i18n/${base}/${locale.toLowerCase()}.json`);
        }
        updates.push(`${prefix}/contracts/generated/localization-${base}.ts`);
        return {
            request: {
                kind: 'localization',
                module: manifest.id,
                bundle: base,
                locale: args.locale,
                storage: args.storage,
                id: group,
                source,
                hash,
                locales: [config.defaultLocale, ...config.locales.filter((locale) => locale !== config.defaultLocale)],
            },
            paths,
            folders,
            updates,
        };
    }
    async function createLocalization(args) {
        const plan = await planLocalization(args),
            request = plan.request;
        if (args.hash !== request.hash) throw Error('工作簿已变化，请重新预览');
        if (request.storage === 'dedicated') {
            const { manifest } = await moduleInfo(request.module);
            if (!manifest.bundles[request.id])
                await ctx.actions().createBundle({ module: request.module, id: request.id });
        }
        if (request.hash)
            await (
                await workbookTools()
            ).writeLocalizationWorkbook(root(), request.source, { locales: request.locales }, request.hash);
        else await (await tools()).createLocalizationWorkbook(root(), request.source, request.locales);
        const { directory, manifest } = await moduleInfo(request.module),
            bundle = manifest.bundles[request.bundle];
        const settings = localizationSettings(await read(inside('project-settings/framework.json')));
        bundle.localization = {
            source: request.source,
            variants: {
                [settings.defaultLocale]: request.bundle,
                ...bundle.localization?.variants,
                [request.locale]: request.id,
            },
        };
        await saveJson(path.join(directory, 'module.json'), manifest);
        return {
            source: request.source,
            module: request.module,
            bundle: request.bundle,
            locale: request.locale,
            storage: request.id,
        };
    }
    return { planLocalization, createLocalization };
};
