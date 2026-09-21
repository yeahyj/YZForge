'use strict';
const fs = require('fs/promises');
const syncFs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const { runtimeOptions } = require('../../tools/yzforge/settings.cjs');
const { formatScript } = require('../../tools/yzforge/format.cjs');
const naming = require('../../tools/yzforge/naming.cjs');
const bundleConfig = require('./bundle-config');
const { pathToFileURL } = require('url');
const workbookTools = () => {
    const file = path.join(root(), 'tools/yzforge/workbooks.mjs');
    return import(pathToFileURL(file).href + '?v=' + syncFs.statSync(file).mtimeMs);
};
const name = 'yzforge-editor';
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
const pascal = (id) =>
    id
        .split('-')
        .map((value) => value[0].toUpperCase() + value.slice(1))
        .join('');
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
async function waitClass(className) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (await scene('classReady', className)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw Error(`脚本编译尚未完成：${className}。请修复编译错误后重试绑定。`);
}
async function moduleInfo(id, allowOrphan = false) {
    validId(id);
    const directory = inside(`assets/game/modules/${id}`);
    const manifest = await read(path.join(directory, 'module.json')).catch((error) => {
        if (allowOrphan && error.code === 'ENOENT' && syncFs.statSync(directory).isDirectory())
            return { id, orphan: true, dependencies: [], bundles: {}, views: {}, assets: {} };
        throw error;
    });
    return { directory, manifest };
}
async function bundleFolder(directory, definition, kind = 'resources') {
    await bundleConfig.ensurePresets();
    const target = inside(path.join(directory, definition.root));
    await ensureFolder(target);
    const meta = await Editor.Message.request('asset-db', 'query-asset-meta', url(target));
    if (!meta) throw Error('Creator 尚未导入资源目录');
    meta.userData = {
        ...meta.userData,
        isBundle: true,
        bundleName: definition.id,
        priority: kind === 'code' ? 2 : 1,
        bundleConfigID: kind === 'code' ? bundleConfig.codeId : bundleConfig.resourceId,
    };
    await Editor.Message.request('asset-db', 'save-asset-meta', url(target), JSON.stringify(meta));
    const check = await Editor.Message.request('asset-db', 'query-asset-meta', url(target));
    if (check?.userData?.bundleName !== definition.id || !check.userData.isBundle) throw Error('资源包属性保存失败');
}
async function createModule(args) {
    const id = validId(naming.slug(args.id)),
        directory = inside(`assets/game/modules/${id}`);
    if (await Editor.Message.request('asset-db', 'query-asset-info', url(directory))) throw Error(`模块已存在：${id}`);
    await ensureFolder(directory);
    await ensureFolder(path.join(directory, 'code'));
    await ensureFolder(path.join(directory, 'code/generated'));
    const manifest = {
        id,
        layoutVersion: 2,
        displayName: args.displayName || id,
        dependencies: naming.dependencies(
            [...(await exports.methods.state()).modules, { id, dependencies: [] }],
            id,
            args.dependencies ?? [],
        ),
        bundles: args.codeOnly ? {} : { default: { id: `m-${id}`, root: 'bundles/default' } },
        views: {},
        audio: {},
    };
    await saveJson(path.join(directory, 'module.json'), manifest);
    if (manifest.bundles.default) {
        await bundleFolder(directory, manifest.bundles.default);
        await ensureFolder(path.join(directory, 'bundles/default/dynamic'));
        await ensureFolder(path.join(directory, 'bundles/default/static'));
    }
    const type = pascal(id),
        framework = path.relative(path.join(directory, 'code'), inside('assets/framework')).replaceAll('\\', '/');
    await writeScript(
        'create-asset',
        path.join(directory, `code/${type}Module.ts`),
        `import type { ModuleContext } from '${framework}/modules/module-manager';\nexport function create${type}Module(ctx: ModuleContext) {\n  return { api: { get moduleId() { return ctx.id; } } };\n}\n`,
    );
    await writeScript(
        'create-asset',
        path.join(directory, 'public.ts'),
        `import type { ModuleRef } from '../../../framework/modules/module-manager';\nexport interface ${type}Api { readonly moduleId: string; }\nexport const ${type}Module: ModuleRef<${type}Api> = { id: '${id}' };\n`,
    );
    await ensureFolder(path.join(directory, 'contracts'));
    if (args.delivery !== 'eager') {
        await writeScript(
            'create-asset',
            path.join(directory, `code/${type}ModuleEntry.ts`),
            `import { _decorator } from 'cc';\nimport { ModuleEntry } from '${framework}/modules/module-entry';\nimport { create${type}Module } from './${type}Module';\nconst { ccclass } = _decorator;\n@ccclass('${id}.${type}ModuleEntry')\nexport class ${type}ModuleEntry extends ModuleEntry {\n    get moduleId(): string { return '${id}'; }\n    get factory() { return create${type}Module; }\n}\n`,
        );
        await waitClass(`${id}.${type}ModuleEntry`);
        const content = await scene('createPrefab', `${id}.${type}ModuleEntry`, `${type}ModuleEntry`, false);
        await Editor.Message.request(
            'asset-db',
            'create-asset',
            url(path.join(directory, 'code/entry.prefab')),
            content,
        );
        manifest.code = { mode: 'bundled', root: 'code', bundle: `code-${id}`, entryPath: 'entry' };
        await bundleFolder(directory, { root: 'code', id: manifest.code.bundle }, 'code');
        await saveJson(path.join(directory, 'module.json'), manifest);
    }
    return { id, directory: rel(directory) };
}
async function createBundle(args) {
    const { directory, manifest } = await moduleInfo(args.module),
        group = args.id === 'default' ? 'default' : validId(args.id);
    if (manifest.bundles[group]) throw Error('资源包已存在');
    const definition = {
        id: group === 'default' ? `m-${manifest.id}` : `${manifest.id}-${group}`,
        root: `bundles/${group}`,
    };
    await bundleFolder(directory, definition);
    await ensureFolder(path.join(directory, definition.root, 'dynamic'));
    await ensureFolder(path.join(directory, definition.root, 'static'));
    manifest.bundles[group] = definition;
    await saveJson(path.join(directory, 'module.json'), manifest);
    return definition;
}
async function createScript(args) {
    const { directory, manifest } = await moduleInfo(args.module),
        type = naming.named(args.id, args.kind).className;
    const component = args.kind === 'component',
        folder = path.join(directory, 'code', component ? 'components' : 'services');
    await ensureFolder(folder);
    const framework = path.relative(folder, inside('assets/framework')).replaceAll('\\', '/');
    const content = component
        ? `import { _decorator } from 'cc';\nimport { GameComponent, ActivationContext } from '${framework}/core/game-component';\nconst { ccclass } = _decorator;\n@ccclass('${manifest.id}.${type}')\nexport class ${type} extends GameComponent {\n  protected onInit(): void {}\n  protected onActivate(_activation: ActivationContext): void {\n    // _activation.run(async task => { ...; task.commit(() => { ... }); });\n  }\n}\n`
        : `import type { ModuleContext } from '${framework}/modules/module-manager';\nexport class ${type} {\n  constructor(private readonly ctx: ModuleContext) {}\n}\n`;
    const target = path.join(folder, `${type}.ts`);
    return writeScript('create-asset', target, content);
}
function bindingSource(module, className, fields, directory, component = false) {
    const framework = path.relative(directory, inside('assets/framework')).replaceAll('\\', '/');
    const types = [...new Set(fields.map((field) => field.type))];
    const declarations = fields
        .map(
            (field) =>
                `  @property({ type: ${field.type}, visible: false })\n  private ${field.field}: ${field.type} | null = null;\n  protected get ${field.name}(): ${field.type} { return this.requireBinding(this.${field.field}, ${JSON.stringify(field.nodeName)}); }`,
        )
        .join('\n');
    const base = component
        ? `import { GameComponent } from '${framework}/core/game-component';`
        : `import { UIView } from '${framework}/ui/ui-view';\nimport type { ${className}Params, ${className}Result } from '../${className}.types';`;
    return `// Generated by YZForge. Regeneration never modifies business code.\nimport { _decorator${types.length ? ', ' + types.join(', ') : ''} } from 'cc';\n${base}\nconst { ccclass${types.length ? ', property' : ''} } = _decorator;\n@ccclass('${module}.${className}Binding')\nexport class ${className}Binding extends ${component ? 'GameComponent' : `UIView<${className}Params, ${className}Result>`} {\n${declarations}\n  protected validateBindings(): void { ${fields.map((field) => `void this.${field.name};`).join(' ')} }\n}\n`;
}
async function createView(args) {
    const { directory, manifest } = await moduleInfo(args.module),
        { id, className } = naming.named(args.id, args.kind || 'popup');
    if (manifest.views[id]) throw Error('界面已存在');
    const group = args.bundle || 'default',
        bundle = manifest.bundles[group];
    if (!bundle) throw Error('请先创建目标资源包，再创建界面');
    const resolution = await Editor.Profile.getProject('project', 'general.designResolution');
    if (!(resolution?.width > 0 && resolution?.height > 0)) throw Error('请先在 Creator 项目设置中配置设计分辨率');
    const code = path.join(directory, 'code/ui'),
        generated = path.join(code, 'generated');
    await ensureFolder(generated);
    const uiFolder = `${manifest.layoutVersion === 2 ? 'dynamic/' : ''}ui`;
    await ensureFolder(path.join(directory, bundle.root, uiFolder));
    const files = {
        [path.join(code, `${className}.types.ts`)]:
            `// Replace void with this view's own parameter/result contracts when needed.\nexport type ${className}Params = void;\nexport type ${className}Result = void;\n`,
        [path.join(generated, `${className}Binding.ts`)]: bindingSource(manifest.id, className, [], generated),
        [path.join(code, `${className}.ts`)]:
            `import { _decorator } from 'cc';\nimport { ${className}Binding } from './generated/${className}Binding';\nconst { ccclass } = _decorator;\n@ccclass('${manifest.id}.${className}')\nexport class ${className} extends ${className}Binding {\n  // Override onCreate / onShow / onHide / onDispose as needed.\n}\n`,
    };
    if (args.presenter) {
        files[path.join(code, `${className}Presenter.ts`)] =
            `import type { TaskContext } from '${path.relative(code, inside('assets/framework/core/scope')).replaceAll('\\', '/')}';\nexport interface ${className}Port { render(): void; }\nexport class ${className}Presenter {\n    constructor(private readonly view: ${className}Port) {}\n    show(task: TaskContext): void { task.signal.throwIfAborted(); task.commit(() => this.view.render()); }\n}\n`;
        files[path.join(code, `${className}.ts`)] =
            `import { _decorator } from 'cc';\nimport type { TaskContext } from '${path.relative(code, inside('assets/framework/core/scope')).replaceAll('\\', '/')}';\nimport { ${className}Binding } from './generated/${className}Binding';\nimport { ${className}Presenter } from './${className}Presenter';\nconst { ccclass } = _decorator;\n@ccclass('${manifest.id}.${className}')\nexport class ${className} extends ${className}Binding {\n    protected onShow(show: TaskContext): void { new ${className}Presenter(this).show(show); }\n    render(): void { /* Update bound nodes from the presentation model. */ }\n}\n`;
    }
    for (const [target, text] of Object.entries(files)) await writeScript('create-asset', target, text);
    await waitClass(`${manifest.id}.${className}`);
    const content = await scene('createView', `${manifest.id}.${className}`, className, {
        width: resolution.width,
        height: resolution.height,
    });
    const prefab = await Editor.Message.request(
        'asset-db',
        'create-asset',
        url(path.join(directory, bundle.root, `${uiFolder}/${className}.prefab`)),
        content,
    );
    const assetId = `${manifest.id}/${group}/prefab/${manifest.layoutVersion === 2 ? 'ui/' : ''}${id}`;
    if (manifest.layoutVersion !== 2) (manifest.assets ??= {})[assetId] = { type: 'Prefab', uuid: prefab.uuid };
    manifest.views[id] = {
        prefab: assetId,
        kind: args.kind || 'popup',
        cache: 'none',
        duplicate: 'reject',
        className: `${manifest.id}.${className}`,
        binding: `code/ui/generated/${className}Binding.ts`,
    };
    await saveJson(path.join(directory, 'module.json'), manifest);
    return { id: `${manifest.id}.${id}`, uuid: prefab.uuid, className: `${manifest.id}.${className}` };
}
async function bindView(args) {
    const { directory, manifest } = await moduleInfo(args.module),
        view = manifest.views[args.id];
    if (!view) throw Error('界面未登记');
    const asset = await resourceIdentity(manifest, view.prefab);
    if (!asset) throw Error('界面 Prefab 未登记');
    const settings = await read(inside('project-settings/framework.json'));
    const fields = await scene('scanPrefab', asset.uuid, settings.bindingPrefixes);
    const className = view.className.split('.').pop(),
        target = inside(path.join(directory, view.binding));
    const text = await formatScript(target, bindingSource(manifest.id, className, fields, path.dirname(target)));
    await journal('binding', { path: rel(target), previous: await fs.readFile(target, 'utf8'), fields });
    await Editor.Message.request('asset-db', 'save-asset', url(target), text);
    await waitClass(view.className);
    // The class may be registered while compilation is still replacing its serialized property metadata.
    let bound;
    const deadline = Date.now() + 15000;
    do {
        try {
            bound = await scene('bindPrefab', asset.uuid, view.className, settings.bindingPrefixes);
            break;
        } catch (error) {
            if (!/not compiled yet|Wait for script compilation/.test(error.message) || Date.now() >= deadline)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    } while (Date.now() < deadline);
    if (!bound) throw Error('绑定脚本未完成编译');
    await Editor.Message.request('asset-db', 'save-asset', asset.uuid, bound.content);
    return scene('validateBinding', asset.uuid, view.className, settings.bindingPrefixes);
}
async function resourceIdentity(manifest, id) {
    if (manifest.assets?.[id]) return manifest.assets[id];
    const ledger = await read(inside('project-settings/generated/resource-identities.json')).catch((error) => {
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
        `assets/game/modules/${manifest.id}/${bundle.root}/${manifest.layoutVersion === 2 ? 'dynamic/' : ''}ui/${view.className.split('.').pop()}.prefab`,
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
                    try {
                        const value = JSON.parse(message);
                        message = value.error || value.message || message;
                    } catch {
                        /* Non-JSON process errors remain readable. */
                    }
                    reject(Error(message));
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
async function registerAsset(args) {
    const { directory, manifest } = await moduleInfo(args.module);
    if (manifest.layoutVersion === 2) throw Error('动态资源由 dynamic 目录自动生成，无需手工登记');
    const id = String(args.id),
        parts = id.split('/');
    if (parts.length !== 4 || parts[0] !== manifest.id || !manifest.bundles[parts[1]])
        throw Error('资源逻辑标识应为 module/group/kind/name');
    const info = await Editor.Message.request('asset-db', 'query-asset-info', args.uuid);
    if (!info || !info.url.startsWith('db://assets/'))
        throw Error('请选择当前项目的真实资源（图片请选 SpriteFrame 子资源）');
    if (manifest.assets[id] && manifest.assets[id].uuid !== info.uuid)
        throw Error('逻辑名已被其他 UUID 使用，请显式重命名');
    if (args.atlasFrame && args.type !== 'SpriteFrame') throw Error('图集帧必须登记为 SpriteFrame');
    manifest.assets[id] = {
        uuid: info.uuid,
        type: args.type,
        ...(args.atlasFrame ? { atlasFrame: String(args.atlasFrame) } : {}),
    };
    await saveJson(path.join(directory, 'module.json'), manifest);
    return { id, uuid: info.uuid, url: info.url };
}
async function tableMapping(args) {
    const config = await read(inside('config-source/tables.json')),
        value = args.mapping;
    if (!value || typeof value.id !== 'string' || !value.source?.startsWith('config-source/'))
        throw Error('请提供 tableId 和 config-source 内的源文件');
    inside(value.source);
    const index = config.tables.findIndex((table) => table.id === value.id);
    if (index >= 0) config.tables[index] = value;
    else config.tables.push(value);
    await saveJson(inside('config-source/tables.json'), config);
    return value;
}
async function createTableTemplate(args) {
    const { manifest } = await moduleInfo(args.module),
        id = naming.slug(args.id),
        bundle = args.bundle || 'default';
    if (!manifest.bundles[bundle]) throw Error('请选择模块已有资源包');
    const source = `config-source/${manifest.id}/${id}.xlsx`;
    const tool = await workbookTools();
    const result = await tool.createWorkbook(root(), source, {
        module: manifest.id,
        bundle,
        enabled: true,
        tables: [{ id, sheet: pascal(id), primaryKey: 'id', enabled: true }],
    });
    return { source, hash: result.hash, config: result.config };
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
async function previewDelete(args) {
    const { directory, manifest } = await moduleInfo(args.module, true),
        state = await exports.methods.state(),
        kind = args.kind || 'module';
    const nextManifest = JSON.parse(JSON.stringify(manifest));
    const workbooks = [];
    const refs = [],
        ids = [],
        targets = [];
    if (kind === 'module') {
        targets.push(directory);
        ids.push(manifest.id + '/', manifest.id + '.');
        refs.push(
            ...state.modules
                .filter((module) => module.dependencies.includes(manifest.id))
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
        for (const table of state.tables.tables.filter((table) => table.formatVersion !== 2))
            if (table.id.startsWith(manifest.id + '.')) refs.push(`请先将旧配置表 ${table.id} 迁移为 XLSX 配置页`);
    } else if (kind === 'view' || kind === 'prefab') {
        const view = kind === 'view' ? manifest.views[args.id] : manifest.components?.[args.id];
        if (!view) throw Error('未找到界面');
        const registration = kind === 'view' ? await resourceIdentity(manifest, view.prefab) : { uuid: view.uuid };
        const identities = await read(inside('project-settings/generated/resource-identities.json'));
        const resourceId = view.prefab ?? identities.entries[view.uuid]?.id;
        if (!registration) throw Error('界面资源登记缺失');
        const prefab = await Editor.Message.request('asset-db', 'query-asset-info', registration.uuid);
        if (!prefab?.file) throw Error('界面 Prefab 未导入');
        const binding = inside(path.join(directory, view.binding));
        targets.push(
            inside(prefab.file),
            binding,
            binding.replace(`${path.sep}generated${path.sep}`, path.sep).replace(/Binding\.ts$/, '.ts'),
            ...(kind === 'view'
                ? [binding.replace(`${path.sep}generated${path.sep}`, path.sep).replace(/Binding\.ts$/, '.types.ts')]
                : []),
        );
        const presenter = binding
            .replace(path.sep + 'generated' + path.sep, path.sep)
            .replace(/Binding\.ts$/, 'Presenter.ts');
        if (syncFs.existsSync(presenter)) targets.push(presenter);
        ids.push(`${manifest.id}.${args.id}`, ...(resourceId ? [resourceId] : []));
        if (kind === 'view') delete nextManifest.views[args.id];
        else delete nextManifest.components[args.id];
        if (nextManifest.assets && resourceId) delete nextManifest.assets[resourceId];
        if (kind === 'view' && Object.values(nextManifest.views).some((other) => other.prefab === view.prefab))
            refs.push('其他界面也使用此 Prefab');
    } else if (kind === 'bundle') {
        const bundle = manifest.bundles[args.id];
        if (!bundle) throw Error('未找到资源包');
        targets.push(inside(path.join(directory, bundle.root)));
        ids.push(`${manifest.id}/${args.id}/`, bundle.id);
        for (const table of state.tables.tables)
            if (
                table.id.startsWith(manifest.id + '.') &&
                (table.bundle === args.id || Object.values(table.shards?.targets || {}).includes(args.id))
            )
                refs.push(`配置表 ${table.id} 仍使用此包`);
        for (const view of Object.values(manifest.views ?? {}))
            if (view.prefab.startsWith(`${manifest.id}/${args.id}/`)) refs.push(`界面仍使用资源 ${view.prefab}`);
        for (const id of Object.keys(nextManifest.assets ?? {}))
            if (id.startsWith(`${manifest.id}/${args.id}/`)) {
                if (Object.values(nextManifest.views).some((view) => view.prefab === id))
                    refs.push(`界面仍使用资源 ${id}`);
                delete nextManifest.assets[id];
            }
        for (const component of Object.values(manifest.components ?? {})) {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', component.uuid);
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
    const allAssets = await Editor.Message.request('asset-db', 'query-assets', { pattern: 'db://assets/game/**' });
    const assets = allAssets.filter((asset) => asset.file && owned.has(asset.file.toLowerCase()));
    const uuids = new Set(assets.map((asset) => asset.uuid));
    for (const other of state.modules)
        for (const [id, registration] of Object.entries(other.assets || {})) {
            if (!uuids.has(registration.uuid.split('@')[0]) && !uuids.has(registration.uuid)) continue;
            if (other.id === manifest.id && (kind === 'module' || !nextManifest.assets?.[id])) continue;
            refs.push(`动态资源 ${id} 仍登记了待删除的文件`);
        }
    for (const asset of assets) {
        const users = await Editor.Message.request('asset-db', 'query-asset-users', asset.uuid, 'all');
        for (const user of users || [])
            if (!uuids.has(user)) {
                if (!user) continue; // Creator can include empty importer bookkeeping entries, which are not asset UUIDs.
                const info = await Editor.Message.request('asset-db', 'query-asset-info', user);
                if (info && (!info.file || !owned.has(info.file.toLowerCase())) && !info.url.includes('/generated/'))
                    refs.push(`${info.url} 引用 ${asset.url}`);
            }
    }
    const ts = require(path.join(root(), 'node_modules/typescript'));
    const config = ts.readConfigFile(inside('tsconfig.json'), ts.sys.readFile);
    const compiler = ts.parseJsonConfigFileContent(config.config, ts.sys, root());
    for (const file of await listFiles(inside('assets/game'))) {
        if (
            owned.has(file.toLowerCase()) ||
            file.includes(`${path.sep}generated${path.sep}`) ||
            file.endsWith('.meta') ||
            file.endsWith('module.json')
        )
            continue;
        if (!/\.(ts|json|csv)$/.test(file)) continue;
        const content = await fs.readFile(file, 'utf8');
        for (const id of ids) if (content.includes(id)) refs.push(`${rel(file)} 包含对 ${id} 的引用`);
        if (file.endsWith('.ts')) {
            const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
            const visit = (node) => {
                if (
                    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                    node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                ) {
                    const result = ts.resolveModuleName(
                        node.moduleSpecifier.text,
                        file,
                        compiler.options,
                        ts.sys,
                    ).resolvedModule;
                    if (result && owned.has(path.resolve(result.resolvedFileName).toLowerCase()))
                        refs.push(`${rel(file)} 导入 ${node.moduleSpecifier.text}`);
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
        }
    }
    // XLSX references live in typed cells, not plain-text files or Creator's asset reference graph.
    for (const diagnostic of state.workbookDiagnostics ?? []) refs.push('配置表无法检查：' + diagnostic.message);
    const workbookTool = await workbookTools();
    for (const item of state.workbooks) {
        if (!item.config.enabled || (kind === 'module' && item.config.module === manifest.id)) continue;
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
                            item.source + ':' + table.sheet + '!' + rowNumber + ',' + column + ' 引用 ' + referenced,
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
async function deleteModule(args) {
    return recovery.remove(args);
}
async function restore(args) {
    return recovery.restore(args);
}
const recovery = require('./recovery').createRecovery({
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
const actions = {
    createModule,
    createBundle,
    createView,
    bindView,
    createScript,
    registerAsset,
    tableMapping,
    createTableTemplate,
    previewDelete,
    deleteModule,
    restore,
    async generate() {
        const preview = await runTool('preview'),
            obsoleteSet = new Set(preview.obsolete.map((item) => inside(item).toLowerCase()));
        // Validate before replacing any good output; a removed table may still be imported by business code.
        const ts = require(path.join(root(), 'node_modules/typescript'));
        const config = ts.readConfigFile(inside('tsconfig.json'), ts.sys.readFile),
            compiler = ts.parseJsonConfigFileContent(config.config, ts.sys, root());
        for (const file of await listFiles(inside('assets/game'))) {
            if (!file.endsWith('.ts') || file.includes(`${path.sep}generated${path.sep}`)) continue;
            const source = ts.createSourceFile(file, await fs.readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
            const visit = (node) => {
                if (
                    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                    node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                ) {
                    const target = ts.resolveModuleName(
                        node.moduleSpecifier.text,
                        file,
                        compiler.options,
                        ts.sys,
                    ).resolvedModule;
                    if (target && obsoleteSet.has(path.resolve(target.resolvedFileName).toLowerCase()))
                        throw Error(`旧生成文件仍被手写代码导入：${rel(file)} → ${node.moduleSpecifier.text}`);
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
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
                    if (info && !info.url.includes('/generated/'))
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
                ].includes(key)
            )
                throw Error(`不支持此设置：${key}`);
        const next = { ...settings, ...args };
        runtimeOptions(next);
        await saveJson(target, next);
        return next;
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
    async removeTable(args) {
        const tables = await read(inside('config-source/tables.json'));
        tables.tables = tables.tables.filter((table) => table.id !== args.id);
        await saveJson(inside('config-source/tables.json'), tables);
        return tables;
    },
    async moveAsset(args) {
        const source = await Editor.Message.request('asset-db', 'query-asset-info', args.uuid),
            target = inside(args.target);
        if (!source || !source.url.startsWith('db://assets/game/') || !rel(target).startsWith('assets/game/'))
            throw Error('只能移动当前游戏资源');
        await ensureFolder(path.dirname(target));
        await Editor.Message.request('asset-db', 'move-asset', source.url, url(target));
        const result = await Editor.Message.request('asset-db', 'query-asset-info', url(target));
        if (result.uuid !== source.uuid) throw Error('资源移动未保留 UUID');
        await journal('move-asset', { from: source.url, to: result.url, uuid: result.uuid });
        return result;
    },
};
Object.assign(
    actions,
    require('./workbench').createWorkbench({
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
        workbookTools,
        read,
        actions: () => actions,
        state: () => exports.methods.state(),
    }),
);
Object.assign(
    actions,
    require('./migration').createMigration({
        root,
        inside,
        rel,
        url,
        read,
        moduleInfo,
        listFiles,
        ensureFolder,
        saveJson,
        writeScript,
        bundleFolder,
        workbookTools,
        journal,
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
        text.includes('/dynamic/config/')
    )
        return;
    scheduleGeneration();
}
exports.load = function () {
    autoEnabled = true;
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
    clearTimeout(autoTimer);
    sourceWatcher?.close();
    sourceWatcher = undefined;
    for (const event of assetEvents) Editor.Message.removeBroadcastListener(event, assetChanged);
};
exports.methods = {
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
                    modules.push(await read(path.join(directory, entry.name, 'module.json')));
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
            workbookDiagnostics: sources.diagnostics,
            orphans,
            history,
            scripts,
            prefabs: prefabs.map(({ uuid, url }) => ({ uuid, url })),
            autoStatus,
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
                        'migrateModule',
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
