'use strict';
const fs = require('fs/promises');
const syncFs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const { runtimeOptions } = require('../../tools/yzforge/settings.cjs');
const { formatScript } = require('../../tools/yzforge/format.cjs');
const name = 'yzforge-editor';
let queue = Promise.resolve();
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
async function moduleInfo(id) {
    validId(id);
    const directory = inside(`assets/game/modules/${id}`);
    return { directory, manifest: await read(path.join(directory, 'module.json')) };
}
async function bundleFolder(directory, definition) {
    const target = inside(path.join(directory, definition.root));
    await ensureFolder(target);
    const meta = await Editor.Message.request('asset-db', 'query-asset-meta', url(target));
    if (!meta) throw Error('Creator 尚未导入资源目录');
    meta.userData = { ...meta.userData, isBundle: true, bundleName: definition.id, priority: 1 };
    await Editor.Message.request('asset-db', 'save-asset-meta', url(target), JSON.stringify(meta));
    const check = await Editor.Message.request('asset-db', 'query-asset-meta', url(target));
    if (check?.userData?.bundleName !== definition.id || !check.userData.isBundle) throw Error('资源包属性保存失败');
}
async function createModule(args) {
    const id = validId(args.id),
        directory = inside(`assets/game/modules/${id}`);
    if (await Editor.Message.request('asset-db', 'query-asset-info', url(directory))) throw Error(`模块已存在：${id}`);
    await ensureFolder(directory);
    await ensureFolder(path.join(directory, 'code'));
    await ensureFolder(path.join(directory, 'generated'));
    const manifest = {
        id,
        displayName: args.displayName || id,
        dependencies: [],
        bundles: args.codeOnly ? {} : { default: { id: `m-${id}`, root: 'res' } },
        assets: {},
        views: {},
        audio: {},
    };
    await saveJson(path.join(directory, 'module.json'), manifest);
    if (manifest.bundles.default) await bundleFolder(directory, manifest.bundles.default);
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
    return { id, directory: rel(directory) };
}
async function createBundle(args) {
    const { directory, manifest } = await moduleInfo(args.module),
        group = args.id === 'default' ? 'default' : validId(args.id);
    if (manifest.bundles[group]) throw Error('资源包已存在');
    const definition =
        group === 'default'
            ? { id: `m-${manifest.id}`, root: 'res' }
            : { id: `${manifest.id}-${group}`, root: `bundles/${group}` };
    await bundleFolder(directory, definition);
    manifest.bundles[group] = definition;
    await saveJson(path.join(directory, 'module.json'), manifest);
    return definition;
}
async function createScript(args) {
    const { directory, manifest } = await moduleInfo(args.module),
        id = validId(args.id),
        type = pascal(id);
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
function bindingSource(module, className, fields, directory) {
    const framework = path.relative(directory, inside('assets/framework')).replaceAll('\\', '/');
    const types = [...new Set(fields.map((field) => field.type))];
    const declarations = fields
        .map(
            (field) =>
                `  @property({ type: ${field.type}, visible: false })\n  private ${field.field}: ${field.type} | null = null;\n  protected get ${field.name}(): ${field.type} { return this.requireBinding(this.${field.field}, ${JSON.stringify(field.nodeName)}); }`,
        )
        .join('\n');
    return `// Generated by YZForge. Regeneration never modifies the business View.\nimport { _decorator${types.length ? ', ' + types.join(', ') : ''} } from 'cc';\nimport { UIView } from '${framework}/ui/ui-view';\nimport type { ${className}Params, ${className}Result } from '../${className}.types';\nconst { ccclass, property } = _decorator;\n@ccclass('${module}.${className}Binding')\nexport class ${className}Binding extends UIView<${className}Params, ${className}Result> {\n${declarations}\n  protected validateBindings(): void { ${fields.map((field) => `void this.${field.name};`).join(' ')} }\n}\n`;
}
async function createView(args) {
    const { directory, manifest } = await moduleInfo(args.module),
        id = validId(args.id),
        className = pascal(id);
    if (manifest.views[id]) throw Error('界面已存在');
    const group = args.bundle || 'default',
        bundle = manifest.bundles[group];
    if (!bundle) throw Error('请先创建目标资源包，再创建界面');
    const resolution = await Editor.Profile.getProject('project', 'general.designResolution');
    if (!(resolution?.width > 0 && resolution?.height > 0)) throw Error('请先在 Creator 项目设置中配置设计分辨率');
    const code = path.join(directory, 'code/ui'),
        generated = path.join(code, 'generated');
    await ensureFolder(generated);
    await ensureFolder(path.join(directory, bundle.root, 'ui'));
    const files = {
        [path.join(code, `${className}.types.ts`)]:
            `// Replace void with this view's own parameter/result contracts when needed.\nexport type ${className}Params = void;\nexport type ${className}Result = void;\n`,
        [path.join(generated, `${className}Binding.ts`)]: bindingSource(manifest.id, className, [], generated),
        [path.join(code, `${className}.ts`)]:
            `import { _decorator } from 'cc';\nimport { ${className}Binding } from './generated/${className}Binding';\nconst { ccclass } = _decorator;\n@ccclass('${manifest.id}.${className}')\nexport class ${className} extends ${className}Binding {\n  // Override onCreate / onShow / onHide / onDispose as needed.\n}\n`,
    };
    for (const [target, text] of Object.entries(files)) await writeScript('create-asset', target, text);
    await waitClass(`${manifest.id}.${className}`);
    const content = await scene('createView', `${manifest.id}.${className}`, className, {
        width: resolution.width,
        height: resolution.height,
    });
    const prefab = await Editor.Message.request(
        'asset-db',
        'create-asset',
        url(path.join(directory, bundle.root, `ui/${className}.prefab`)),
        content,
    );
    const assetId = `${manifest.id}/${group}/prefab/${id}`;
    manifest.assets[assetId] = { type: 'Prefab', uuid: prefab.uuid };
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
    const asset = manifest.assets[view.prefab];
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
function runTool(command) {
    return new Promise((resolve, reject) =>
        execFile(
            'node',
            [inside('tools/yzforge/cli.mjs'), command, '--editor'],
            { cwd: root(), windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) reject(Error(stderr || stdout || error.message));
                else {
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
    validId(args.module);
    validId(args.id);
    const target = inside(`config-source/${args.module}/${args.id}.csv`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'id,name,enabled\nint,string,bool\n,,true\n编号,名称,启用\n1,示例,true\n', {
        flag: 'wx',
    });
    return tableMapping({
        mapping: {
            id: `${args.module}.${args.id}`,
            source: rel(target),
            primaryKey: 'id',
            bundle: args.bundle || 'default',
            indexes: {},
        },
    });
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
    const { directory, manifest } = await moduleInfo(args.module),
        state = await exports.methods.state(),
        kind = args.kind || 'module';
    const nextManifest = JSON.parse(JSON.stringify(manifest));
    const refs = [],
        ids = [],
        targets = [];
    if (kind === 'module') {
        targets.push(directory);
        ids.push(manifest.id + '/');
        refs.push(
            ...state.modules
                .filter((module) => module.dependencies.includes(manifest.id))
                .map((module) => `模块 ${module.id} 依赖此模块`),
        );
        for (const table of state.tables.tables)
            if (table.id.startsWith(manifest.id + '.')) refs.push(`配置导入项 ${table.id} 仍路由到此模块`);
    } else if (kind === 'view') {
        const view = manifest.views[args.id];
        if (!view) throw Error('未找到界面');
        const registration = manifest.assets[view.prefab];
        if (!registration) throw Error('界面资源登记缺失');
        const prefab = await Editor.Message.request('asset-db', 'query-asset-info', registration.uuid);
        if (!prefab?.file) throw Error('界面 Prefab 未导入');
        const binding = inside(path.join(directory, view.binding));
        targets.push(
            inside(prefab.file),
            binding,
            binding.replace(`${path.sep}generated${path.sep}`, path.sep).replace(/Binding\.ts$/, '.ts'),
            binding.replace(`${path.sep}generated${path.sep}`, path.sep).replace(/Binding\.ts$/, '.types.ts'),
        );
        ids.push(`${manifest.id}.${args.id}`, view.prefab);
        delete nextManifest.views[args.id];
        delete nextManifest.assets[view.prefab];
        if (Object.values(nextManifest.views).some((other) => other.prefab === view.prefab))
            refs.push('其他界面也使用此 Prefab');
    } else if (kind === 'bundle') {
        if (args.id === 'default') throw Error('默认资源包随模块删除；不能单独删除');
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
        for (const id of Object.keys(nextManifest.assets))
            if (id.startsWith(`${manifest.id}/${args.id}/`)) {
                if (Object.values(nextManifest.views).some((view) => view.prefab === id))
                    refs.push(`界面仍使用资源 ${id}`);
                delete nextManifest.assets[id];
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
            if (other.id === manifest.id && (kind === 'module' || !nextManifest.assets[id])) continue;
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
    const signature = createHash('sha256')
        .update(
            JSON.stringify({
                manifest,
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
        nextManifest: kind === 'module' ? null : nextManifest,
    };
}
async function deleteModule(args) {
    const preview = await previewDelete(args);
    if (preview.references.length) throw Error('仍被引用，不能删除：\n' + preview.references.join('\n'));
    if (args.signature !== preview.signature) throw Error('文件状态已变化，请重新预览实际删除清单');
    const { directory, manifest } = await moduleInfo(args.module),
        id = await journal('delete-items', { original: rel(directory), manifest, preview });
    const archive = inside(`.yzforge/trash/${id}`);
    await fs.mkdir(archive, { recursive: true });
    const moved = [];
    try {
        for (let index = 0; index < preview.targets.length; index++) {
            const target = inside(preview.targets[index]),
                destination = inside(path.join(archive, String(index)));
            await fs.rename(target, destination);
            moved.push({ source: rel(target), archive: rel(destination) });
            try {
                await fs.rename(target + '.meta', destination + '.meta');
                moved.push({ source: rel(target + '.meta'), archive: rel(destination + '.meta') });
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        if (preview.nextManifest) await saveJson(path.join(directory, 'module.json'), preview.nextManifest);
    } catch (error) {
        for (const item of moved.reverse()) await fs.rename(inside(item.archive), inside(item.source));
        throw error;
    }
    await fs.writeFile(path.join(archive, 'moves.json'), JSON.stringify(moved, null, 2));
    await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/game/modules');
    return { archive: rel(archive), restoreId: id, files: preview.files };
}
async function restore(args) {
    if (!/^[\d]+-[\da-f-]+$/.test(args.id)) throw Error('无效恢复记录');
    const record = await read(inside(`.yzforge/editor-history/${args.id}.json`));
    if (record.action !== 'delete-items') throw Error('此记录不是回收记录');
    const archive = inside(`.yzforge/trash/${args.id}`),
        moves = await read(path.join(archive, 'moves.json'));
    const manifestPath = inside(path.join(record.original, 'module.json'));
    if (
        record.preview.nextManifest &&
        JSON.stringify(await read(manifestPath)) !== JSON.stringify(record.preview.nextManifest)
    )
        throw Error('删除后模块清单又有修改，请先合并这些改动，再恢复此记录，避免覆盖新内容');
    for (const move of moves)
        if (
            await fs.stat(inside(move.source)).then(
                () => true,
                (error) => {
                    if (error.code === 'ENOENT') return false;
                    throw error;
                },
            )
        )
            throw Error(`原位置已存在内容，不能覆盖恢复：${move.source}`);
    for (const move of moves) await fs.stat(inside(move.archive));
    const restored = [];
    try {
        for (const move of moves) {
            const target = inside(move.source);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.rename(inside(move.archive), target);
            restored.push(move);
        }
        if (record.preview.nextManifest) await saveJson(manifestPath, record.manifest);
    } catch (error) {
        for (const move of restored.reverse()) await fs.rename(inside(move.source), inside(move.archive));
        throw error;
    }
    await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/game/modules');
    return { restored: record.original };
}
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
            await fs.rename(target, path.join(archive, path.basename(target)));
            try {
                await fs.rename(target + '.meta', path.join(archive, path.basename(target) + '.meta'));
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
        return result;
    },
    previewTables: () => runTool('preview'),
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
            args.dependencies.forEach(validId);
            manifest.dependencies = args.dependencies;
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
        const result = await Editor.Message.request('asset-db', 'move-asset', source.url, url(target));
        if (result.uuid !== source.uuid) throw Error('资源移动未保留 UUID');
        await journal('move-asset', { from: source.url, to: result.url, uuid: result.uuid });
        return result;
    },
};
exports.load = function () {};
exports.unload = function () {};
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
        const modules = [];
        for (const entry of entries)
            if (entry.isDirectory()) {
                try {
                    modules.push(await read(path.join(directory, entry.name, 'module.json')));
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
        return {
            project: root(),
            modules,
            settings: await read(inside('project-settings/framework.json')),
            tables: await read(inside('config-source/tables.json')),
        };
    },
    dispatch(action, args = {}) {
        if (!Object.prototype.hasOwnProperty.call(actions, action)) return Promise.reject(Error(`未知操作：${action}`));
        const result = queue.then(() => actions[action](args));
        queue = result.catch(() => {});
        return result;
    },
};
