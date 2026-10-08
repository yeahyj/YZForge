import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rmdir, rm, readdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import creation from '../tools/yzforge/operations/creation.cjs';
const bytes = (text) => ({ content: Buffer.from(text).toString('base64') });
const plan = (...files) => ({
    request: { kind: 'service', module: 'demo', id: 'test' },
    files: files.map((path) => ({ path })),
});

async function fixture(run) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-creation-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    const inside = (file) => {
        const target = resolve(root, file),
            local = relative(root, target);
        assert.ok(!isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep));
        return target;
    };
    let onMutation = async () => {},
        references = [];
    const tracker = creation.createCreationTracker({
        inside,
        url: (file) => 'db://' + relative(root, file).replaceAll('\\', '/'),
        references: async () => references,
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
            await onMutation({ method, url });
        },
    });
    const fail = async (files, execute) => {
        await assert.rejects(
            tracker.run(plan(...files), async (checkpoint) => {
                await execute(checkpoint);
                throw Error('injected creation failure');
            }),
            /创建记录/,
        );
        const [record] = await tracker.list();
        return record.id;
    };
    try {
        await run({
            inside,
            tracker,
            fail,
            afterMutation: (hook) => {
                onMutation = hook;
            },
            setReferences: (value) => {
                references = value;
            },
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test('创建成功即结束记录；后续生成失败和人工编辑不重新纳入清理', () =>
    fixture(async ({ inside, tracker }) => {
        let id;
        const result = await tracker.run(plan('source.txt'), async (checkpoint) => {
            id = (await tracker.list())[0].id;
            await checkpoint({ label: 'source', expected: { 'source.txt': bytes('created') } }, () =>
                writeFile(inside('source.txt'), 'created'),
            );
            return { source: 'source.txt' };
        });
        assert.deepEqual(result, { source: 'source.txt' });
        assert.deepEqual(await tracker.list(), []);
        assert.deepEqual(await readdir(inside('.yzforge/incomplete-creations')), []);
        await writeFile(inside('source.txt'), 'user edits after generation failure');
        await assert.rejects(tracker.previewCleanup({ id }), { code: 'ENOENT' });
        assert.equal(await readFile(inside('source.txt'), 'utf8'), 'user edits after generation failure');
    }));

test('创建中断整次恢复旧内容，使用原生接口删除新增资源和元数据', () =>
    fixture(async ({ inside, tracker, fail }) => {
        await mkdir(inside('assets/code'), { recursive: true });
        await writeFile(inside('assets/module.json'), 'before');
        const id = await fail(['assets/module.json', 'assets/code/Test.ts', 'assets/code/Test.ts.meta'], (checkpoint) =>
            checkpoint(
                {
                    label: 'sources',
                    expected: {
                        'assets/module.json': bytes('after'),
                        'assets/code/Test.ts': bytes('source'),
                        'assets/code/Test.ts.meta': 'Creator',
                    },
                },
                async () => {
                    await writeFile(inside('assets/module.json'), 'after');
                    await writeFile(inside('assets/code/Test.ts'), 'source');
                    await writeFile(inside('assets/code/Test.ts.meta'), '{"uuid":"test"}');
                },
            ),
        );
        const preview = await tracker.previewCleanup({ id });
        assert.deepEqual(preview.conflicts, []);
        await tracker.cleanup(preview);
        assert.equal(await readFile(inside('assets/module.json'), 'utf8'), 'before');
        for (const file of ['assets/code/Test.ts', 'assets/code/Test.ts.meta'])
            await assert.rejects(readFile(inside(file)), { code: 'ENOENT' });
        assert.deepEqual(await tracker.list(), []);
    }));

test('人工编辑和未认领文件阻止整次清理，不先删除无冲突的部分', () =>
    fixture(async ({ inside, tracker, fail }) => {
        const id = await fail(['source', 'source/items.xlsx', 'source/untouched.txt'], (checkpoint) =>
            checkpoint(
                { label: 'workbook', expected: { source: { directory: true }, 'source/items.xlsx': bytes('fixture') } },
                async () => {
                    await mkdir(inside('source'));
                    await writeFile(inside('source/items.xlsx'), 'fixture');
                },
            ),
        );
        // 计划内但步骤尚未触及的文件，同样不属于工具写入。
        await writeFile(inside('source/untouched.txt'), 'user created');
        await writeFile(inside('source/unrelated.txt'), 'keep');
        const preview = await tracker.previewCleanup({ id });
        assert.equal(preview.conflicts.length, 2);
        await assert.rejects(tracker.cleanup(preview), /不属于本次创建/);
        assert.equal(await readFile(inside('source/items.xlsx'), 'utf8'), 'fixture');
    }));

test('外部引用阻止整次清理，预览之后新增引用也重新检查', () =>
    fixture(async ({ inside, tracker, fail, setReferences }) => {
        const id = await fail(['source.txt'], (checkpoint) =>
            checkpoint({ label: 'source', expected: { 'source.txt': bytes('created') } }, () =>
                writeFile(inside('source.txt'), 'created'),
            ),
        );
        const preview = await tracker.previewCleanup({ id });
        setReferences(['external.ts → source.txt']);
        await assert.rejects(tracker.cleanup(preview), /清理条件已变化/);
        const blocked = await tracker.previewCleanup({ id });
        await assert.rejects(tracker.cleanup(blocked), /external.ts/);
        assert.equal(await readFile(inside('source.txt'), 'utf8'), 'created');
    }));

test('未知原生身份不能因源码内容匹配就被认领为可删除资产', () =>
    fixture(async ({ inside, tracker }) => {
        await mkdir(inside('assets'));
        await assert.rejects(
            tracker.run(plan('assets/a.ts', 'assets/a.ts.meta'), (checkpoint) =>
                checkpoint(
                    { label: 'native', expected: { 'assets/a.ts': bytes('created'), 'assets/a.ts.meta': 'Creator' } },
                    async () => {
                        await writeFile(inside('assets/a.ts'), 'created');
                        await writeFile(inside('assets/a.ts.meta'), '{"uuid":"unconfirmed"}');
                        throw Error('native identity readback failed');
                    },
                ),
            ),
        );
        const [record] = await tracker.list();
        const preview = await tracker.previewCleanup(record);
        assert.ok(preview.conflicts.some((value) => value.includes('元数据结果未确认')));
        await assert.rejects(tracker.cleanup(preview), /元数据结果未确认/);
        assert.equal(await readFile(inside('assets/a.ts'), 'utf8'), 'created');
    }));

test('正在运行的创建不可清理，预检失败不创建残留记录', () =>
    fixture(async ({ inside, tracker }) => {
        await assert.rejects(
            tracker.run(
                plan(),
                async () => {},
                async () => {
                    throw Error('stale preview');
                },
            ),
            /stale preview/,
        );
        assert.deepEqual(await tracker.list(), []);
        await tracker.run(plan(), async () => {
            const [record] = await tracker.list();
            assert.equal(record.busy, true);
            await assert.rejects(tracker.previewCleanup(record), /仍在运行/);
            await assert.rejects(tracker.cleanup(record), /仍在运行/);
            assert.ok(await readFile(inside('.yzforge/generation.lock')));
        });
        assert.deepEqual(await tracker.list(), []);
    }));

test('清理逐个写回前复核，操作中的编辑不被覆盖，修复冲突后可继续', () =>
    fixture(async ({ inside, tracker, fail, afterMutation }) => {
        await mkdir(inside('assets'));
        for (const file of ['a.txt', 'b.txt']) await writeFile(inside('assets/' + file), 'before');
        const id = await fail(['assets/a.txt', 'assets/b.txt'], (checkpoint) =>
            checkpoint(
                { label: 'sources', expected: { 'assets/a.txt': bytes('after'), 'assets/b.txt': bytes('after') } },
                async () => {
                    for (const file of ['a.txt', 'b.txt']) await writeFile(inside('assets/' + file), 'after');
                },
            ),
        );
        const preview = await tracker.previewCleanup({ id });
        afterMutation(async ({ url }) => {
            if (url.endsWith('/a.txt')) await writeFile(inside('assets/b.txt'), 'edited during cleanup');
        });
        await assert.rejects(tracker.cleanup(preview), /清理期间文件被修改/);
        assert.equal(await readFile(inside('assets/a.txt'), 'utf8'), 'before');
        assert.equal(await readFile(inside('assets/b.txt'), 'utf8'), 'edited during cleanup');
        await writeFile(inside('assets/b.txt'), 'after');
        afterMutation(async () => {});
        await tracker.cleanup(await tracker.previewCleanup({ id }));
        assert.equal(await readFile(inside('assets/b.txt'), 'utf8'), 'before');
        assert.deepEqual(await tracker.list(), []);
    }));

test('原生删除已完成但响应丢失，下一次清理跳过已清理文件', () =>
    fixture(async ({ inside, tracker, fail, afterMutation }) => {
        await mkdir(inside('assets'));
        const id = await fail(['assets/a.txt', 'assets/a.txt.meta'], (checkpoint) =>
            checkpoint(
                { label: 'asset', expected: { 'assets/a.txt': bytes('created'), 'assets/a.txt.meta': 'Creator' } },
                async () => {
                    await writeFile(inside('assets/a.txt'), 'created');
                    await writeFile(inside('assets/a.txt.meta'), '{"uuid":"a"}');
                },
            ),
        );
        afterMutation(async () => {
            throw Error('lost response');
        });
        await assert.rejects(tracker.cleanup(await tracker.previewCleanup({ id })), /lost response/);
        const remaining = await tracker.previewCleanup({ id });
        assert.deepEqual(remaining.changes, []);
        afterMutation(async () => {});
        await tracker.cleanup(remaining);
        assert.deepEqual(await tracker.list(), []);
    }));

test('原生删除只移除了资源、元数据仍在时，先阻止整次清理', () =>
    fixture(async ({ inside, tracker, fail }) => {
        await mkdir(inside('assets'));
        const id = await fail(['assets/a.txt', 'assets/a.txt.meta', 'keep.txt'], (checkpoint) =>
            checkpoint(
                {
                    label: 'assets',
                    expected: {
                        'assets/a.txt': bytes('created'),
                        'assets/a.txt.meta': 'Creator',
                        'keep.txt': bytes('created'),
                    },
                },
                async () => {
                    await writeFile(inside('assets/a.txt'), 'created');
                    await writeFile(inside('assets/a.txt.meta'), '{"uuid":"a"}');
                    await writeFile(inside('keep.txt'), 'created');
                },
            ),
        );
        await unlink(inside('assets/a.txt'));
        const preview = await tracker.previewCleanup({ id });
        assert.ok(preview.conflicts.some((value) => value.includes('对应资源缺失')));
        await assert.rejects(tracker.cleanup(preview), /对应资源缺失/);
        assert.equal(await readFile(inside('keep.txt'), 'utf8'), 'created');
    }));
