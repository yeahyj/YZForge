'use strict';
const fs = require('node:fs/promises');
const { assertPlan, resolveStepValues } = require('./create-plan.cjs');

/** 有限的创建步骤执行器。所有原生操作从适配器注入，脚手架不在执行阶段重跑。 */
exports.executeCreation = async function (ctx, plan) {
    return ctx.creation.run(
        plan,
        async (checkpoint) => {
            const results = [];
            for (const raw of plan.steps) {
                const step = resolveStepValues(raw, results);
                if (step.kind === 'compile') {
                    await ctx.waitClass(step.className, step);
                    results.push(null);
                    continue;
                }
                if (step.kind === 'scene') {
                    if (!['createPrefab', 'createView', 'attachComponent'].includes(step.method))
                        throw Error('无效原生创建步骤');
                    await ctx.assertBindingSceneSaved();
                    results.push(await ctx.scene(step.method, ...step.args));
                    continue;
                }
                const target = ctx.inside(step.path),
                    native = step.path.startsWith('assets/');
                if (step.kind === 'bundle') {
                    // 原生导入完成后才知道目录 UUID；保留整份旧元数据并记录这一步的预期修改。
                    const meta = await ctx.request('asset-db', 'query-asset-meta', ctx.url(target));
                    if (!meta?.uuid) throw Error('资源目录尚未导入：' + step.path);
                    const next = ctx.bundleMetadata(meta, step.id, step.bundleKind);
                    const content = JSON.stringify(next, null, 2);
                    const expected = { [step.path + '.meta']: { content: Buffer.from(content).toString('base64') } };
                    results.push(
                        await checkpoint({ label: '配置资源包 ' + step.path, expected }, async () => {
                            await ctx.request('asset-db', 'save-asset-meta', ctx.url(target), content);
                            const actual = await ctx.request('asset-db', 'query-asset-meta', ctx.url(target));
                            if (JSON.stringify(actual) !== JSON.stringify(next)) throw Error('资源包属性保存失败');
                            // Creator 自行格式化元数据；读回的语义已核对，记录实际字节。
                            expected[step.path + '.meta'] = {
                                content: (await fs.readFile(target + '.meta')).toString('base64'),
                            };
                            return actual;
                        }),
                    );
                    continue;
                }
                const content =
                    step.kind === 'directory'
                        ? null
                        : step.kind === 'json'
                          ? JSON.stringify(step.content, null, 2) + '\n'
                          : step.content;
                const bytes = content === null ? null : Buffer.from(content, step.encoding);
                const expected = { [step.path]: bytes ? { content: bytes.toString('base64') } : { directory: true } };
                if (native) expected[step.path + '.meta'] = 'Creator';
                results.push(
                    await checkpoint({ label: step.kind + ' ' + step.path, expected }, async () => {
                        if (native) {
                            const info = await ctx.request('asset-db', 'query-asset-info', ctx.url(target));
                            if (step.mode === 'create' && info) throw Error('资源已存在：' + step.path);
                            await ctx.request(
                                'asset-db',
                                info ? 'save-asset' : 'create-asset',
                                ctx.url(target),
                                content,
                            );
                            const after = await ctx.request('asset-db', 'query-asset-info', ctx.url(target));
                            if (!after?.uuid || (info && info.uuid !== after.uuid))
                                throw Error('资源身份写入不一致：' + step.path);
                            return after;
                        }
                        if (!bytes) await fs.mkdir(target);
                        else await fs.writeFile(target, bytes, { flag: step.mode === 'create' ? 'wx' : 'w' });
                        return { file: target };
                    }),
                );
            }
            return resolveStepValues(plan.result, results);
        },
        () => assertPlan(ctx, plan),
    );
};
