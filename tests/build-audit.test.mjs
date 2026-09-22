import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import audit from '../tools/yzforge/build-audit.cjs';
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
