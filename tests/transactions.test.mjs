import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { writeBatch, pendingTransactions, previewTransaction, recoverTransaction } from '../tools/yzforge/project.mjs';

test('generation recovery restores only its own outputs and refuses changed previews', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-journal-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    try {
        const id = '1790000000000-abcd',
            base = join(root, '.yzforge/changes', id);
        await mkdir(base, { recursive: true });
        await writeFile(join(root, 'one.ts'), 'generated');
        await writeFile(join(root, 'two.ts'), 'old two');
        await writeFile(
            join(base, 'transaction.json'),
            JSON.stringify({
                formatVersion: 2,
                id,
                status: 'prepared',
                entries: [
                    { path: 'one.ts', previous: 'old one', content: 'generated' },
                    { path: 'two.ts', previous: 'old two', content: 'new two' },
                ],
            }),
        );
        assert.equal((await pendingTransactions(root)).length, 1);
        const original = await previewTransaction(root, id);
        await writeFile(join(root, 'one.ts'), 'user change');
        await assert.rejects(recoverTransaction(root, original), /条件变化|用户修改/);
        assert.equal(await readFile(join(root, 'one.ts'), 'utf8'), 'user change');
        await writeFile(join(root, 'one.ts'), 'generated');
        const lock = join(root, '.yzforge/generation.lock');
        const lockOwner = JSON.stringify({ pid: process.pid });
        await writeFile(lock, lockOwner);
        await assert.rejects(recoverTransaction(root, await previewTransaction(root, id)), /仍在运行/);
        assert.equal(await readFile(lock, 'utf8'), lockOwner);
        await unlink(lock);
        await recoverTransaction(root, await previewTransaction(root, id));
        assert.equal(await readFile(join(root, 'one.ts'), 'utf8'), 'old one');
        assert.equal(await readFile(join(root, 'two.ts'), 'utf8'), 'old two');
        assert.equal((await pendingTransactions(root)).length, 0);
        await writeBatch(root, { 'one.ts': 'ready', 'three.ts': 'third' });
        assert.equal(await readFile(join(root, 'three.ts'), 'utf8'), 'third');
        assert.equal((await pendingTransactions(root)).length, 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
