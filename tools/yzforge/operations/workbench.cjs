'use strict';
const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const { businessBundles } = require('../project/localization-layout.cjs');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
exports.createWorkbench = function (ctx) {
    const {
        root,
        inside,
        moduleInfo,
        writeScript,
        waitClass,
        scene,
        bindingSource,
        resolveBindingFields,
        assertBindingSceneSaved,
        bindingPlan,
        workbookTools,
        read,
        request,
    } = ctx;
    async function previewCreate(args) {
        const plan = await require('./create-plan.cjs').planCreation(ctx, args);
        const directory = inside('.yzforge/creation-plans');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, plan.signature + '.json'), JSON.stringify(plan));
        return plan;
    }
    async function create(args) {
        if (!/^[a-f0-9]{64}$/.test(args.signature)) throw Error('请先预览创建计划');
        const plan = JSON.parse(
            await fs.readFile(inside('.yzforge/creation-plans/' + args.signature + '.json'), 'utf8'),
        );
        if (digest(args.request) !== digest(plan.request)) throw Error('创建请求已变化，请重新预览');
        const result = await require('./execute-creation.cjs').executeCreation(ctx, plan);
        return { ...result, files: plan.files };
    }
    async function bindComponent(args) {
        await assertBindingSceneSaved();
        const { directory, manifest } = await moduleInfo(args.module),
            definition = manifest.components?.[args.id];
        if (!definition) throw Error('请选择已接入绑定的通用预制体');
        const settings = await read(inside('project-settings/framework.json'));
        const target = path.join(directory, definition.binding);
        const fields = await resolveBindingFields(
            await scene('scanPrefab', definition.uuid, settings.bindingPrefixes),
            path.dirname(target),
        );
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
                    bindingPlan(fields),
                );
                await assertBindingSceneSaved();
                await request('asset-db', 'save-asset', definition.uuid, result.content);
                return scene('validateBinding', definition.uuid, definition.className, settings.bindingPrefixes);
            } catch (error) {
                if (!/not compiled yet|Wait for script compilation/.test(error.message) || Date.now() > deadline)
                    throw error;
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }
    }
    async function saveWorkbook(args) {
        const tool = await workbookTools(),
            current = await tool.readWorkbook(root(), args.source);
        const { manifest } = await moduleInfo(args.config.module);
        const allowed = businessBundles(manifest);
        if (!allowed[args.config.bundle]) throw Error('请选择模块已有业务资源包');
        for (const table of args.config.tables) {
            const sheet = current.sheets.find((sheet) => sheet.name === table.sheet);
            if (!sheet || !sheet.fields.includes(table.primaryKey)) throw Error(`请选择工作表及其主键：${table.id}`);
            if (table.bundle && !allowed[table.bundle]) throw Error(`无效目标资源包：${table.bundle}`);
            for (const group of Object.values(table.shards?.targets ?? {}))
                if (group && !allowed[group]) throw Error(`无效分片目标：${group}`);
        }
        return tool.writeWorkbookConfig(root(), args.source, args.config, args.hash);
    }
    return {
        previewCreate,
        create,
        bindComponent,
        saveWorkbook,
        async ensurePresets() {
            return ctx.ensurePresets();
        },
        openBundleSettings() {
            ctx.openBundleSettings();
            return { opened: true };
        },
        async openWorkbook(args) {
            const tool = await workbookTools();
            await tool.readWorkbook(root(), args.source);
            await ctx.openFile(inside(args.source));
            return { source: args.source };
        },
    };
};
