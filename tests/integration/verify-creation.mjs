// Inject a failure after creating one owned test asset; use the real workbench to preview and roll it back.
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const editor = async (code, args = {}, safety_checks = true) =>
    (await call('execute_javascript', { context: 'editor', code, args, safety_checks })).data;
const action = (name, input) =>
    editor('return await Editor.Message.request("yzforge-editor", "dispatch", args.name, args.input);', {
        name,
        input,
    });
const preview = await action('previewCreate', {
    kind: 'service',
    module: 'lobby',
    id: 'RecoveryProbe' + Date.now(),
});
assert.deepEqual(preview.conflicts, []);
const file = preview.files.find((file) => file.operation === 'create' && file.path.endsWith('Service.ts'))?.path;
assert.ok(file?.startsWith('assets/game/modules/lobby/code/services/RecoveryProbe'));
const captured = await editor(
    String.raw`return await (async () => {
    const path = require('path');
    const root = Editor.Project.path;
    const inside = file => {
        const target = path.resolve(root, file), local = path.relative(root, target);
        if(path.isAbsolute(local) || local === '..' || local.startsWith('..' + path.sep)) throw Error('Outside project');
        return target;
    };
    const history = require(path.join(root, 'extensions/yzforge-editor/creation.js')).createCreationHistory({inside});
    const url = 'db://' + args.file;
    if(await Editor.Message.request('asset-db', 'query-asset-info', url)) throw Error('Fixture already exists');
    const source = 'export const recoveryProbe = true;\n';
    let failure;
    try {
        await history.run(args.preview, async () => {
            await Editor.Message.request('asset-db', 'create-asset', url, source);
            const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
            if(!info?.uuid) throw Error('Fixture was not imported');
            throw Error('INTEGRATION_INJECTED_FAILURE');
        });
    } catch(error) { failure = error.message; }
    const records = await history.list();
    const record = records.find(record => record.request.id === args.preview.request.id);
    return {failure, record, source, url};
})();`,
    { preview, file },
    false,
); // Reviewed path guard contains '..', rejected by the MCP literal-only safety check.
assert.match(captured.failure, /INTEGRATION_INJECTED_FAILURE/);
assert.equal(captured.record.stage, 'failed');
const save = (content) =>
    editor('await Editor.Message.request("asset-db", "save-asset", args.url, args.content); return true;', {
        url: captured.url,
        content,
    });
await save(captured.source + '// A later edit must stop rollback.\n');
const conflict = await action('previewCreationRollback', { id: captured.record.id });
assert.ok(conflict.conflicts.some((item) => item.includes(file)));
await save(captured.source);
const rollback = await action('previewCreationRollback', { id: captured.record.id });
assert.deepEqual(rollback.conflicts, []);
assert.deepEqual(rollback.references, []);
const result = await action('rollbackCreation', rollback);
assert.equal(result.stage, 'rolled-back');
assert.ok(!result.generationError, result.generationError);
const readback = await editor(
    `return await (async () => {
    const nodeFs = require('fs'), nodePath = require('path');
    const info = await Editor.Message.request('asset-db', 'query-asset-info', args.url);
    const state = await Editor.Message.request('yzforge-editor', 'state');
    return {exists:!!info,meta:nodeFs.existsSync(nodePath.join(Editor.Project.path,args.file + '.meta')),
        pending:state.creations.some(record=>record.id===args.id)};
})();`,
    { url: captured.url, file, id: captured.record.id },
);
assert.deepEqual(readback, { exists: false, meta: false, pending: false });
console.log(
    JSON.stringify({
        ok: true,
        creationId: captured.record.id,
        checked: ['failure-record', 'later-edit-conflict', 'Creator-rollback', 'metadata-removal', 'generation'],
    }),
);
