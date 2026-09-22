import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rmdir, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import creation from '../extensions/yzforge-editor/creation.js';

async function fixture(run) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-creation-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    const inside = (file) => {
        const target = resolve(root, file),
            local = relative(root, target);
        assert.ok(!isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep));
        return target;
    };
    const history = creation.createCreationHistory({
        inside,
        url: (file) => 'db://' + relative(root, file).replaceAll('\\', '/'),
        db: async (method, url, text) => {
            const target = inside(url.slice(5));
            if (method === 'save-asset') await writeFile(target, text);
            else if (method === 'delete-asset') {
                try {
                    await unlink(target);
                } catch (error) {
                    if (error.code !== 'EISDIR' && error.code !== 'EPERM') throw error;
                    await rmdir(target);
                }
                await unlink(target + '.meta').catch((error) => {
                    if (error.code !== 'ENOENT') throw error;
                });
            } else throw Error(method);
        },
    });
    try {
        await run({ root, inside, history });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
test('failed generation retry never absorbs user edits into creation ownership', () =>
    fixture(async ({ inside, history }) => {
        await writeFile(inside('source.txt'), 'original');
        const result = await history.run(
            { request: { kind: 'service' }, files: [{ path: 'source.txt' }] },
            async () => {
                await writeFile(inside('source.txt'), 'created');
                return {};
            },
        );
        await history.mark(result.creationId, 'generation-failed', 'first failure');
        await writeFile(inside('source.txt'), 'user edits');
        await assert.rejects(
            history.retryGeneration(result.creationId, async () => {
                throw Error('retry failed');
            }),
        );
        const preview = await history.previewRollback({ id: result.creationId });
        assert.equal(preview.conflicts.length, 1);
        await assert.rejects(history.rollback(preview), /修改/);
        assert.equal(await readFile(inside('source.txt'), 'utf8'), 'user edits');
    }));

test('failed creation can restore existing content and remove only its newly created assets', () =>
    fixture(async ({ inside, history }) => {
        await mkdir(inside('assets/code'), { recursive: true });
        await writeFile(inside('assets/module.json'), '{"old":true}');
        const plan = {
            request: { kind: 'service', module: 'demo', id: 'test' },
            files: ['assets/module.json', 'assets/code/Test.ts', 'assets/code/Test.ts.meta'].map((path) => ({ path })),
        };
        await assert.rejects(
            history.run(plan, async () => {
                await writeFile(inside('assets/module.json'), '{"old":false}');
                await writeFile(inside('assets/code/Test.ts'), 'export class Test {}');
                await writeFile(inside('assets/code/Test.ts.meta'), '{"uuid":"test"}');
                throw Error('compile failed');
            }),
            /创建记录/,
        );
        const [record] = await history.list();
        await assert.rejects(
            history.retryGeneration(record.id, async () => {}),
            /尚未完成/,
        );
        const preview = await history.previewRollback({ id: record.id });
        assert.deepEqual(preview.conflicts, []);
        await history.rollback(preview);
        assert.equal(await readFile(inside('assets/module.json'), 'utf8'), '{"old":true}');
        await assert.rejects(readFile(inside('assets/code/Test.ts')), { code: 'ENOENT' });
        await assert.rejects(readFile(inside('assets/code/Test.ts.meta')), { code: 'ENOENT' });
        assert.equal((await history.list()).length, 0);
    }));
test('rollback refuses user edits and unplanned files; generation failure has a separate retry', () =>
    fixture(async ({ inside, history }) => {
        const plan = {
            request: { kind: 'table', module: 'demo', id: 'items' },
            files: ['config-source', 'config-source/items.xlsx'].map((path) => ({ path })),
        };
        const result = await history.run(plan, async () => {
            await mkdir(inside('config-source'));
            await writeFile(inside('config-source/items.xlsx'), 'fixture');
            return {};
        });
        await history.mark(result.creationId, 'generation-failed', 'invalid schema');
        await writeFile(inside('config-source/items.xlsx'), 'user edited');
        await writeFile(inside('config-source/unrelated.txt'), 'keep');
        const preview = await history.previewRollback({ id: result.creationId });
        assert.equal(preview.conflicts.length, 2);
        await assert.rejects(history.rollback(preview), /修改/);
        let retries = 0;
        await history.retryGeneration(result.creationId, async () => {
            retries++;
        });
        assert.equal(retries, 1);
        assert.equal(await readFile(inside('config-source/unrelated.txt'), 'utf8'), 'keep');
    }));
