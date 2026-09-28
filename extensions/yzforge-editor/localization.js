'use strict';
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const { createHash } = require('crypto');
const layout = require('../../tools/yzforge/localization-layout.cjs');
const { localizationSettings } = require('../../tools/yzforge/settings.cjs');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

exports.createLocalizationTools = function (ctx) {
    const { root, inside, read, moduleInfo, saveJson, workbookTools, bundleFolder, ensureFolder, url, journal } = ctx;
    const tools = () => import(pathToFileURL(inside('tools/yzforge/localization.mjs')).href);
    async function planLocalization(args) {
        const { manifest } = await moduleInfo(args.module),
            base = args.bundle;
        const config = localizationSettings(await read(inside('project-settings/framework.json')));
        if (!config) throw Error('请先在项目设置登记默认语言和支持语言');
        if (!layout.businessBundles(manifest)[base]) throw Error('请选择业务资源包');
        if (!config.locales.includes(args.locale)) throw Error('请选择有效语言');
        const previous = manifest.bundles[base].localization;
        if (previous?.variants) throw Error('请先迁移旧目录');
        const source = previous?.source ?? `config-source/${manifest.id}/localization-${base}.xlsx`;
        const locales = {
            [config.defaultLocale]: {},
            ...previous?.locales,
            [args.locale]: previous?.locales?.[args.locale] ?? {},
        };
        const next = {
            ...manifest,
            bundles: { ...manifest.bundles, [base]: { ...manifest.bundles[base], localization: { source, locales } } },
        };
        layout.physicalBundles(next);
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
            if (!previous) throw Error('同名工作簿已存在，请从删除记录恢复，不能覆盖');
            const workbook = await (await workbookTools()).readWorkbook(root(), source);
            if (workbook.kind !== 'localization' || !workbook.config.enabled)
                throw Error('多语言工作簿无效或已停用，请从删除记录恢复');
            hash = workbook.hash;
            updates.push(source);
        } else paths.push(source);
        for (const [locale, variant] of Object.entries(locales)) {
            const target = layout.languageBundle(manifest, base, locale, variant);
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
        for (const [locale, variant] of Object.entries(request.locales)) {
            const target = layout.languageBundle(manifest, request.bundle, locale, variant);
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
        else await (await tools()).createLocalizationWorkbook(root(), request.source, columns);
        manifest.bundles[request.bundle].localization = { source: request.source, locales: request.locales };
        await saveJson(path.join(directory, 'module.json'), manifest);
        return { source: request.source, module: request.module, bundle: request.bundle, locale: request.locale };
    }
    async function previewLocalizationMigration(args) {
        const { directory, manifest } = await moduleInfo(args.module);
        const next = structuredClone(manifest),
            moves = [],
            folders = [],
            tracked = [];
        for (const [base, bundle] of Object.entries(layout.businessBundles(manifest))) {
            const old = bundle.localization;
            if (!old?.variants) continue;
            const locales = {};
            for (const [locale, group] of Object.entries(old.variants)) {
                const previous = manifest.bundles[group];
                if (!previous || (group !== base && previous.localization)) throw Error('旧语言包归属冲突');
                const variant = group === base ? {} : { id: previous.id, group };
                const target = layout.languageBundle(manifest, base, locale, variant);
                locales[locale] = variant;
                const oldRoot = path.join(directory, previous.root),
                    newRoot = path.join(directory, target.root);
                if (
                    await fs.stat(newRoot).then(
                        () => true,
                        (error) => {
                            if (error.code === 'ENOENT') return false;
                            throw error;
                        },
                    )
                )
                    throw Error('迁移目标已存在：' + target.root);
                const oldCatalog = path.join(oldRoot, `dynamic/i18n/${base}/${locale.toLowerCase()}.json`);
                const info = await Editor.Message.request('asset-db', 'query-asset-info', url(oldCatalog));
                if (!info) throw Error('旧语言目录未导入：' + oldCatalog);
                tracked.push([url(oldCatalog), info.uuid, digest(await fs.readFile(oldCatalog, 'utf8'))]);
                if (group !== base) {
                    if (moves.some((move) => move.from === url(oldRoot)))
                        throw Error('一个旧语言包被多处共用，不能自动迁移');
                    moves.push({ from: url(oldRoot), to: url(newRoot) });
                    delete next.bundles[group];
                } else folders.push({ ...target, directory });
                moves.push({
                    from: url(
                        path.join(
                            group === base ? oldRoot : newRoot,
                            `dynamic/i18n/${base}/${locale.toLowerCase()}.json`,
                        ),
                    ),
                    to: url(path.join(newRoot, 'yz-locale.json')),
                });
            }
            next.bundles[base].localization = { source: old.source, locales };
        }
        if (!moves.length) throw Error('当前模块没有需要迁移的旧多语言目录');
        layout.physicalBundles(next);
        return { module: manifest.id, moves, folders, next, signature: digest({ manifest, moves, folders, tracked }) };
    }
    async function migrateLocalization(args) {
        const plan = await previewLocalizationMigration(args);
        if (args.signature !== plan.signature) throw Error('迁移条件已变化，请重新预览');
        const { directory, manifest } = await moduleInfo(args.module);
        const completed = [];
        const record = await journal('localization-migration', { plan, previous: manifest });
        try {
            for (const folder of plan.folders) {
                await bundleFolder(directory, folder);
                for (const child of ['dynamic', 'static']) await ensureFolder(path.join(directory, folder.root, child));
            }
            for (const move of plan.moves) {
                const target = inside(move.to.replace('db://', ''));
                await ensureFolder(path.dirname(target));
                const before = await Editor.Message.request('asset-db', 'query-asset-info', move.from);
                await Editor.Message.request('asset-db', 'move-asset', move.from, move.to);
                completed.push(move);
                const after = await Editor.Message.request('asset-db', 'query-asset-info', move.to);
                if (before.uuid !== after?.uuid) throw Error('迁移未保留资源 UUID');
            }
            await saveJson(path.join(directory, 'module.json'), plan.next);
            return { module: args.module, moves: completed, record };
        } catch (error) {
            const conflicts = [];
            for (const move of completed.reverse()) {
                try {
                    await ensureFolder(path.dirname(inside(move.from.replace('db://', ''))));
                    await Editor.Message.request('asset-db', 'move-asset', move.to, move.from);
                } catch (failure) {
                    conflicts.push(failure.message);
                }
            }
            await saveJson(path.join(directory, 'module.json'), manifest);
            throw Error(
                error.message +
                    (conflicts.length ? '；恢复冲突：' + conflicts.join(', ') : '；资源移动已撤回，请检查新建的空目录'),
                { cause: error },
            );
        }
    }
    async function previewLocalizedBinding(args) {
        const release = await read(inside('project-settings/generated/localization.json'));
        const definition = Object.values(release?.bundles ?? {}).find((item) => item.namespace === args.namespace);
        if (!definition) throw Error('找不到业务包的多语言声明，请先生成');
        const locale = args.locale || release.defaultLocale;
        if (!release.locales.includes(locale)) throw Error('项目未登记语言：' + locale);
        const state = await localizationPreviewModules();
        const catalog = async (language) => {
            const route = definition.catalogs[language];
            const owner = state.find((item) => item.id === route.bundle);
            if (!owner) throw Error('找不到语言包目录：' + route.bundle);
            const value = await read(inside(path.join(owner.directory, owner.root, route.path + '.json')));
            if (value.contract !== definition.contract || value.revision !== route.revision)
                throw Error('语言目录已过期，请先生成');
            return value;
        };
        const fallback = await catalog(release.defaultLocale);
        const current = definition.catalogs[locale] ? await catalog(locale) : fallback;
        const field = args.kind === 'sprite' ? 'assets' : 'texts';
        const source = Object.prototype.hasOwnProperty.call(current[field], args.key) ? current : fallback;
        if (!Object.prototype.hasOwnProperty.call(source[field], args.key)) throw Error('语言键不存在：' + args.key);
        if (args.kind === 'sprite') {
            const key = source.assets[args.key];
            if (key.type !== 'SpriteFrame') throw Error('语言键不是图片');
            const identities = await read(inside('project-settings/generated/resource-identities.json'));
            const entry = Object.entries(identities.entries).find(
                ([, item]) => item.active && item.id === key.id && item.type === 'SpriteFrame',
            );
            if (!entry) throw Error('找不到图片，请重新生成资源索引');
            return { uuid: entry[0], locale: source.locale };
        }
        const text = source.texts[args.key].replace(/\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g, (token, name) => {
            if (!name) return token === '{{' ? '{' : '}';
            const value = args.parameters?.[name];
            if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
                throw Error('缺少参数：' + name);
            return String(value);
        });
        return { text, locale: source.locale };
    }
    async function localizationPreviewModules() {
        const entries = await fs.readdir(inside('assets/game/modules'), { withFileTypes: true });
        const result = [];
        for (const entry of entries.filter((entry) => entry.isDirectory())) {
            const { directory, manifest } = await moduleInfo(entry.name);
            for (const bundle of Object.values(layout.physicalBundles(manifest))) result.push({ ...bundle, directory });
        }
        return result;
    }
    async function cleanupLocalizationDirectories(args) {
        const { directory, manifest } = await moduleInfo(args.module),
            removed = [];
        const db = (method, ...values) => Editor.Message.request('asset-db', method, ...values);
        async function empty(target) {
            const entries = await fs.readdir(target, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink()) return false;
                if (entry.isDirectory()) {
                    if (!(await empty(path.join(target, entry.name)))) return false;
                } else if (
                    !entry.name.endsWith('.meta') ||
                    !entries.some((other) => other.isDirectory() && other.name + '.meta' === entry.name)
                )
                    return false;
            }
            const info = await db('query-asset-info', url(target));
            return !!info && !((await db('query-asset-users', info.uuid, 'all')) ?? []).some(Boolean);
        }
        for (const bundle of Object.values(layout.physicalBundles(manifest)))
            for (const suffix of ['dynamic/i18n', 'dynamic/locales']) {
                const target = inside(path.join(directory, bundle.root, suffix));
                if ((await db('query-asset-info', url(target))) && (await empty(target))) {
                    await db('delete-asset', url(target));
                    removed.push(url(target));
                }
            }
        return { removed };
    }
    return {
        planLocalization,
        createLocalization,
        previewLocalizationMigration,
        migrateLocalization,
        previewLocalizedBinding,
        cleanupLocalizationDirectories,
    };
};
