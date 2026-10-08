'use strict';
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const localizationLayout = require('../project/localization-layout.cjs');
/** 删除目标、引用和签名共用模型；原生引用查询由编辑器适配器提供。 */
exports.createDeletionPlanner = function ({
    root,
    inside,
    rel,
    url,
    moduleInfo,
    state: getState,
    read,
    request,
    compressUUID,
    resourceIdentity,
    listFiles,
    workbookTools,
}) {
    async function previewDelete(args, creation) {
        const { directory, manifest } = await moduleInfo(args.module, true),
            state = await getState(),
            kind = args.kind || 'module';
        const nextManifest = JSON.parse(JSON.stringify(manifest));
        const workbooks = [];
        const refs = [],
            ids = [],
            targets = [];
        if (creation) {
            targets.push(...creation.targets.map(inside));
            if (creation.request.kind === 'module') {
                ids.push(manifest.id + '/', manifest.id + '.');
                refs.push(
                    ...state.modules
                        .filter((module) => Object.values(module.dependencies).includes(manifest.id))
                        .map((module) => `模块 ${module.id} 依赖此模块`),
                );
            }
        } else if (kind === 'module') {
            targets.push(directory);
            ids.push(manifest.id + '/', manifest.id + '.');
            refs.push(
                ...state.modules
                    .filter((module) => Object.values(module.dependencies).includes(manifest.id))
                    .map((module) => `模块 ${module.id} 依赖此模块`),
            );
            for (const workbook of state.workbooks ?? [])
                if (workbook.config.module === manifest.id && workbook.config.enabled !== false) {
                    workbooks.push({
                        source: workbook.source,
                        hash: workbook.hash,
                        previous: workbook.config,
                        next: { ...workbook.config, enabled: false },
                    });
                }
            for (const workbook of state.localizationWorkbooks ?? [])
                if (
                    Object.values(manifest.bundles).some((bundle) => bundle.localization?.source === workbook.source) &&
                    workbook.config.enabled
                )
                    workbooks.push({
                        source: workbook.source,
                        hash: workbook.hash,
                        previous: workbook.config,
                        next: { ...workbook.config, enabled: false },
                    });
        } else if (kind === 'view' || kind === 'prefab') {
            const view = kind === 'view' ? manifest.views[args.id] : manifest.components?.[args.id];
            if (!view) throw Error('未找到界面');
            const registration = kind === 'view' ? await resourceIdentity(manifest, view.prefab) : { uuid: view.uuid };
            const identities = await read(inside('project-settings/state/resource-identities.json'));
            const resourceId = view.prefab ?? identities.entries[view.uuid]?.id;
            if (!registration) throw Error('界面资源登记缺失');
            const prefab = await request('asset-db', 'query-asset-info', registration.uuid);
            if (!prefab?.file) throw Error('界面 Prefab 未导入');
            targets.push(
                inside(prefab.file),
                inside(path.join(directory, view.directory)),
                ...(kind === 'view' && view.visibility === 'public' ? [inside(path.join(directory, view.types))] : []),
            );
            ids.push(`${manifest.id}.${args.id}`, ...(resourceId ? [resourceId] : []));
            if (kind === 'view') delete nextManifest.views[args.id];
            else delete nextManifest.components[args.id];
            if (kind === 'view' && Object.values(nextManifest.views).some((other) => other.prefab === view.prefab))
                refs.push('其他界面也使用此 Prefab');
        } else if (kind === 'language' || kind === 'localization') {
            const [base, locale] = args.id.split('/');
            const declaration = manifest.bundles[base]?.localization;
            if (!declaration?.locales) throw Error('未找到有效的语言声明');
            if (kind === 'language' && !declaration.locales[locale]) throw Error('此语言尚未启用');
            if (kind === 'language' && locale === state.settings.localization.defaultLocale)
                throw Error('默认语言不能单独停用；可停用整个业务包的多语言');
            const selected =
                kind === 'language' ? [[locale, declaration.locales[locale]]] : Object.entries(declaration.locales);
            for (const [language, variant] of selected) {
                const target = localizationLayout.languageBundle(manifest, base, language, variant);
                targets.push(inside(path.join(directory, target.root)));
                ids.push(`${manifest.id}/${target.group}/`, target.id);
                const contract = path.join(directory, `contracts/generated/resources-${target.group}.ts`);
                if (syncFs.existsSync(contract)) targets.push(contract);
            }
            if (kind === 'language') delete nextManifest.bundles[base].localization.locales[locale];
            else {
                if (declaration.source) {
                    const workbook = state.localizationWorkbooks.find((item) => item.source === declaration.source);
                    if (!workbook) throw Error('找不到源工作簿');
                    workbooks.push({
                        source: workbook.source,
                        hash: workbook.hash,
                        previous: workbook.config,
                        next: { ...workbook.config, enabled: false },
                    });
                }
                delete nextManifest.bundles[base].localization;
                const contract = path.join(directory, `contracts/generated/localization-${base}.ts`);
                if (syncFs.existsSync(contract)) targets.push(contract);
            }
        } else if (kind === 'bundle') {
            const bundle = manifest.bundles[args.id];
            if (!bundle) throw Error('未找到资源包');
            targets.push(inside(path.join(directory, bundle.root)));
            ids.push(`${manifest.id}/${args.id}/`, bundle.id);
            if (bundle.localization) refs.push('此业务包拥有多语言资源，请先迁移或停用其声明');
            for (const table of state.tables.tables)
                if (
                    table.id.startsWith(manifest.id + '.') &&
                    (table.bundle === args.id || Object.values(table.shards?.targets || {}).includes(args.id))
                )
                    refs.push(`配置表 ${table.id} 仍使用此包`);
            for (const view of Object.values(manifest.views ?? {}))
                if (view.prefab.startsWith(`${manifest.id}/${args.id}/`)) refs.push(`界面仍使用资源 ${view.prefab}`);
            for (const component of Object.values(manifest.components ?? {})) {
                const info = await request('asset-db', 'query-asset-info', component.uuid);
                if (info?.url.startsWith(url(inside(path.join(directory, bundle.root))) + '/'))
                    refs.push('通用预制体仍使用此包：' + component.className);
            }
            delete nextManifest.bundles[args.id];
        } else if (kind === 'script') {
            const target = inside(args.path);
            if (
                !target.startsWith(path.join(directory, 'code') + path.sep) ||
                !target.endsWith('.ts') ||
                target.includes(`${path.sep}generated${path.sep}`)
            )
                throw Error('只能选择当前模块的普通手写脚本');
            targets.push(target);
        } else throw Error('不支持此删除类型');
        const files = [];
        for (const target of targets) {
            const info = await fs.stat(target);
            files.push(...(info.isDirectory() ? await listFiles(target) : [target]));
            try {
                await fs.stat(target + '.meta');
                files.push(target + '.meta');
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        const owned = new Set(files.map((file) => file.toLowerCase()));
        // 恢复旧内容的文件仍然存在；其外部导入不等于对待删除资源的引用。
        const removed = new Set(owned);
        const generatedOwned = new Set(
            Object.keys(await read(inside('project-settings/state/generated-files.json'))).map((file) =>
                inside(file).toLowerCase(),
            ),
        );
        for (const file of creation?.restored ?? []) owned.add(inside(file).toLowerCase());
        const allAssets = await request('asset-db', 'query-assets', { pattern: 'db://assets/game/**' });
        const assets = allAssets.filter((asset) => asset.file && removed.has(asset.file.toLowerCase()));
        const uuids = new Set(assets.map((asset) => asset.uuid));
        for (const asset of assets) {
            const users = await request('asset-db', 'query-asset-users', asset.uuid, 'all');
            for (const user of users || [])
                if (!uuids.has(user)) {
                    if (!user) continue; // Creator can include empty importer bookkeeping entries, which are not asset UUIDs.
                    const info = await request('asset-db', 'query-asset-info', user);
                    if (
                        info &&
                        (!info.file ||
                            (!owned.has(info.file.toLowerCase()) && !generatedOwned.has(info.file.toLowerCase())))
                    )
                        refs.push(`${info.url} 引用 ${asset.url}`);
                }
        }
        const dependencies = (await import('../validation/dependencies.mjs')).dependencyResolver(root());
        const languageSources =
            kind === 'localization'
                ? ((await read(inside('project-settings/generated/localization.json')))?.sources ?? {})
                : {};
        const languageBindings =
            kind === 'localization'
                ? await import(pathToFileURL(path.join(root(), 'tools/yzforge/validation/localized-bindings.mjs')).href)
                : null;
        const nativeLanguageTypes = new Set(['yzforge.LocalizedLabel', 'yzforge.LocalizedSprite']);
        if (kind === 'localization')
            for (const script of ['localized-label', 'localized-sprite']) {
                const meta = await read(inside(`assets/framework/ui/localization/${script}.ts.meta`));
                nativeLanguageTypes.add(meta.uuid);
                nativeLanguageTypes.add(compressUUID(meta.uuid, false));
            }
        for (const file of await listFiles(inside('assets/game'))) {
            if (
                owned.has(file.toLowerCase()) ||
                generatedOwned.has(file.toLowerCase()) ||
                file.endsWith('.meta') ||
                file.endsWith('module.json')
            )
                continue;
            if (!/\.(ts|json|csv|prefab|scene)$/.test(file)) continue;
            const content = await fs.readFile(file, 'utf8');
            if (kind === 'localization' && /\.(prefab|scene)$/.test(file)) {
                const records = JSON.parse(content);
                const sourceUuid = (await read(file + '.meta'))?.uuid;
                if (
                    Array.isArray(records) &&
                    records.some(
                        (item) =>
                            nativeLanguageTypes.has(item?.__type__) &&
                            item.key &&
                            languageBindings.localizedNamespace(
                                records,
                                item,
                                languageSources[sourceUuid],
                                languageSources,
                            ) === `${manifest.id}/${args.id}`,
                    )
                )
                    refs.push(`${rel(file)} 的原生组件仍绑定此业务包多语言`);
            }
            for (const id of ids) if (content.includes(id)) refs.push(`${rel(file)} 包含对 ${id} 的引用`);
            if (file.endsWith('.ts'))
                for (const edge of dependencies.imports(file)) {
                    if (edge.target && removed.has(path.resolve(edge.target).toLowerCase()))
                        refs.push(`${rel(file)} 导入 ${edge.spec}`);
                }
        }
        // XLSX references live in typed cells, not plain-text files or Creator's asset reference graph.
        for (const diagnostic of state.workbookDiagnostics ?? []) refs.push('配置表无法检查：' + diagnostic.message);
        const workbookTool = await workbookTools();
        for (const item of state.workbooks) {
            if (
                !item.config.enabled ||
                owned.has(inside(item.source).toLowerCase()) ||
                (kind === 'module' && item.config.module === manifest.id)
            )
                continue;
            const workbook = await workbookTool.readWorkbook(root(), item.source);
            for (const table of workbook.config.tables.filter((table) => table.enabled)) {
                const sheet = workbook.book.getWorksheet(table.sheet);
                if (!sheet) {
                    refs.push(item.source + ': 缺少工作表 ' + table.sheet);
                    continue;
                }
                sheet.eachRow((row, rowNumber) =>
                    row.eachCell((cell, column) => {
                        const value = cell.value;
                        const content =
                            typeof value === 'string'
                                ? value
                                : value && typeof value === 'object'
                                  ? JSON.stringify(value)
                                  : '';
                        const referenced = ids.find((id) => content.includes(id));
                        if (referenced)
                            refs.push(
                                item.source +
                                    ':' +
                                    table.sheet +
                                    '!' +
                                    rowNumber +
                                    ',' +
                                    column +
                                    ' 引用 ' +
                                    referenced,
                            );
                    }),
                );
            }
        }
        const signature = createHash('sha256')
            .update(
                JSON.stringify({
                    manifest,
                    workbooks,
                    localizationWorkbooks: (state.localizationWorkbooks ?? []).map(({ source, hash }) => ({
                        source,
                        hash,
                    })),
                    kind,
                    id: args.id,
                    files: await Promise.all(
                        files.map(async (file) => [
                            rel(file),
                            createHash('sha256')
                                .update(await fs.readFile(file))
                                .digest('hex'),
                        ]),
                    ),
                }),
            )
            .digest('hex');
        return {
            module: manifest.id,
            kind,
            id: args.id,
            path: args.path,
            targets: targets.map(rel),
            files: files.map(rel),
            references: [...new Set(refs)],
            signature,
            workbooks,
            nextManifest: kind === 'module' ? null : nextManifest,
        };
    }
    return previewDelete;
};
