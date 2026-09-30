'use strict';
const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const layout = require('../../tools/yzforge/project/localization-layout.cjs');
const {
    resolveValue,
    savedBindings,
    writeSavedValue,
} = require('../../tools/yzforge/operations/localization-apply.cjs');
const hash = (value) =>
    createHash('sha256')
        .update(typeof value === 'string' ? value : JSON.stringify(value))
        .digest('hex');

exports.createLocalizationUpdates = function ({ inside, journal, moduleInfo }) {
    const plans = new Map();
    const db = (...args) => Editor.Message.request('asset-db', ...args);
    const scene = (...args) => Editor.Message.request('scene', ...args);
    const script = (method, ...args) => scene('execute-scene-script', { name: 'yzforge-editor', method, args });
    async function assertAssets(assets) {
        for (const uuid of assets)
            if (!(await db('query-asset-info', uuid))) throw Error('语言资源已被移除，请重新生成：' + uuid);
    }
    async function resolver(locale) {
        const sources = new Map();
        const read = async (file) => {
            const content = await fs.readFile(inside(file), 'utf8');
            sources.set(file, hash(content));
            return JSON.parse(content);
        };
        const settings = (await read('project-settings/framework.json')).localization;
        const release = await read('project-settings/generated/localization.json');
        if (!settings?.locales.includes(locale)) throw Error('请选择项目支持的语言');
        if (
            !release ||
            release.defaultLocale !== settings.defaultLocale ||
            hash(release.locales) !== hash(settings.locales)
        )
            throw Error('语言配置已变化，请先校验并生成');
        const identities = await read('project-settings/state/resource-identities.json');
        const byId = new Map(
            Object.entries(identities.entries)
                .filter(([, value]) => value.active)
                .map(([uuid, value]) => [value.id, { uuid, ...value }]),
        );
        const assetUuid = (key) => {
            const entry = byId.get(key.id);
            if (!entry || entry.type !== key.type) throw Error('语言资源索引不存在或类型不匹配：' + key.id);
            return entry.uuid;
        };
        const modules = [];
        for (const entry of await fs.readdir(inside('assets/game/modules'), { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const file = `assets/game/modules/${entry.name}/module.json`;
            try {
                modules.push({ ...(await read(file)), directory: inside(`assets/game/modules/${entry.name}`) });
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        const routes = new Map(
            modules.flatMap((module) =>
                Object.values(layout.physicalBundles(module)).map((bundle) => [
                    bundle.id,
                    path.join(module.directory, bundle.root),
                ]),
            ),
        );
        const catalogs = new Map();
        const fonts = new Set();
        for (const definition of Object.values(release.bundles)) {
            const languages = new Map();
            for (const [language, route] of Object.entries(definition.catalogs)) {
                const folder = routes.get(route.bundle);
                if (!folder) throw Error('找不到语言资源包：' + route.bundle);
                const catalog = await read(path.join(folder, route.path + '.json'));
                if (catalog.contract !== definition.contract || catalog.revision !== route.revision)
                    throw Error('语言目录已过期，请先校验并生成');
                if (catalog.font) fonts.add(assetUuid(catalog.font));
                languages.set(language, catalog);
            }
            catalogs.set(definition.namespace, languages);
        }
        const ownership = new Map();
        const assets = new Set();
        return {
            sources,
            assets,
            async resolve(binding) {
                let namespace = binding.namespace;
                if (!namespace) {
                    if (!ownership.has(binding.source)) {
                        const info = await db('query-asset-info', binding.source);
                        ownership.set(binding.source, info ? layout.sourceNamespace(info.file, modules) : '');
                    }
                    namespace = ownership.get(binding.source);
                }
                const languages = catalogs.get(namespace);
                const fallback = languages?.get(release.defaultLocale);
                if (!fallback)
                    throw Error(
                        `${binding.name || binding.node}/${binding.key}: 无法确定词条来源，请指定跨包引用并生成`,
                    );
                const value = resolveValue(binding, languages.get(locale) ?? fallback, fallback, assetUuid);
                for (const uuid of [value.spriteFrame, value.font].filter(Boolean)) {
                    if (!assets.has(uuid)) await assertAssets([uuid]);
                    assets.add(uuid);
                }
                return { ...value, clearFont: !value.font && fonts.has(binding.font) };
            },
        };
    }
    async function assertSources(sources) {
        for (const [file, digest] of sources)
            if (hash(await fs.readFile(inside(file), 'utf8')) !== digest)
                throw Error('语言配置或资源已变化，请重新检查更新范围');
    }
    async function assertClean(files) {
        const ids = new Set(files.map((file) => file.uuid));
        const dirty = (await scene('multi-scene-query')).filter((tab) => tab.dirty && ids.has(tab.uuid));
        if (dirty.length)
            throw Error('批量更新涉及未保存内容，请先保存或使用当前范围：' + dirty.map((tab) => tab.name).join('、'));
    }
    async function updateCurrent(args) {
        const source = await scene('query-current-scene');
        const selection = args.scope === 'selection' ? Editor.Selection.getSelected('node') : undefined;
        const before = await script('collectLocalizedNodes', source, selection);
        const resolve = await resolver(args.locale);
        const values = [];
        for (const binding of before.bindings) values.push(await resolve.resolve(binding));
        if (!values.length) return { message: '所选范围没有配置语言键的多语言组件', updated: 0 };
        const token = await script('retainLocalizedAssets', values);
        const changes = [];
        let recording;
        try {
            await assertSources(resolve.sources);
            if (
                source !== (await scene('query-current-scene')) ||
                hash(before) !== hash(await script('collectLocalizedNodes', source, selection))
            )
                throw Error('当前编辑内容已变化，请重新应用语言');
            for (let i = 0; i < values.length; i++) {
                const binding = before.bindings[i],
                    value = values[i];
                const field = (property, type, next, previous) => {
                    if (next === previous) return;
                    const dump = (value) => ({ type, value: type.startsWith('cc.') ? { uuid: value || '' } : value });
                    changes.push({
                        uuid: binding.node,
                        path: `__comps__.${binding.target}.${property}`,
                        dump: dump(next),
                        original: dump(previous),
                    });
                };
                if (binding.kind === 'sprite')
                    field('spriteFrame', 'cc.SpriteFrame', value.spriteFrame, binding.original.spriteFrame);
                else {
                    if (value.font || value.clearFont) {
                        field('font', 'cc.Font', value.font || '', binding.original.font);
                        field('useSystemFont', 'Boolean', !value.font, binding.original.useSystemFont);
                    }
                    field('string', 'String', value.text, binding.original.string);
                }
            }
            if (!changes.length) return { message: '当前内容已是所选语言', updated: 0 };
            recording = await scene('begin-recording', [...new Set(changes.map((change) => change.uuid))], {
                tag: 'YZForge 应用语言',
            });
            const applied = [];
            try {
                for (const change of changes) {
                    applied.push(change);
                    const ok = await scene('set-property', {
                        uuid: change.uuid,
                        path: change.path,
                        dump: change.dump,
                        record: false,
                    });
                    if (ok === false) throw Error('原生组件更新失败：' + change.path);
                }
                await scene('end-recording', recording);
                recording = undefined;
            } catch (error) {
                for (const change of applied.reverse())
                    await scene('set-property', {
                        uuid: change.uuid,
                        path: change.path,
                        dump: change.original,
                        record: false,
                    });
                throw error;
            }
            return {
                message: `已应用 ${args.locale}，更新 ${values.length} 个组件；可撤销，保存后写入资源`,
                updated: values.length,
                locale: args.locale,
            };
        } finally {
            try {
                if (recording !== undefined) await scene('cancel-recording', recording);
            } finally {
                await script('releaseLocalizedAssets', token);
            }
        }
    }
    async function planBatch(args) {
        if (args.scope !== 'bundle') throw Error('请选择批量更新范围');
        const { manifest, directory } = await moduleInfo(args.module);
        const bundle = layout.businessBundles(manifest)[args.bundle];
        if (!bundle) throw Error('请选择业务资源包');
        const folder = inside(path.join(directory, bundle.root));
        const prefix = 'db://' + path.relative(inside('.'), folder).replaceAll('\\', '/');
        const candidates = (await db('query-assets', { pattern: prefix + '/**' })).filter(
            (asset) => /\.(prefab|scene)$/.test(asset.url) && !asset.uuid.includes('@'),
        );
        const resolve = await resolver(args.locale);
        const { decodeUuid } = await import(pathToFileURL(inside('tools/yzforge/project/catalog.mjs')).href);
        const classes = new Map([
            ['yzforge.LocalizedLabel', 'text'],
            ['yzforge.LocalizedSprite', 'sprite'],
        ]);
        for (const [scriptName, kind] of [
            ['localized-label', 'text'],
            ['localized-sprite', 'sprite'],
        ]) {
            const info = await db('query-asset-info', `db://assets/framework/ui/localization/${scriptName}.ts`);
            if (!info) throw Error('缺少多语言绑定脚本');
            classes.set(info.uuid, kind);
        }
        const files = [];
        let skippedNested = 0;
        for (const candidate of candidates) {
            const info = await db('query-asset-info', candidate.uuid);
            const before = await fs.readFile(inside(info.file), 'utf8');
            const records = JSON.parse(before);
            const { bindings, nested } = savedBindings(records, classes, candidate.uuid, decodeUuid);
            skippedNested += nested;
            if (!bindings.length) continue;
            const original = JSON.stringify(records);
            for (const binding of bindings) {
                const value = await resolve.resolve(binding);
                writeSavedValue(binding.target, value, value.clearFont);
            }
            if (JSON.stringify(records) === original) continue;
            files.push({
                uuid: info.uuid,
                path: path.relative(inside('.'), info.file).replaceAll('\\', '/'),
                url: info.url,
                before,
                after: JSON.stringify(records, null, 2) + '\n',
                count: bindings.length,
            });
        }
        await assertClean(files);
        const id = randomUUID();
        plans.clear();
        plans.set(id, {
            args: { scope: 'bundle', module: args.module, bundle: args.bundle, locale: args.locale },
            files,
            sources: resolve.sources,
            assets: resolve.assets,
        });
        return {
            id,
            files: files.map(({ path, count }) => ({ path, operation: 'update', count })),
            skippedNested,
            message: `${files.length} 个资源将直接保存；嵌套实例的覆盖保留，源预制体在其所属资源包更新`,
        };
    }
    const recordFile = (id) => {
        if (!/^\d+-[a-f0-9]{8}$/.test(id)) throw Error('无效的更新记录');
        return inside(`.yzforge/editor-history/${id}.json`);
    };
    async function inspectFiles(files, restoring = false) {
        await assertClean(files);
        const pending = [];
        for (const file of files) {
            const info = await db('query-asset-info', file.uuid);
            if (!info || info.url !== file.url) throw Error('资源已移动或删除：' + file.path);
            const value = await fs.readFile(inside(info.file), 'utf8');
            if (restoring && value === file.before) continue;
            if (value !== (restoring ? file.after : file.before))
                throw Error('资源已被修改，保留当前内容：' + file.path);
            pending.push(file);
        }
        return pending;
    }
    async function restoreRecord(record) {
        if (record.action !== 'localization-update') throw Error('记录不是多语言更新');
        const files = await inspectFiles(record.files, true);
        for (const file of files) {
            await inspectFiles([file], true);
            await db('save-asset', file.url, file.before);
        }
        record.stage = 'restored';
        await fs.writeFile(recordFile(record.id), JSON.stringify(record, null, 2));
        return { message: `已恢复 ${files.length} 个资源`, restored: files.length };
    }
    return {
        previewLanguageUpdate: planBatch,
        async applyLanguageUpdate(args) {
            if (args.scope === 'current' || args.scope === 'selection') return updateCurrent(args);
            const plan = plans.get(args.planId);
            if (
                !plan ||
                hash(plan.args) !==
                    hash({ scope: args.scope, module: args.module, bundle: args.bundle, locale: args.locale })
            )
                throw Error('请先检查批量更新范围');
            plans.delete(args.planId);
            await assertSources(plan.sources);
            await assertAssets(plan.assets);
            await inspectFiles(plan.files);
            if (!plan.files.length) return { message: '没有需要更新的资源', updated: 0 };
            const id = await journal('localization-update', {
                locale: args.locale,
                stage: 'prepared',
                files: plan.files,
            });
            const record = JSON.parse(await fs.readFile(recordFile(id), 'utf8'));
            try {
                for (const file of plan.files) {
                    await inspectFiles([file]);
                    await db('save-asset', file.url, file.after);
                }
                record.stage = 'applied';
                await fs.writeFile(recordFile(id), JSON.stringify(record, null, 2));
                return {
                    message: `已保存 ${plan.files.length} 个资源，可从更新记录恢复`,
                    updated: plan.files.length,
                    id,
                };
            } catch (error) {
                try {
                    await restoreRecord(record);
                } catch (rollback) {
                    throw Error(`${error.message}；自动恢复未完成：${rollback.message}。记录 ${id}`, {
                        cause: rollback,
                    });
                }
                throw error;
            }
        },
        async restoreLanguageUpdate({ id }) {
            return restoreRecord(JSON.parse(await fs.readFile(recordFile(id), 'utf8')));
        },
        async languageUpdateHistory() {
            const directory = inside('.yzforge/editor-history');
            const result = [];
            for (const name of await fs.readdir(directory).catch((error) => {
                if (error.code === 'ENOENT') return [];
                throw error;
            })) {
                if (!/^\d+-[a-f0-9]{8}\.json$/.test(name)) continue;
                const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
                if (record.action === 'localization-update' && record.stage !== 'restored')
                    result.push({
                        id: record.id,
                        locale: record.locale,
                        files: record.files.length,
                        stage: record.stage,
                    });
            }
            return result.sort((a, b) => b.id.localeCompare(a.id));
        },
    };
};
