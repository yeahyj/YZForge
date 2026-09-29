'use strict';
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const layout = require('../../tools/yzforge/localization-layout.cjs');
const { localizationSettings } = require('../../tools/yzforge/settings.cjs');

exports.createLocalizationTools = function (ctx) {
    const { root, inside, read, moduleInfo, saveJson, workbookTools, bundleFolder, ensureFolder } = ctx;
    const tools = () => import(pathToFileURL(inside('tools/yzforge/localization-workbook.mjs')).href);
    async function planLocalization(args) {
        const { manifest } = await moduleInfo(args.module),
            base = args.bundle;
        const config = localizationSettings(await read(inside('project-settings/framework.json')));
        if (!config) throw Error('请先在项目设置登记默认语言和支持语言');
        if (!layout.businessBundles(manifest)[base]) throw Error('请选择业务资源包');
        if (!config.locales.includes(args.locale)) throw Error('请选择有效语言');
        const previous = manifest.bundles[base].localization;
        const source =
            previous?.source ??
            (args.texts === true ? `config-source/${manifest.id}/localization-${base}.xlsx` : undefined);
        const locales = {
            [config.defaultLocale]: {},
            ...previous?.locales,
            [args.locale]: previous?.locales?.[args.locale] ?? {},
        };
        const next = {
            ...manifest,
            bundles: {
                ...manifest.bundles,
                [base]: { ...manifest.bundles[base], localization: { ...(source ? { source } : {}), locales } },
            },
        };
        layout.physicalBundles(next);
        const prefix = `assets/game/modules/${manifest.id}`,
            paths = [],
            folders = [],
            updates = [`${prefix}/module.json`];
        const exists =
            source &&
            (await fs.stat(inside(source)).then(
                () => true,
                (error) => {
                    if (error.code === 'ENOENT') return false;
                    throw error;
                },
            ));
        let hash;
        if (previous?.source && !exists) throw Error('源工作簿丢失，请先恢复文件');
        if (exists) {
            if (!previous?.source) throw Error('同名工作簿已存在，请从删除记录恢复，不能覆盖');
            const workbook = await (await workbookTools()).readWorkbook(root(), source);
            if (workbook.kind !== 'localization' || !workbook.config.enabled)
                throw Error('多语言工作簿无效或已停用，请从删除记录恢复');
            hash = workbook.hash;
            updates.push(source);
        } else if (source) paths.push(source);
        for (const locale of Object.keys(locales)) {
            const target = layout.languageBundle(manifest, base, locale);
            if (!previous?.locales?.[locale]) {
                if (
                    await fs.stat(inside(`${prefix}/${target.root}`)).then(
                        () => true,
                        (error) => {
                            if (error.code === 'ENOENT') return false;
                            throw error;
                        },
                    )
                )
                    throw Error('语言目录已存在，不能自动认领：' + target.root);
                folders.push(
                    `${prefix}/${target.root}`,
                    `${prefix}/${target.root}/dynamic`,
                    `${prefix}/${target.root}/static`,
                );
            }
            updates.push(
                `${prefix}/${target.root}/yz-index.json`,
                `${prefix}/${target.root}/yz-locale.json`,
                `${prefix}/contracts/generated/resources-${target.group}.ts`,
            );
        }
        updates.push(`${prefix}/contracts/generated/localization-${base}.ts`, 'settings/v2/packages/builder.json');
        return {
            request: {
                kind: 'localization',
                module: manifest.id,
                bundle: base,
                locale: args.locale,
                id: base,
                source,
                texts: !!source,
                hash,
                locales,
            },
            paths,
            folders,
            updates,
        };
    }
    async function createLocalization(args) {
        const { request } = await planLocalization(args);
        if (args.hash !== request.hash) throw Error('工作簿已变化，请重新预览');
        const { directory, manifest } = await moduleInfo(request.module);
        for (const locale of Object.keys(request.locales)) {
            const target = layout.languageBundle(manifest, request.bundle, locale);
            await bundleFolder(directory, target);
            await ensureFolder(path.join(directory, target.root, 'dynamic'));
            await ensureFolder(path.join(directory, target.root, 'static'));
        }
        const config = localizationSettings(await read(inside('project-settings/framework.json')));
        const columns = [config.defaultLocale, ...config.locales.filter((locale) => locale !== config.defaultLocale)];
        if (request.hash)
            await (
                await workbookTools()
            ).writeLocalizationWorkbook(root(), request.source, { locales: columns }, request.hash);
        else if (request.source) await (await tools()).createLocalizationWorkbook(root(), request.source, columns);
        manifest.bundles[request.bundle].localization = {
            ...(request.source ? { source: request.source } : {}),
            locales: request.locales,
        };
        await saveJson(path.join(directory, 'module.json'), manifest);
        return { source: request.source, module: request.module, bundle: request.bundle, locale: request.locale };
    }
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
    return {
        languageResourceState,
        planLocalization,
        createLocalization,
    };
};
