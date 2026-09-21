'use strict';
const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const naming = require('../../tools/yzforge/naming.cjs');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
exports.createWorkbench = function (ctx) {
    const {
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
    } = ctx;
    async function previewCreate(args) {
        const request = { ...args };
        delete request.signature;
        const kind = request.kind;
        const paths = [],
            updates = [],
            folders = [];
        let manifest;
        const add = (value) => paths.push(value);
        if (kind === 'module') {
            request.id = naming.slug(request.id);
            const prefix = `assets/game/modules/${request.id}`,
                type = naming.named(request.id, 'component').className.replace(/Component$/, '');
            folders.push(prefix, `${prefix}/code`, `${prefix}/code/generated`, `${prefix}/contracts`);
            add(`${prefix}/module.json`);
            add(`${prefix}/public.ts`);
            add(`${prefix}/code/${type}Module.ts`);
            if (request.delivery !== 'eager') {
                add(`${prefix}/code/${type}ModuleEntry.ts`);
                add(`${prefix}/code/entry.prefab`);
            }
            if (!request.codeOnly)
                folders.push(
                    `${prefix}/bundles`,
                    `${prefix}/bundles/default`,
                    `${prefix}/bundles/default/dynamic`,
                    `${prefix}/bundles/default/static`,
                );
            const state = await ctx.state();
            request.dependencies = naming.dependencies(
                [...state.modules, { id: request.id, dependencies: [] }],
                request.id,
                request.dependencies ?? [],
            );
        } else {
            ({ manifest } = await moduleInfo(request.module));
            const prefix = `assets/game/modules/${manifest.id}`;
            if (kind === 'bundle') {
                request.id = request.id === 'default' ? 'default' : naming.slug(request.id);
                if (manifest.bundles[request.id]) throw Error('资源包已存在');
                folders.push(
                    `${prefix}/bundles/${request.id}`,
                    `${prefix}/bundles/${request.id}/dynamic`,
                    `${prefix}/bundles/${request.id}/static`,
                );
                updates.push(`${prefix}/module.json`);
            } else if (kind === 'table') {
                request.id = naming.slug(request.id);
                if (!manifest.bundles[request.bundle]) throw Error('请选择已有资源包');
                add(`config-source/${manifest.id}/${request.id}.xlsx`);
                updates.push(
                    `${prefix}/${manifest.bundles[request.bundle].root}/dynamic/config/${request.id}.json`,
                    `${prefix}/code/generated/config/${naming.named(request.id, 'component').className.replace(/Component$/, '')}.table.ts`,
                );
            } else {
                const named = naming.named(request.id, kind);
                request.id = named.id;
                if (['service', 'component'].includes(kind))
                    add(`${prefix}/code/${kind === 'service' ? 'services' : 'components'}/${named.className}.ts`);
                else {
                    const bundle = manifest.bundles[request.bundle];
                    if (!bundle) throw Error('请选择已有资源包');
                    const generic = ['part', 'prefab'].includes(kind),
                        code = `${prefix}/code/${generic ? 'components' : 'ui'}`;
                    const className =
                        kind === 'prefab'
                            ? naming.named(request.id.replace(/-prefab$/, ''), 'component').className
                            : named.className;
                    add(`${code}/${className}.ts`);
                    add(`${code}/generated/${className}Binding.ts`);
                    if (!generic) add(`${code}/${className}.types.ts`);
                    if (!generic && request.presenter) add(`${code}/${className}Presenter.ts`);
                    if (request.prefabUUID) {
                        const info = await Editor.Message.request('asset-db', 'query-asset-info', request.prefabUUID);
                        if (
                            info?.importer !== 'prefab' ||
                            !Object.values(manifest.bundles).some((bundle) =>
                                info.url.startsWith(`db://${prefix}/${bundle.root}/`),
                            )
                        )
                            throw Error('请选择当前模块已有的预制体');
                        updates.push(rel(info.file));
                    } else
                        add(
                            `${prefix}/${bundle.root}/${manifest.layoutVersion === 2 ? 'dynamic/' : ''}${generic ? 'prefabs' : 'ui'}/${named.className}.prefab`,
                        );
                    updates.push(`${prefix}/module.json`);
                }
            }
        }
        // Include every generator-owned output and missing parent/meta file in the review.
        const ledger = await fs
            .readFile(inside('project-settings/generated/generated-files.json'), 'utf8')
            .then(JSON.parse, (error) => {
                if (error.code === 'ENOENT') return {};
                throw error;
            });
        const prefix = 'assets/game/modules/' + (kind === 'module' ? request.id : manifest.id);
        const generated = new Set(
            Object.keys(ledger).filter(
                (file) =>
                    file.startsWith(prefix + '/') ||
                    file.startsWith('assets/game/app/generated/') ||
                    file.startsWith('project-settings/generated/'),
            ),
        );
        const generatedRoot =
            prefix + '/' + (kind === 'module' || manifest.layoutVersion === 2 ? 'contracts/' : '') + 'generated';
        for (const name of ['views.ts', 'bundles.ts']) generated.add(generatedRoot + '/' + name);
        const groups =
            kind === 'module' ? (request.codeOnly ? [] : ['default']) : kind === 'bundle' ? [request.id] : [];
        for (const group of groups) {
            generated.add(generatedRoot + '/resources-' + group + '.ts');
            generated.add(prefix + '/bundles/' + group + '/yz-index.json');
        }
        if (kind === 'table') {
            const type = naming.named(request.id, 'component').className.replace(/Component$/, '');
            for (const file of [type + '.table.ts', type + '.types.ts', 'tables.ts'])
                generated.add(prefix + '/code/generated/config/' + file);
        }
        for (const name of ['assembly.ts', 'release.ts', 'options.ts'])
            generated.add('assets/game/app/generated/' + name);
        generated.add('project-settings/generated/generated-files.json');
        generated.add('project-settings/generated/resource-identities.json');
        for (const file of generated) if (!paths.includes(file) && !updates.includes(file)) updates.push(file);
        if (['module', 'bundle'].includes(kind)) updates.push('settings/v2/packages/builder.json');
        for (const file of [...paths, ...updates]) {
            let parent = path.posix.dirname(file);
            while (parent.startsWith('assets/') || parent.startsWith('config-source/')) {
                const exists = await fs.stat(inside(parent)).then(
                    () => true,
                    (error) => {
                        if (error.code === 'ENOENT') return false;
                        throw error;
                    },
                );
                if (exists) break;
                if (!folders.includes(parent)) folders.push(parent);
                parent = path.posix.dirname(parent);
            }
        }
        const files = [];
        for (const file of [...folders, ...paths]) {
            const exists = await fs.stat(inside(file)).then(
                () => true,
                (error) => {
                    if (error.code === 'ENOENT') return false;
                    throw error;
                },
            );
            files.push({
                path: file,
                operation: exists ? 'conflict' : folders.includes(file) ? 'create-directory' : 'create',
            });
            if (file.startsWith('assets/'))
                files.push({ path: file + '.meta', operation: exists ? 'existing' : 'Creator' });
        }
        const changed = [];
        for (const file of updates) {
            const content = await fs.readFile(inside(file)).catch((error) => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            files.push({
                path: file,
                operation: content ? (generated.has(file) ? 'regenerate-if-changed' : 'update') : 'generate',
            });
            if (
                file.startsWith('assets/') &&
                !(await fs.stat(inside(file + '.meta')).then(
                    () => true,
                    (error) => {
                        if (error.code === 'ENOENT') return false;
                        throw error;
                    },
                ))
            )
                files.push({ path: file + '.meta', operation: 'Creator' });
            changed.push([file, content?.toString('base64')]);
        }
        const conflicts = files.filter((file) => file.operation === 'conflict').map((file) => file.path);
        return { request, files, conflicts, signature: digest({ request, files, manifest, changed }) };
    }
    async function create(args) {
        const preview = await previewCreate(args.request);
        if (args.signature !== preview.signature) throw Error('创建条件已变化，请重新预览');
        if (preview.conflicts.length) throw Error('文件已存在：\n' + preview.conflicts.join('\n'));
        const request = preview.request,
            kind = request.kind;
        const method =
            kind === 'module'
                ? 'createModule'
                : kind === 'bundle'
                  ? 'createBundle'
                  : kind === 'table'
                    ? 'createTableTemplate'
                    : ['service', 'component'].includes(kind)
                      ? 'createScript'
                      : ['part', 'prefab'].includes(kind)
                        ? 'createPrefab'
                        : 'createView';
        const result = await ctx.actions()[method](request);
        return { ...result, files: preview.files };
    }
    async function createPrefab(args) {
        const { directory, manifest } = await moduleInfo(args.module),
            bundle = manifest.bundles[args.bundle];
        if (!bundle) throw Error('请选择已有资源包');
        const named = naming.named(args.id, args.kind),
            className =
                args.kind === 'prefab'
                    ? naming.named(named.id.replace(/-prefab$/, ''), 'component').className
                    : named.className;
        const code = path.join(directory, 'code/components'),
            generated = path.join(code, 'generated');
        await ensureFolder(generated);
        const binding = path.join(generated, `${className}Binding.ts`);
        await writeScript('create-asset', binding, bindingSource(manifest.id, className, [], generated, true));
        await writeScript(
            'create-asset',
            path.join(code, `${className}.ts`),
            `import { _decorator } from 'cc';\nimport { ${className}Binding } from './generated/${className}Binding';\nconst { ccclass } = _decorator;\n@ccclass('${manifest.id}.${className}')\nexport class ${className} extends ${className}Binding {\n    protected onInit(): void {}\n    // onActivate / onDeactivate / onDispose belong to the framework.\n}\n`,
        );
        await waitClass(`${manifest.id}.${className}`);
        let info;
        if (args.prefabUUID) {
            info = await Editor.Message.request('asset-db', 'query-asset-info', args.prefabUUID);
            if (
                info?.importer !== 'prefab' ||
                !Object.values(manifest.bundles).some((bundle) =>
                    info.url.startsWith(url(path.join(directory, bundle.root)) + '/'),
                )
            )
                throw Error('请选择当前模块的已有预制体');
            if (await Editor.Message.request('scene', 'query-dirty')) throw Error('请先保存正在编辑的场景或预制体');
            const content = await scene('attachComponent', info.uuid, `${manifest.id}.${className}`);
            await Editor.Message.request('asset-db', 'save-asset', info.url, content);
        } else {
            const folder = path.join(
                directory,
                bundle.root,
                manifest.layoutVersion === 2 ? 'dynamic/prefabs' : 'prefabs',
            );
            await ensureFolder(folder);
            const content = await scene(
                'createPrefab',
                `${manifest.id}.${className}`,
                named.className,
                args.kind === 'part',
            );
            info = await Editor.Message.request(
                'asset-db',
                'create-asset',
                url(path.join(folder, `${named.className}.prefab`)),
                content,
            );
        }
        (manifest.components ??= {})[named.id] = {
            uuid: info.uuid,
            className: `${manifest.id}.${className}`,
            binding: rel(binding).slice(rel(directory).length + 1),
        };
        await saveJson(path.join(directory, 'module.json'), manifest);
        await bindComponent({ module: manifest.id, id: named.id });
        return { id: named.id, uuid: info.uuid, className: `${manifest.id}.${className}` };
    }
    async function bindComponent(args) {
        const { directory, manifest } = await moduleInfo(args.module),
            definition = manifest.components?.[args.id];
        if (!definition) throw Error('请选择已接入绑定的通用预制体');
        const settings = await read(inside('project-settings/framework.json'));
        const fields = await scene('scanPrefab', definition.uuid, settings.bindingPrefixes);
        const target = path.join(directory, definition.binding);
        await writeScript(
            'save-asset',
            target,
            bindingSource(manifest.id, definition.className.split('.').pop(), fields, path.dirname(target), true),
        );
        await waitClass(definition.className);
        const deadline = Date.now() + 15000;
        for (;;) {
            try {
                const result = await scene(
                    'bindPrefab',
                    definition.uuid,
                    definition.className,
                    settings.bindingPrefixes,
                );
                await Editor.Message.request('asset-db', 'save-asset', definition.uuid, result.content);
                return scene('validateBinding', definition.uuid, definition.className, settings.bindingPrefixes);
            } catch (error) {
                if (!error.message.includes('not compiled yet') || Date.now() > deadline) throw error;
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }
    }
    async function saveWorkbook(args) {
        const tool = await workbookTools(),
            current = await tool.readWorkbook(root(), args.source);
        const { manifest } = await moduleInfo(args.config.module);
        if (!manifest.bundles[args.config.bundle]) throw Error('请选择模块已有资源包');
        for (const table of args.config.tables) {
            const sheet = current.sheets.find((sheet) => sheet.name === table.sheet);
            if (!sheet || !sheet.fields.includes(table.primaryKey)) throw Error(`请选择工作表及其主键：${table.id}`);
            if (table.bundle && !manifest.bundles[table.bundle]) throw Error(`无效目标资源包：${table.bundle}`);
            for (const group of Object.values(table.shards?.targets ?? {}))
                if (group && !manifest.bundles[group]) throw Error(`无效分片目标：${group}`);
        }
        return tool.writeWorkbookConfig(root(), args.source, args.config, args.hash);
    }
    return {
        previewCreate,
        create,
        createPrefab,
        bindComponent,
        saveWorkbook,
        async ensurePresets() {
            return require('./bundle-config').ensurePresets();
        },
        openBundleSettings() {
            Editor.Message.send('project', 'open-settings', 'builder', 'bundle-config');
            return { opened: true };
        },
        async openWorkbook(args) {
            const tool = await workbookTools();
            await tool.readWorkbook(root(), args.source);
            require('electron').shell.openPath(inside(args.source));
            return { source: args.source };
        },
    };
};
