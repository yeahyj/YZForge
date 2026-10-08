'use strict';
const fs = require('fs/promises');
const syncFs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { runtimeOptions } = require('../../tools/yzforge/project/settings.cjs');
const { formatScript } = require('../../tools/yzforge/generators/format.cjs');
const bindings = require('../../tools/yzforge/generators/bindings.cjs');
const naming = require('../../tools/yzforge/project/naming.cjs');
const layout = require('../../tools/yzforge/project/layout.cjs');
const bundleConfig = require('./bundle-config');
const localizationLayout = require('../../tools/yzforge/project/localization-layout.cjs');
const { pathToFileURL } = require('url');
const workbookTools = () => {
    const file = path.join(root(), 'tools/yzforge/project/workbooks.mjs');
    return import(pathToFileURL(file).href + '?v=' + syncFs.statSync(file).mtimeMs);
};
const projectTools = () => {
    const file = path.join(root(), 'tools/yzforge/project/project.mjs');
    return import(pathToFileURL(file).href + '?v=' + syncFs.statSync(file).mtimeMs);
};
const name = 'yzforge-editor';
const workflow = require('./workflow');
const gameSettings = require('./game-settings');
const gameConfigTools = require('../../tools/yzforge/project/game-config.cjs');
const gameBuild = require('../../tools/yzforge/operations/game-build.cjs');
let queue = Promise.resolve();
let autoTimer;
let sourceWatcher;
let autoEnabled = false;
let activeOperation = false;
let pendingGeneration = false;
let autoStatus = { state: 'idle', message: '' };
const assetEvents = ['asset-db:asset-add', 'asset-db:asset-change', 'asset-db:asset-delete'];
const root = () => Editor.Project.path;
const read = async (target) => JSON.parse(await fs.readFile(target, 'utf8'));
const rel = (target) => path.relative(root(), target).replaceAll('\\', '/');
const url = (target) => 'db://' + rel(target);
const validId = (id) => {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ['shared', 'default', 'constructor', 'prototype'].includes(id))
        throw Error(`无效标识：${id}`);
    return id;
};
function inside(value) {
    const target = path.resolve(root(), value),
        local = path.relative(root(), target);
    if (local.startsWith('..') || path.isAbsolute(local)) throw Error('路径必须位于当前项目');
    let current = path.resolve(root());
    for (const segment of local.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        try {
            if (syncFs.lstatSync(current).isSymbolicLink()) throw Error('工作台不写入符号链接目录');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return target;
}
async function ensureFolder(target) {
    const parts = rel(inside(target)).split('/');
    let current = 'db://assets';
    if (parts.shift() !== 'assets') throw Error('Creator 资源路径必须位于 assets');
    for (const part of parts) {
        current += '/' + part;
        if (!(await Editor.Message.request('asset-db', 'query-asset-info', current)))
            await Editor.Message.request('asset-db', 'create-asset', current, null);
    }
}
async function saveJson(target, value) {
    target = inside(target);
    if (path.basename(target) === 'module.json') value = layout.sourceManifest(value);
    const previous = await fs.readFile(target, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    await journal('edit-json', { path: rel(target), previous, next: value });
    const content = JSON.stringify(value, null, 2) + '\n';
    if (rel(target).startsWith('assets/')) {
        const info = await Editor.Message.request('asset-db', 'query-asset-info', url(target));
        await Editor.Message.request('asset-db', info ? 'save-asset' : 'create-asset', url(target), content);
    } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
    }
}
async function journal(action, payload) {
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`,
        directory = inside('.yzforge/editor-history');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, id + '.json'), JSON.stringify({ id, action, ...payload }, null, 2));
    return id;
}
const scene = (method, ...args) => Editor.Message.request('scene', 'execute-scene-script', { name, method, args });
const writeScript = async (operation, target, source) =>
    Editor.Message.request('asset-db', operation, url(target), await formatScript(target, source));
async function waitClass(className, expected = {}) {
    if (expected.script) {
        const info = await Editor.Message.request('asset-db', 'query-asset-info', url(inside(expected.script)));
        if (!info?.uuid) throw Error('脚本尚未导入：' + expected.script);
        expected = { ...expected, ids: [info.uuid, Editor.Utils.UUID.compressUUID(info.uuid)] };
    }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (await scene('classReady', className, expected)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw Error(`脚本编译尚未完成：${className}。请修复编译错误后重试绑定。`);
}
async function moduleInfo(id, allowOrphan = false) {
    validId(id);
    const directory = inside(`assets/game/modules/${id}`);
    const manifest = await read(path.join(directory, 'module.json')).catch((error) => {
        if (allowOrphan && error.code === 'ENOENT' && syncFs.statSync(directory).isDirectory())
            return { id, layoutVersion: layout.layoutVersion, orphan: true, dependencies: {}, bundles: {}, views: {} };
        throw error;
    });
    return { directory, manifest: manifest.orphan ? manifest : layout.resolveModule(manifest) };
}
function bindingSource(module, className, fields, directory, component = false, typesImport) {
    const framework = path.relative(directory, inside('assets/framework')).replaceAll('\\', '/');
    return bindings.bindingSource(module, className, fields, framework, component, typesImport);
}
async function resolveBindingFields(fields, directory) {
    return bindings.resolveBindingFields(fields, directory, async (classId) => {
        const uuid = Editor.Utils.UUID.decompressUUID(classId);
        const info = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
        // 只允许当前项目的真实脚本；不能靠 ccclass 名称猜文件路径或从库目录导入。
        return info?.url?.startsWith('db://assets/') && info.file ? inside(info.file) : null;
    });
}
async function assertBindingSceneSaved() {
    if (await Editor.Message.request('scene', 'query-dirty'))
        throw Error('请先保存正在编辑的场景或预制体，再更新绑定；未保存的节点修改不会参与资产扫描');
}
async function bindView(args) {
    await assertBindingSceneSaved();
    const { directory, manifest } = await moduleInfo(args.module),
        view = manifest.views[args.id];
    if (!view) throw Error('界面未登记');
    const asset = await resourceIdentity(manifest, view.prefab);
    if (!asset) throw Error('界面 Prefab 未登记');
    const settings = await read(inside('project-settings/framework.json'));
    const className = view.className.split('.').pop(),
        target = inside(path.join(directory, view.binding));
    const fields = await resolveBindingFields(
        await scene('scanPrefab', asset.uuid, settings.bindingPrefixes),
        path.dirname(target),
    );
    const text = await formatScript(
        target,
        bindingSource(
            manifest.id,
            className,
            fields,
            path.dirname(target),
            false,
            layout.importPath(view.binding, view.types),
        ),
    );
    await journal('binding', { path: rel(target), previous: await fs.readFile(target, 'utf8'), fields });
    await Editor.Message.request('asset-db', 'save-asset', url(target), text);
    await waitClass(view.className);
    // The class may be registered while compilation is still replacing its serialized property metadata.
    let bound;
    const deadline = Date.now() + 15000;
    do {
        try {
            bound = await scene(
                'bindPrefab',
                asset.uuid,
                view.className,
                settings.bindingPrefixes,
                bindings.bindingPlan(fields),
            );
            break;
        } catch (error) {
            if (!/not compiled yet|Wait for script compilation/.test(error.message) || Date.now() >= deadline)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    } while (Date.now() < deadline);
    if (!bound) throw Error('绑定脚本未完成编译');
    await assertBindingSceneSaved();
    await Editor.Message.request('asset-db', 'save-asset', asset.uuid, bound.content);
    return scene('validateBinding', asset.uuid, view.className, settings.bindingPrefixes);
}
async function resourceIdentity(manifest, id) {
    const ledger = await read(inside('project-settings/state/resource-identities.json')).catch((error) => {
        if (error.code === 'ENOENT') return { entries: {} };
        throw error;
    });
    const entry = Object.entries(ledger.entries).find(([, value]) => value.id === id && value.active);
    if (entry) return { uuid: entry[0], type: entry[1].type };
    const view = Object.values(manifest.views ?? {}).find((view) => view.prefab === id);
    if (!view) return null;
    const bundle = manifest.bundles[id.split('/')[1]];
    if (!bundle) return null;
    const target = inside(
        `assets/game/modules/${manifest.id}/${bundle.root}/dynamic/ui/${view.className.split('.').pop()}.prefab`,
    );
    const info = await Editor.Message.request('asset-db', 'query-asset-info', url(target));
    return info ? { uuid: info.uuid, type: 'Prefab' } : null;
}
function runTool(command, extra = []) {
    return new Promise((resolve, reject) =>
        execFile(
            'node',
            [inside('tools/yzforge/cli.mjs'), command, '--editor', ...extra],
            { cwd: root(), windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    let message = stderr || stdout || error.message;
                    let code;
                    try {
                        const value = JSON.parse(message);
                        message = value.error || value.message || message;
                        code = value.code;
                    } catch {
                        /* Non-JSON process errors remain readable. */
                    }
                    reject(Object.assign(Error(message), { code }));
                } else {
                    try {
                        resolve(JSON.parse(stdout));
                    } catch {
                        reject(Error(stdout));
                    }
                }
            },
        ),
    );
}
async function listFiles(directory) {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw Error('不支持符号链接目录');
        if (entry.isDirectory()) result.push(...(await listFiles(target)));
        else result.push(target);
    }
    return result;
}
const previewDelete = require('../../tools/yzforge/operations/deletion-plan.cjs').createDeletionPlanner({
    root,
    inside,
    rel,
    url,
    moduleInfo,
    read,
    resourceIdentity,
    listFiles,
    workbookTools,
    state: () => exports.methods.state(),
    request: (...args) => Editor.Message.request(...args),
    compressUUID: (...args) => Editor.Utils.UUID.compressUUID(...args),
});
async function deleteModule(args) {
    return recovery.remove(args);
}
async function restore(args) {
    return recovery.restore(args);
}
const recovery = require('../../tools/yzforge/operations/recovery.cjs').createRecovery({
    root,
    request: (...args) => Editor.Message.request(...args),
    inside,
    rel,
    url,
    read,
    journal,
    moduleInfo,
    previewDelete,
    saveJson,
    ensureFolder,
    workbookTools,
});
const creation = require('../../tools/yzforge/operations/creation.cjs').createCreationTracker({
    inside,
    url,
    db: (...args) => Editor.Message.request('asset-db', ...args),
    references: async (record, changes) => {
        const targets = changes
            .filter((change) => change.action === 'delete' && !change.directory && !change.path.endsWith('.meta'))
            .map((change) => change.path);
        if (!targets.length) return [];
        const preview = await previewDelete(
            { module: record.request.kind === 'module' ? record.request.id : record.request.module, kind: 'creation' },
            {
                request: record.request,
                targets,
                restored: changes.filter((change) => change.action === 'restore').map((change) => change.path),
            },
        );
        return preview.references;
    },
});
const actions = {
    async readWorkflowSource(args) {
        if (!Object.prototype.hasOwnProperty.call(workflow.sources, args.id)) throw Error('未知示例源码');
        const relative = workflow.sources[args.id];
        const target = inside(relative);
        if (!syncFs.existsSync(target))
            return {
                path: relative,
                content: '此示例文件已被移除。通用工作台功能仍可使用，请参照自己的业务文件。',
                missing: true,
            };
        const content = await fs.readFile(target, 'utf8');
        return { path: relative, content, missing: false };
    },
    formulaEnvironment: () => runTool('formula-status'),
    previewCreationCleanup: (args) => creation.previewCleanup(args),
    cleanupCreation: (args) => creation.cleanup(args),
    previewGenerationRecovery: async (args) => (await projectTools()).previewTransaction(root(), args.id),
    recoverGeneration: async (args) => {
        const result = await (await projectTools()).recoverTransaction(root(), args);
        await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/game');
        return result;
    },
    bindView,
    previewDelete,
    deleteModule,
    restore,
    async generate() {
        await gameSettings.refreshChannels();
        const preview = await runTool('preview'),
            obsoleteSet = new Set(preview.obsolete.map((item) => inside(item).toLowerCase())),
            managedSet = new Set(
                [...preview.outputPaths, ...preview.obsolete].map((item) => inside(item).toLowerCase()),
            );
        // Validate before replacing any good output; a removed table may still be imported by business code.
        if (obsoleteSet.size) {
            const dependencies = (
                await import(pathToFileURL(inside('tools/yzforge/validation/dependencies.mjs')).href)
            ).dependencyResolver(root());
            for (const file of await listFiles(inside('assets/game'))) {
                if (!file.endsWith('.ts') || managedSet.has(file.toLowerCase())) continue;
                for (const edge of dependencies.imports(file))
                    if (edge.target && obsoleteSet.has(path.resolve(edge.target).toLowerCase()))
                        throw Error(`旧生成文件仍被手写代码导入：${rel(file)} → ${edge.spec}`);
            }
        }
        for (const obsolete of preview.obsolete) {
            const target = inside(obsolete);
            if (!/\.(ts|json)$/.test(target) || !rel(target).startsWith('assets/game/'))
                throw Error('无效生成产物回收路径');
            const info = await Editor.Message.request('asset-db', 'query-asset-info', url(target));
            if (info) {
                const users = await Editor.Message.request('asset-db', 'query-asset-users', info.uuid, 'all');
                for (const user of users || []) {
                    if (!user) continue;
                    const info = await Editor.Message.request('asset-db', 'query-asset-info', user);
                    if (info && !managedSet.has(path.resolve(info.file).toLowerCase()))
                        throw Error(`旧生成文件仍有引用，请先处理：${obsolete} ← ${info.url}`);
                }
            }
        }
        const result = await runTool('generate');
        for (const obsolete of result.obsolete || []) {
            const target = inside(obsolete);
            const id = await journal('obsolete-generated', {
                path: obsolete,
                previous: await fs.readFile(target, 'utf8'),
            });
            const archive = inside(`.yzforge/trash/${id}`);
            await fs.mkdir(archive, { recursive: true });
            await fs.copyFile(target, path.join(archive, path.basename(target)));
            try {
                await fs.copyFile(target + '.meta', path.join(archive, path.basename(target) + '.meta'));
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            await Editor.Message.request('asset-db', 'delete-asset', url(target));
        }
        await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
        if (result.validationErrors?.length)
            throw Error('资源索引和 Key 已更新，请修复以下引用后重新检查：\n' + result.validationErrors.join('\n'));
        return result;
    },
    previewTables: () => runTool('preview', ['--preview-formulas']),
    recalculate: (args) => runTool('recalculate', ['--source', args.source]),
    async updateSettings(args) {
        const target = inside('project-settings/framework.json'),
            settings = await read(target);
        for (const key of Object.keys(args))
            if (
                ![
                    'appId',
                    'cleanupTimeoutMs',
                    'maxAudioVoices',
                    'audioChannels',
                    'calendar',
                    'bindingPrefixes',
                    'wechatPerformanceUnit',
                    'localization',
                ].includes(key)
            )
                throw Error(`不支持此设置：${key}`);
        const next = { ...settings, ...args };
        runtimeOptions(next);
        await saveJson(target, next);
        return next;
    },
    async exportGameBuild() {
        if (await Editor.Message.request('scene', 'query-dirty')) throw Error('请先保存场景，再导出构建参数');
        await actions.generate();
        return gameSettings.buildOptions();
    },
    async recoverGameBuild() {
        const result = await gameBuild.recover(root(), async () => {
            const state = await Editor.Message.request('builder', 'query-tasks-info');
            return (
                state?.free === true &&
                Array.isArray(state.list) &&
                !state.list.some((task) => task.state === 'processing' || task.state === 'waiting')
            );
        });
        await actions.generate();
        autoStatus = { state: 'ready', message: '构建状态已恢复，动态清单与配置已同步' };
        return result;
    },
    check: () => runTool('check'),
    async updateModule(args) {
        const { directory, manifest } = await moduleInfo(args.module);
        if (args.displayName !== undefined) manifest.displayName = String(args.displayName);
        if (args.dependencies) {
            manifest.dependencies = naming.dependencies(
                (await exports.methods.state()).modules,
                manifest.id,
                args.dependencies,
            );
        }
        await saveJson(path.join(directory, 'module.json'), manifest);
        return manifest;
    },
    async moveAsset(args) {
        const source = await Editor.Message.request('asset-db', 'query-asset-info', args.uuid),
            target = inside(args.target);
        if (!source || !source.url.startsWith('db://assets/game/') || !rel(target).startsWith('assets/game/'))
            throw Error('只能移动当前游戏资源');
        const state = await exports.methods.state();
        const ownership = (file) =>
            state.modules
                .flatMap((module) =>
                    Object.entries(localizationLayout.physicalBundles(module)).map(([group, bundle]) => ({
                        id: `${module.id}/${group}`,
                        language: !!bundle.language,
                        directory: inside(`assets/game/modules/${module.id}/${bundle.root}`),
                    })),
                )
                .filter((item) => file.startsWith(item.directory + path.sep))
                .sort((a, b) => b.directory.length - a.directory.length)[0];
        const before = ownership(source.file),
            after = ownership(target);
        if (before?.language || after?.language)
            throw Error('语言资源移动会改变相对路径 key，请使用多语言页的资源改名，同步各语言资源后检查旧 Key 引用');
        if (before?.id !== after?.id)
            throw Error('跨资源包移动会改变资源身份，请通过显式迁移更新语言映射和所有引用；普通移动只允许同包改名');
        await ensureFolder(path.dirname(target));
        await Editor.Message.request('asset-db', 'move-asset', source.url, url(target));
        const result = await Editor.Message.request('asset-db', 'query-asset-info', url(target));
        if (result.uuid !== source.uuid) throw Error('资源移动未保留 UUID');
        await journal('move-asset', { from: source.url, to: result.url, uuid: result.uuid });
        return result;
    },
};
Object.assign(actions, require('./localization-update').createLocalizationUpdates({ inside, journal, moduleInfo }));
Object.assign(
    actions,
    require('./language-rename').createLanguageRenames({ root, inside, ensureFolder, assertBindingSceneSaved }),
);
Object.assign(
    actions,
    require('./localization').createLocalizationTools({
        root,
        inside,
        read,
        moduleInfo,
        saveJson,
        workbookTools,
        ensureFolder,
        url,
        journal,
        actions: () => actions,
    }),
);
Object.assign(
    actions,
    require('../../tools/yzforge/operations/workbench.cjs').createWorkbench({
        request: (...args) => Editor.Message.request(...args),
        ensurePresets: () => bundleConfig.ensurePresets(),
        openBundleSettings: () => Editor.Message.send('project', 'open-settings', 'builder', 'bundle-config'),
        openFile: (file) => require('electron').shell.openPath(file),
        root,
        inside,
        rel,
        url,
        moduleInfo,
        ensureFolder,
        saveJson,
        writeScript,
        waitClass,
        scene,
        bindingSource,
        resolveBindingFields,
        assertBindingSceneSaved,
        bindingPlan: bindings.bindingPlan,
        workbookTools,
        read,
        creation,
        actions: () => actions,
        state: () => exports.methods.state(),
        designResolution: () => Editor.Profile.getProject('project', 'general.designResolution'),
        bundleMetadata: (meta, id, kind) => ({
            ...meta,
            userData: {
                ...meta.userData,
                isBundle: true,
                bundleName: id,
                priority: kind === 'code' ? 2 : 1,
                bundleConfigID: kind === 'code' ? bundleConfig.codeId : bundleConfig.resourceId,
            },
        }),
    }),
);
function scheduleGeneration() {
    if (!autoEnabled) return;
    if (activeOperation) {
        pendingGeneration = true;
        return;
    }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
        autoTimer = undefined;
        autoStatus = { state: 'pending', message: '正在更新动态清单与配置' };
        void exports.methods.dispatch('generate').then(
            () => {
                autoStatus = { state: 'ready', message: '动态清单与配置已同步' };
            },
            (error) => {
                if (!autoEnabled) return;
                if (error.code === 'GAME_BUILD_BUSY') {
                    autoStatus = {
                        state: 'waiting',
                        message: '等待构建结束后自动生成配置；构建中断时请使用游戏设置菜单恢复',
                    };
                    scheduleGeneration();
                    return;
                }
                autoStatus = { state: 'error', message: error.message };
                console.warn('[YZForge] 自动生成未完成：' + error.message);
            },
        );
    }, 800);
}
function assetChanged(...args) {
    const text = JSON.stringify(args).replaceAll('\\', '/');
    if (
        !text.includes('assets/game/modules/') ||
        text.includes('/generated/') ||
        text.includes('/yz-index.json') ||
        text.includes('/yz-locale.json') ||
        text.includes('/dynamic/config/') ||
        text.includes('/dynamic/i18n/')
    )
        return;
    scheduleGeneration();
}
exports.load = function () {
    autoEnabled = true;
    syncFs.watchFile(inside(gameConfigTools.sourcePath), { interval: 1000 }, scheduleGeneration);
    syncFs.watchFile(inside(gameConfigTools.selectionPath), { interval: 1000 }, scheduleGeneration);
    scheduleGeneration();
    for (const event of assetEvents) Editor.Message.addBroadcastListener(event, assetChanged);
    const source = inside('config-source');
    if (syncFs.existsSync(source)) {
        sourceWatcher = syncFs.watch(source, { recursive: true }, (_event, file) => {
            if (file && /\.xlsx$/i.test(String(file)) && !path.basename(String(file)).startsWith('~$'))
                scheduleGeneration();
        });
        sourceWatcher.on('error', (error) => {
            autoStatus = { state: 'error', message: error.message };
        });
    }
    void bundleConfig.ensurePresets().catch((error) => {
        autoStatus = { state: 'error', message: error.message };
    });
};
exports.unload = function () {
    autoEnabled = false;
    syncFs.unwatchFile(inside(gameConfigTools.sourcePath), scheduleGeneration);
    syncFs.unwatchFile(inside(gameConfigTools.selectionPath), scheduleGeneration);
    clearTimeout(autoTimer);
    sourceWatcher?.close();
    sourceWatcher = undefined;
    for (const event of assetEvents) Editor.Message.removeBroadcastListener(event, assetChanged);
};
exports.methods = {
    recoverGameBuild: () => exports.methods.dispatch('recoverGameBuild'),
    gameSettingsState: () => gameSettings.state(),
    async openGameConfig() {
        const error = await require('electron').shell.openPath(inside(gameConfigTools.sourcePath));
        if (error) throw Error(error);
    },
    async exportGameBuild() {
        const result = await exports.methods.dispatch('exportGameBuild');
        require('electron').shell.showItemInFolder(result.file);
        return result;
    },
    openPanel() {
        Editor.Panel.open(name);
    },
    async state() {
        const directory = inside('assets/game/modules');
        let entries = [];
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const modules = [],
            orphans = [];
        for (const entry of entries)
            if (entry.isDirectory()) {
                try {
                    modules.push(layout.resolveModule(await read(path.join(directory, entry.name, 'module.json'))));
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                    orphans.push({ id: entry.name, displayName: `${entry.name}（未完成的模块目录）` });
                }
            }
        const tool = await workbookTools();
        const sources = await tool.workbookSources(root(), { tolerant: true });
        const workbooks = sources.workbooks.map(({ source, hash, config, sheets, enums }) => ({
            source,
            hash,
            config,
            sheets,
            enums,
        }));
        const history = [];
        for (const entry of await fs.readdir(inside('.yzforge/trash'), { withFileTypes: true }).catch((error) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        })) {
            if (!entry.isDirectory()) continue;
            const record = await read(inside(`.yzforge/trash/${entry.name}/record.json`)).catch((error) => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            if (record && ['deleted', 'interrupted', 'restoring'].includes(record.stage))
                history.push({
                    id: record.id,
                    original: record.original,
                    stage: record.stage,
                    kind: record.preview.kind,
                });
        }
        const scripts = (await listFiles(directory))
            .filter((file) => file.endsWith('.ts') && !file.includes(`${path.sep}generated${path.sep}`))
            .map(rel);
        const prefabs = await Editor.Message.request('asset-db', 'query-assets', {
            pattern: 'db://assets/game/modules/**',
            importer: 'prefab',
        });
        return {
            project: root(),
            modules,
            settings: await read(inside('project-settings/framework.json')),
            tables: { tables: sources.tables },
            workbooks,
            languageResources: await actions.languageResourceState(modules),
            localizationWorkbooks: sources.localizationWorkbooks.map(({ source, hash, config, localization }) => ({
                source,
                hash,
                config,
                localization,
            })),
            workbookDiagnostics: sources.diagnostics,
            orphans,
            history,
            creations: await creation.list(),
            generations: await (await projectTools()).pendingTransactions(root()),
            scripts,
            prefabs: prefabs.map(({ uuid, url }) => ({ uuid, url })),
            autoStatus,
            languageUpdates: await actions.languageUpdateHistory(),
            languageRenames: await actions.languageRenameHistory(),
            presets: (await Editor.Profile.getProject('builder', 'bundleConfig.custom')) ?? {},
        };
    },
    dispatch(action, args = {}) {
        if (!Object.prototype.hasOwnProperty.call(actions, action)) return Promise.reject(Error(`未知操作：${action}`));
        const result = queue.then(async () => {
            activeOperation = true;
            let succeeded = false;
            if (autoTimer) {
                clearTimeout(autoTimer);
                autoTimer = undefined;
                pendingGeneration = true;
            }
            try {
                // 先拦截工作台资源变更，不能等创建完文件、开始生成时才发现构建正在占用项目。
                if (
                    [
                        'create',
                        'cleanupCreation',
                        'applyLanguageUpdate',
                        'restoreLanguageUpdate',
                        'applyLanguageRename',
                        'restoreLanguageRename',
                        'deleteModule',
                        'restore',
                    ].includes(action)
                )
                    await gameConfigTools.assertUnlocked(root());
                const value = await actions[action](args);
                if (
                    [
                        'create',
                        'deleteModule',
                        'restore',
                        'saveWorkbook',
                        'updateModule',
                        'updateSettings',
                        'moveAsset',
                        'cleanupCreation',
                        'applyLanguageRename',
                        'restoreLanguageRename',
                    ].includes(action)
                ) {
                    clearTimeout(autoTimer);
                    try {
                        await actions.generate();
                        autoStatus = { state: 'ready', message: '动态清单与配置已同步' };
                    } catch (error) {
                        autoStatus = { state: 'error', message: error.message };
                        return { ...value, generationError: error.message };
                    }
                }
                succeeded = true;
                return value;
            } finally {
                activeOperation = false;
                const pending = pendingGeneration;
                pendingGeneration = false;
                // A failed transaction retains the last good outputs until explicit recovery.
                if (succeeded && pending) scheduleGeneration();
            }
        });
        queue = result.catch(() => {});
        return result;
    },
};
