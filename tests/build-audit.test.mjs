import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import audit from '../tools/yzforge/build-audit.cjs';
test('允许业务引用默认语言和同语言共享，拒绝业务引用其他语言和语言之间交叉依赖', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-language-graph-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'project-settings/generated'), { recursive: true });
    await writeFile(
        join(root, 'project-settings/generated/localization.json'),
        JSON.stringify({
            defaultLocale: 'zh-CN',
            bundles: {
                shop: {
                    namespace: 'shop/default',
                    catalogs: { en: { bundle: 'shop-en' }, 'zh-CN': { bundle: 'shop-zh' } },
                },
                common: { namespace: 'common/default', catalogs: { en: { bundle: 'common-en' } } },
            },
        }),
    );
    const save = async (name, deps) => {
        await mkdir(join(root, 'output', name), { recursive: true });
        await writeFile(join(root, 'output', name, 'config.json'), JSON.stringify({ name, deps }));
    };
    for (const name of ['shop', 'shop-zh', 'common', 'common-en']) await save(name, []);
    await save('shop-en', ['common-en']);
    await save('shop', ['shop-zh']);
    assert.deepEqual((await audit.auditProjectBuild(root, join(root, 'output'), 'web-mobile')).problems, []);
    await save('shop', ['common-en']);
    await save('shop-en', ['shop-zh']);
    const result = await audit.auditProjectBuild(root, join(root, 'output'), 'web-mobile');
    assert.ok(result.problems.some((problem) => problem.includes('shop → common-en')));
    assert.ok(result.problems.some((problem) => problem.includes('shop-en → shop-zh')));
});
test('build audit measures actual output groups, duplicate bytes and configured budgets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-build-audit-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    try {
        await mkdir(join(root, 'subpackages/data'), { recursive: true });
        await mkdir(join(root, 'remote'), { recursive: true });
        await writeFile(join(root, 'game.json'), JSON.stringify({ subpackages: [{ root: 'subpackages/data' }] }));
        await writeFile(
            join(root, 'subpackages/data/config.json'),
            JSON.stringify({ name: 'data', deps: ['internal'] }),
        );
        await writeFile(join(root, 'main.bin'), Buffer.alloc(2048, 1));
        await writeFile(join(root, 'subpackages/data/copy.bin'), Buffer.alloc(2048, 1));
        await writeFile(join(root, 'remote/texture.bin'), Buffer.alloc(1024, 2));
        const report = await audit.auditBuild(root, { maxLocalRootBytes: 2000, maxDuplicateBytes: 0 });
        assert.equal(report.measurement, 'uncompressed-output-bytes');
        assert.equal(report.groups.remote, 1024);
        assert.ok(report.groups['subpackages/data'] > 2048);
        assert.equal(report.duplicateBytes, 2048);
        assert.equal(report.problems.length, 2);
        assert.deepEqual(report.bundleDependencies[0].dependencies, ['internal']);
        await mkdir(join(root, 'project-settings'));
        await writeFile(
            join(root, 'project-settings/build-budgets.json'),
            JSON.stringify({
                default: { maxDuplicateBytes: 0 },
                platforms: { wechatgame: { maxDuplicateBytes: 4096 } },
            }),
        );
        const platformReport = await audit.auditProjectBuild(root, root, 'wechatgame');
        assert.deepEqual(platformReport.problems, []);
        assert.equal((await audit.auditProjectBuild(root, root, 'web-mobile')).problems.length, 1);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('语言构建审计核对专用包存在性与实际的传递依赖', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-language-build-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    try {
        await mkdir(join(root, 'project-settings/generated'), { recursive: true });
        await mkdir(join(root, 'output/base'), { recursive: true });
        await mkdir(join(root, 'output/bridge'), { recursive: true });
        await writeFile(
            join(root, 'project-settings/generated/localization.json'),
            JSON.stringify({
                bundles: { base: { namespace: 'shop/default', catalogs: { en: { bundle: 'lang-en' } } } },
            }),
        );
        await writeFile(join(root, 'output/base/config.json'), JSON.stringify({ name: 'base', deps: ['bridge'] }));
        await writeFile(join(root, 'output/bridge/config.json'), JSON.stringify({ name: 'bridge', deps: ['lang-en'] }));
        const missing = await audit.auditProjectBuild(root, join(root, 'output'), 'web-mobile');
        assert.equal(missing.problems.length, 3);
        assert.ok(missing.problems.some((problem) => problem.includes('缺少语言资源包')));
        assert.ok(missing.problems.some((problem) => problem.includes('静态依赖')));
        await mkdir(join(root, 'output/english'));
        await writeFile(join(root, 'output/english/config.json'), JSON.stringify({ name: 'lang-en', deps: [] }));
        await writeFile(join(root, 'output/base/config.json'), JSON.stringify({ name: 'base', deps: [] }));
        await writeFile(join(root, 'output/bridge/config.json'), JSON.stringify({ name: 'bridge', deps: [] }));
        assert.deepEqual((await audit.auditProjectBuild(root, join(root, 'output'), 'web-mobile')).problems, []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
