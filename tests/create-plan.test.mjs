import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import planning from '../tools/yzforge/operations/create-plan.cjs';
import execution from '../tools/yzforge/operations/execute-creation.cjs';
import historyTools from '../tools/yzforge/operations/creation.cjs';

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-create-plan-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    t.after(() => rm(root, { recursive: true, force: true }));
    const inside = (value) => {
        const target = resolve(root, value);
        assert.ok(target === root || target.startsWith(root + sep));
        return target;
    };
    const put = async (file, content) => {
        const target = inside(file);
        await mkdir(resolve(target, '..'), { recursive: true });
        await writeFile(target, content);
    };
    await put(
        'assets/game/modules/demo/module.json',
        JSON.stringify({
            id: 'demo',
            layoutVersion: 3,
            code: { mode: 'eager' },
            dependencies: {},
            bundles: {},
            views: {},
        }),
    );
    await put('project-settings/framework.json', '{}');
    await put('.prettierrc.json', '{}');
    let serial = 0;
    const request = async (_service, method, url, content) => {
        const target = inside(url.slice(5));
        if (method === 'query-asset-info') {
            if (!(await stat(target).catch(() => null))) return null;
            const meta = JSON.parse(await readFile(target + '.meta', 'utf8').catch(() => '{"uuid":"existing"}'));
            return { uuid: meta.uuid, file: target, url };
        }
        if (method === 'create-asset' || method === 'save-asset') {
            if (content === null) await mkdir(target);
            else await writeFile(target, content);
            if (!(await stat(target + '.meta').catch(() => null)))
                await writeFile(target + '.meta', JSON.stringify({ uuid: 'created-' + ++serial }));
            return request(_service, 'query-asset-info', url);
        }
        throw Error(method);
    };
    const ctx = {
        root: () => root,
        inside,
        rel: (target) => relative(root, target).replaceAll('\\', '/'),
        url: (target) => 'db://' + relative(root, target).replaceAll('\\', '/'),
        request,
        designResolution: async () => ({ width: 720, height: 1280 }),
        assertBindingSceneSaved: async () => {},
    };
    ctx.creation = historyTools.createCreationTracker(ctx);
    return { root, ctx, put };
}

test('执行消费预览中的具体文本，输入改变先拒绝，不能重新生成一套步骤', async (t) => {
    const { ctx, put } = await fixture(t);
    const input = { kind: 'service', module: 'demo', id: 'Inventory' };
    const plan = await planning.planCreation(ctx, input);
    const source = plan.steps.find((step) => step.path?.endsWith('InventoryService.ts'));
    assert.ok(source.content.includes('class InventoryService'));
    assert.equal(await stat(ctx.inside(source.path)).catch(() => null), null);
    await put('project-settings/framework.json', '{"changed":true}');
    await assert.rejects(execution.executeCreation(ctx, plan), /重新预览/);
    assert.equal(await stat(ctx.inside(source.path)).catch(() => null), null);
    const next = await planning.planCreation(ctx, input);
    await execution.executeCreation(ctx, next);
    assert.equal(await readFile(ctx.inside(source.path), 'utf8'), source.content);
    const tampered = structuredClone(next);
    tampered.steps.find((step) => step.path?.endsWith('InventoryService.ts')).content += '\n// changed';
    await assert.rejects(execution.executeCreation(ctx, tampered), /计划无效/);
});

