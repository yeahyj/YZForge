// 在 Creator 内同步语言资源改名并恢复，保留现有资源、脚本与预制体身份。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { call } from '../../tools/yzforge/mcp.mjs';
import { planLanguageRename } from '../../tools/yzforge/operations/language-rename.mjs';

const root = resolve(import.meta.dirname, '../..');
const request = { module: 'showcase', bundle: 'default', from: 'images/greeting', to: 'images/greeting-check' };
const action = async (action, input = {}) =>
    (
        await call('execute_javascript', {
            context: 'editor',
            args: { action, input },
            code: 'return await Editor.Message.request("yzforge-editor","dispatch",args.action,args.input);',
        })
    ).data;
const original = await planLanguageRename(root, request);
assert.ok(original.moves.length >= 2);
assert.ok(original.updates.some((file) => file.path.endsWith('.ts')));
assert.ok(original.updates.some((file) => file.path.endsWith('.prefab')));
for (const move of original.moves)
    await call('inspect_asset_dependencies', { target: 'db://' + move.from, limit: 100 });
let record;
try {
    const preview = await action('previewLanguageRename', request);
    assert.equal(preview.blocked, false, JSON.stringify(preview.files));
    record = await action('applyLanguageRename', { ...request, signature: preview.signature });
    assert.ok(!record.generationError, record.generationError);
    assert.equal(record.stage, 'applied');
    for (const move of original.moves) {
        const info = (
            await call('execute_javascript', {
                context: 'editor',
                args: { url: 'db://' + move.to },
                code: 'return await Editor.Message.request("asset-db","query-asset-info",args.url);',
            })
        ).data;
        assert.equal(info.uuid, move.uuid);
        await call('validate_asset_dependencies', { target: info.uuid, limit: 100 });
    }
    await action('check');
    console.log(JSON.stringify({ renamed: record.moved, references: record.updated, uuidPreserved: true }));
} finally {
    // 包括操作中断时保存的记录，均从真实编辑器状态恢复。
    if (!record) {
        const histories = await action('languageRenameHistory');
        record = histories.find((item) => Object.entries(request).every(([key, value]) => item.request[key] === value));
    }
    if (record) {
        const restored = await action('restoreLanguageRename', { id: record.id });
        assert.ok(!restored.generationError, restored.generationError);
        assert.equal(restored.stage, 'restored');
    }
}
for (const file of original.updates)
    assert.equal(await readFile(resolve(root, file.path), 'utf8'), file.before, file.path);
for (const move of original.moves)
    assert.equal(JSON.parse(await readFile(resolve(root, move.from + '.meta'), 'utf8')).uuid, move.uuid);
await action('check');
console.log(JSON.stringify({ ok: true, restored: true, files: original.moves.length + original.updates.length }));
