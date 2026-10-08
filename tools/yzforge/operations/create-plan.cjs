'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const { scaffold } = require('./create-scaffolds.cjs');
const layout = require('../project/layout.cjs');
const naming = require('../project/naming.cjs');
const bindings = require('../generators/bindings.cjs');
const { formatScript } = require('../generators/format.cjs');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const reference = (step, select) => ({ $step: step, ...(select ? { select } : {}) });

async function snapshot(target) {
    try {
        const stat = await fs.stat(target);
        return stat.isDirectory()
            ? { directory: (await fs.readdir(target)).sort() }
            : {
                  hash: createHash('sha256')
                      .update(await fs.readFile(target))
                      .digest('hex'),
              };
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

/** 预览产物包含确切脚本文本、原生步骤及其结果引用；执行不再重新运行脚手架。 */
exports.planCreation = async function (ctx, input) {
    const request = clone(input);
    delete request.signature;
    const { root, inside, rel, url } = ctx;
    const steps = [],
        inputs = {},
        files = new Map(),
        planned = new Set(),
        classes = new Map();
    const scriptSources = {};
    const track = async (target) => {
        const file = rel(inside(target));
        if (!(file in inputs)) inputs[file] = await snapshot(inside(file));
        return inputs[file];
    };
    const read = async (target) => {
        await track(target);
        return JSON.parse(await fs.readFile(inside(target), 'utf8'));
    };
    const touch = async (target, mode = 'create') => {
        target = inside(target);
        const file = rel(target),
            current = await track(target);
        if (!files.has(file))
            files.set(file, {
                path: file,
                operation: current ? (mode === 'create' ? 'conflict' : 'update') : 'create',
            });
        if (file.startsWith('assets/') && !file.endsWith('.meta')) {
            const metadata = await track(target + '.meta');
            if (!files.has(file + '.meta'))
                files.set(file + '.meta', { path: file + '.meta', operation: metadata ? 'existing' : 'Creator' });
        }
        return file;
    };
    const add = (step) => {
        const index = steps.length;
        steps.push(clone(step));
        return index;
    };
    const ensureFolder = async (target) => {
        target = inside(target);
        const file = rel(target);
        if (planned.has(file)) return;
        const before = await track(target);
        if (before?.directory) return;
        if (before) throw Error('目录位置已被文件占用：' + file);
        if (file === 'assets' || file === 'config-source') {
            if (file === 'assets') throw Error('项目 assets 根目录不存在');
        } else await ensureFolder(path.dirname(target));
        await touch(target);
        files.get(file).operation = 'create-directory';
        add({ kind: 'directory', path: file });
        planned.add(file);
    };
    const write = async (target, content, mode = 'create', encoding = 'utf8', kind = 'write') => {
        await ensureFolder(path.dirname(inside(target)));
        const file = await touch(target, mode);
        const index = add({ kind, path: file, content, encoding, mode });
        planned.add(file);
        return { uuid: reference(index, 'uuid'), url: url(inside(target)), file: inside(target) };
    };
    const writeScript = async (operation, target, content) => {
        const source = ts.createSourceFile(target, content, ts.ScriptTarget.Latest, true);
        const edits = [];
        for (const node of source.statements)
            if (ts.isClassDeclaration(node)) {
                const decorator = (ts.getDecorators(node) ?? [])
                    .map((item) => item.expression)
                    .find(
                        (expression) =>
                            ts.isCallExpression(expression) &&
                            expression.arguments[0] &&
                            ts.isStringLiteral(expression.arguments[0]),
                    );
                if (!decorator) continue;
                const name = decorator.arguments[0].text,
                    signature = hash(content);
                edits.push({
                    at: node.members.pos,
                    text: `\n/** @internal 创建计划等待此版本编译完成。 */\nstatic readonly __yzforgeSourceSignature: string = '${signature}';\n`,
                });
                classes.set(name, {
                    script: rel(target),
                    signature,
                    binding: content.match(/__yzforgeBindingSignature: string = '([^']+)'/)?.[1],
                });
            }
        for (const edit of edits.sort((a, b) => b.at - a.at))
            content = content.slice(0, edit.at) + edit.text + content.slice(edit.at);
        const text = await formatScript(target, content);
        scriptSources[rel(target)] = text;
        return write(target, text, operation === 'create-asset' ? 'create' : 'update');
    };
    const moduleList = await (await import('../project/project.mjs')).modules(root());
    await track(inside('assets/game/modules'));
    for (const module of moduleList) await track(module.manifestPath);
    for (const file of [
        'project-settings/framework.json',
        'settings/v2/packages/project.json',
        'settings/v2/packages/builder.json',
        'tools/yzforge/operations/create-scaffolds.cjs',
        'tools/yzforge/operations/create-plan.cjs',
        'tools/yzforge/generators/bindings.cjs',
        'tools/yzforge/project/layout.cjs',
    ])
        await track(inside(file));
    if (request.kind === 'module') {
        request.id = naming.slug(request.id);
        request.delivery ??= 'eager';
        if (!['eager', 'bundled', 'none'].includes(request.delivery)) throw Error('无效代码交付方式');
        if (request.delivery === 'none') {
            request.codeOnly = false;
            request.dependencies = {};
        }
        request.dependencies = naming.dependencies(
            [...moduleList, { id: request.id, dependencies: {} }],
            request.id,
            request.dependencies ?? [],
        );
    } else if (!['localization', 'bundle', 'table'].includes(request.kind))
        request.id = naming.named(request.id, request.kind).id;
    else if (request.kind !== 'localization')
        request.id = request.id === 'default' ? 'default' : naming.slug(request.id);
    const moduleInfo = async (id) => {
        const module = moduleList.find((item) => item.id === id);
        if (!module) throw Error('模块不存在：' + id);
        if (module.code?.mode === 'none' && !['bundle', 'table', 'localization'].includes(request.kind))
            throw Error('纯资源模块不创建业务脚本');
        return { directory: module.directory, manifest: clone(module) };
    };
    const database = async (service, method, ...args) => {
        if (service !== 'asset-db') throw Error('计划中不支持的编辑器服务：' + service);
        if (method === 'query-asset-info') {
            const info = await ctx.request(service, method, ...args);
            if (info?.file) {
                await track(info.file);
                await track(info.file + '.meta');
            }
            return info;
        }
        if (!['create-asset', 'save-asset'].includes(method)) throw Error('计划中不支持的资源操作：' + method);
        let target = args[0];
        if (typeof target !== 'string' || !target.startsWith('db://assets/'))
            throw Error('计划资源必须使用明确的 db URL');
        target = inside(target.slice(5));
        return write(target, args[1], method === 'create-asset' ? 'create' : 'update');
    };
    const workbookTools = async () => {
        const tools = await import('../project/workbooks.mjs');
        const locale = await import('../generators/localization-workbook.mjs');
        const emit = async (source, bytes, mode = 'create') => {
            await write(inside(source), bytes.toString('base64'), mode, 'base64');
            return { source, hash: createHash('sha256').update(bytes).digest('hex') };
        };
        return {
            readWorkbook: async (_root, source) => {
                await track(inside(source));
                return tools.readWorkbook(root(), source);
            },
            createWorkbook: async (_root, source, config) => ({
                ...(await emit(source, await tools.renderWorkbook(source, config))),
                config,
            }),
            createLocalizationWorkbook: async (_root, source, locales) =>
                emit(source, await locale.renderLocalizationWorkbook(source, locales)),
            writeLocalizationWorkbook: async (_root, source, patch, expectedHash) => {
                await track(inside(source));
                return emit(
                    source,
                    (await tools.planLocalizationWorkbook(root(), source, patch, expectedHash)).bytes,
                    'update',
                );
            },
        };
    };
    const p = {
        root,
        inside,
        rel,
        url,
        modules: moduleList,
        resolution: await ctx.designResolution(),
        scriptSources,
        read,
        moduleInfo,
        ensureFolder,
        writeScript,
        workbookTools,
        request: database,
        stat: async (target) => {
            await track(target);
            return fs.stat(target);
        },
        saveJson: (target, value) =>
            write(
                target,
                path.basename(target) === 'module.json' ? layout.sourceManifest(value) : value,
                'update',
                'utf8',
                'json',
            ),
        bindingSource: (module, name, fields, directory, component, types) =>
            bindings.bindingSource(
                module,
                name,
                fields,
                path.relative(directory, inside('assets/framework')).replaceAll('\\', '/'),
                component,
                types,
            ),
        resolveBindingFields: async (fields, directory) => {
            const resolved = await ctx.resolveBindingFields(fields, directory);
            for (const field of resolved)
                if (field.imported) {
                    const script = path.resolve(directory, field.imported.module + '.ts');
                    await track(script);
                    await track(script + '.meta');
                }
            return resolved;
        },
        bindingPlan: bindings.bindingPlan,
        inspectPrefab: async (uuid, prefixes) => {
            await database('asset-db', 'query-asset-info', uuid);
            return ctx.scene('scanPrefab', uuid, prefixes);
        },
        assertBindingSceneSaved: ctx.assertBindingSceneSaved,
        waitClass: async (className) => {
            const source = classes.get(className);
            if (!source) throw Error('编译步骤没有对应的计划脚本：' + className);
            add({ kind: 'compile', className, ...source, binding: classes.get(className + 'Binding')?.binding });
        },
        scene: async (method, ...args) => reference(add({ kind: 'scene', method, args })),
        bundleFolder: async (directory, definition, kind = 'resources') => {
            await ensureFolder(path.join(directory, definition.root));
            await touch(path.join(directory, definition.root) + '.meta', 'update');
            add({
                kind: 'bundle',
                path: rel(path.join(directory, definition.root)),
                id: definition.id,
                bundleKind: kind,
            });
        },
    };
    await ctx.assertBindingSceneSaved();
    const result = await scaffold(p, request);
    const plan = { request, steps, inputs, files: [...files.values()], result, resolution: p.resolution };
    return {
        ...plan,
        conflicts: plan.files.filter((file) => file.operation === 'conflict').map((file) => file.path),
        signature: hash(plan),
    };
};

exports.assertPlan = async function (ctx, plan) {
    const { signature, conflicts, ...body } = plan;
    if (hash(body) !== signature || conflicts.length) throw Error('创建计划无效或存在文件冲突');
    for (const [file, before] of Object.entries(plan.inputs))
        if (hash(await snapshot(ctx.inside(file))) !== hash(before)) throw Error('创建条件已变化，请重新预览：' + file);
    if (hash(await ctx.designResolution()) !== hash(plan.resolution)) throw Error('设计分辨率已变化，请重新预览');
    await ctx.assertBindingSceneSaved();
};
exports.resolveStepValues = function resolveValues(value, results) {
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value, '$step')) {
        const result = results[value.$step];
        if (result === undefined) throw Error('操作依赖尚未完成：' + value.$step);
        return value.select ? result[value.select] : result;
    }
    return Array.isArray(value)
        ? value.map((item) => resolveValues(item, results))
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValues(item, results)]));
};