test('进程在写入后直接退出，仍可检查和清理；后续编辑会阻止清理', async (t) => {
    const { root, ctx, put } = await fixture(t);
    await put('source.txt', 'before');
    const module = resolve('tools/yzforge/operations/creation.cjs');
    const script = `const fs=require('node:fs/promises'),path=require('node:path'); const tracker=require(${JSON.stringify(module)}).createCreationTracker({inside:file=>path.join(${JSON.stringify(root)},file)}); tracker.run({request:{kind:'service'},files:[{path:'source.txt'}]},checkpoint=>checkpoint({label:'write',expected:{'source.txt':{content:Buffer.from('planned').toString('base64')}}},async()=>{await fs.writeFile(path.join(${JSON.stringify(root)},'source.txt'),'planned');process.exit(17);}));`;
    assert.throws(
        () => execFileSync(process.execPath, ['-e', script]),
        (error) => error.status === 17,
    );
    const [record] = await ctx.creation.list();
    assert.equal(record.stage, 'creating');
    assert.equal(record.busy, false);
    await put('source.txt', 'later edit');
    const blocked = await ctx.creation.previewCleanup({ id: record.id });
    assert.ok(blocked.conflicts.length);
    await assert.rejects(ctx.creation.cleanup(blocked), /不一致/);
    assert.equal(await readFile(ctx.inside('source.txt'), 'utf8'), 'later edit');
    await put('source.txt', 'planned');
    const preview = await ctx.creation.previewCleanup({ id: record.id });
    assert.deepEqual(preview.conflicts, []);
    await ctx.creation.cleanup(preview);
    assert.equal(await readFile(ctx.inside('source.txt'), 'utf8'), 'before');
    assert.equal(await stat(ctx.inside('.yzforge/generation.lock')).catch(() => null), null);
});

test('各种交付模式均在源文件和原生绑定步骤之后最后登记模块', async (t) => {
    const { ctx } = await fixture(t);
    for (const delivery of ['none', 'eager', 'bundled']) {
        const plan = await planning.planCreation(ctx, { kind: 'module', id: 'new-' + delivery, delivery });
        assert.deepEqual(plan.conflicts, []);
        const registration = plan.steps.filter((step) => step.path?.endsWith('/module.json'));
        assert.equal(registration.length, 1);
        assert.equal(plan.steps.at(-1), registration[0]);
        assert.ok(plan.steps.some((step) => step.path?.endsWith('/public.ts')));
        if (delivery === 'bundled') assert.ok(plan.steps.some((step) => step.kind === 'scene'));
    }
});

test('清理写回后进程直接退出，重启可接管失效锁并完成记录', async (t) => {
    const { root, ctx, put } = await fixture(t);
    await put('source.txt', 'before');
    await assert.rejects(
        ctx.creation.run({ request: { kind: 'service' }, files: [{ path: 'source.txt' }] }, async (checkpoint) => {
            await checkpoint(
                { label: 'source', expected: { 'source.txt': { content: Buffer.from('after').toString('base64') } } },
                () => put('source.txt', 'after'),
            );
            throw Error('source failure');
        }),
    );
    const [record] = await ctx.creation.list();
    const module = resolve('tools/yzforge/operations/creation.cjs');
    const script = `const fs=require('node:fs/promises'),path=require('node:path'); const root=${JSON.stringify(root)}; const write=fs.writeFile; fs.writeFile=async(file,...args)=>{await write(file,...args);if(file===path.join(root,'source.txt'))process.exit(18);}; const tracker=require(${JSON.stringify(module)}).createCreationTracker({inside:file=>path.join(root,file)}); (async()=>{await tracker.cleanup(await tracker.previewCleanup({id:${JSON.stringify(record.id)}}));})().catch(error=>{console.error(error);process.exit(1);});`;
    assert.throws(
        () => execFileSync(process.execPath, ['-e', script]),
        (error) => error.status === 18,
    );
    const [interrupted] = await ctx.creation.list();
    assert.equal(interrupted.stage, 'cleaning');
    assert.equal(interrupted.busy, false);
    assert.equal(await readFile(ctx.inside('source.txt'), 'utf8'), 'before');
    const preview = await ctx.creation.previewCleanup({ id: record.id });
    assert.deepEqual(preview.changes, []);
    await ctx.creation.cleanup(preview);
    assert.deepEqual(await ctx.creation.list(), []);
    for (const file of ['generation.lock', 'recovery.lock'])
        assert.equal(await stat(ctx.inside('.yzforge/' + file)).catch(() => null), null);
});
