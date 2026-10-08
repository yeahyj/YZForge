// Exercise incomplete source cleanup and completed sources surviving generation errors through Creator.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
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
    const history = require(path.join(root, 'tools/yzforge/operations/creation.cjs')).createCreationTracker({inside});
    const url = 'db://' + args.file;
    if(await Editor.Message.request('asset-db', 'query-asset-info', url)) throw Error('Fixture already exists');
    const source = 'export const recoveryProbe = true;\n';
    let failure;
    try {
        await history.run(args.preview, async checkpoint => {
            await checkpoint({label:'native fixture', expected:{[args.file]:{content:Buffer.from(source).toString('base64')}, [args.file+'.meta']:'Creator'}},async()=>{
            await Editor.Message.request('asset-db', 'create-asset', url, source);
            const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
            if(!info?.uuid) throw Error('Fixture was not imported');
            });
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
await save(captured.source + '// A later edit must stop cleanup.\n');
const conflict = await action('previewCreationCleanup', { id: captured.record.id });
assert.ok(conflict.conflicts.some((item) => item.includes(file)));
await save(captured.source);
const cleanup = await action('previewCreationCleanup', { id: captured.record.id });
assert.deepEqual(cleanup.conflicts, []);
assert.deepEqual(cleanup.references, []);
const result = await action('cleanupCreation', cleanup);
assert.equal(result.stage, 'cleaned');
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
        checked: ['failure-record', 'later-edit-conflict', 'Creator-cleanup', 'metadata-removal', 'generation'],
    }),
);

// 未登记 module.json 的创建残留仍可按整次操作检查和清理。
const orphanId = 'creation-orphan-' + Date.now().toString(36);
const orphanPlan = await action('previewCreate', { kind: 'module', id: orphanId, delivery: 'none' });
const orphan = await editor(
    String.raw`return await (async()=>{
    const nodePath=require('path'), directory='assets/game/modules/'+args.id;
    const tracker=require(nodePath.join(Editor.Project.path,'tools/yzforge/operations/creation.cjs')).createCreationTracker({inside:file=>nodePath.join(Editor.Project.path,file)});
    try {await tracker.run(args.plan,async checkpoint=>{
        for(const [file,content] of [[directory,null],[directory+'/public.ts','export const orphanProbe=true;\n']]){
            await checkpoint({label:'orphan '+file,expected:{[file]:content===null?{directory:true}:{content:Buffer.from(content).toString('base64')},[file+'.meta']:'Creator'}},async()=>{
                const url='db://'+file;
                if(await Editor.Message.request('asset-db','query-asset-info',url))throw Error('Fixture exists');
                await Editor.Message.request('asset-db','create-asset',url,content);
                if(!(await Editor.Message.request('asset-db','query-asset-info',url))?.uuid)throw Error('Missing native identity');
            });
        }
        throw Error('INTEGRATION_BEFORE_REGISTRATION');
    });}catch(error){if(!error.message.includes('INTEGRATION_BEFORE_REGISTRATION'))throw error;}
    return (await tracker.list()).find(record=>record.request.id===args.id);
})();`,
    { id: orphanId, plan: orphanPlan },
    false,
);
// 上述原生资源路径只来自已验证的当前项目创建计划；安全检查误判拼接的 /public.ts。
assert.equal(orphan.stage, 'failed');
const orphanCleanup = await action('previewCreationCleanup', { id: orphan.id });
assert.deepEqual(orphanCleanup.conflicts, []);
assert.deepEqual(orphanCleanup.references, []);
const orphanResult = await action('cleanupCreation', orphanCleanup);
assert.ok(!orphanResult.generationError, orphanResult.generationError);
assert.equal(
    await editor('return !!await Editor.Message.request("asset-db","query-asset-info",args.url);', {
        url: 'db://assets/game/modules/' + orphanId,
    }),
    false,
);
console.log(JSON.stringify({ ok: true, unregisteredModuleCleaned: orphanId }));

// 真实 TypeScript 校验失败发生在源文件创建完成之后；修正错误后正常生成。
const moduleId = 'creation-recovery-' + Date.now().toString(36);
const errorUrl = 'db://assets/game/modules/lobby/code/services/GenerationProbe' + Date.now() + '.ts';
await editor('await Editor.Message.request("asset-db","create-asset",args.url,args.source); return true;', {
    url: errorUrl,
    source: 'export const generationProbe: number = "INTEGRATION_GENERATION_ERROR";\n',
});
const modulePlan = await action('previewCreate', { kind: 'module', id: moduleId, delivery: 'none' });
const created = await action('create', { request: modulePlan.request, signature: modulePlan.signature });
assert.match(created.generationError, /GenerationProbe/);
const retained = await editor(
    `return await (async()=>{
    const state=await Editor.Message.request('yzforge-editor','state');
    return {registered:state.modules.some(module=>module.id===args.id),incomplete:state.creations.some(record=>record.request.id===args.id),
        source:!!await Editor.Message.request('asset-db','query-asset-info','db://assets/game/modules/'+args.id+'/module.json'),
        index:!!await Editor.Message.request('asset-db','query-asset-info','db://assets/game/modules/'+args.id+'/bundles/default/yz-index.json')};
})();`,
    { id: moduleId },
    false,
);
assert.deepEqual(retained, { registered: true, incomplete: false, source: true, index: true });
await editor('await Editor.Message.request("asset-db","delete-asset",args.url); return true;', { url: errorUrl });
await action('generate');
const deletion = await action('previewDelete', { module: moduleId, kind: 'module' });
assert.deepEqual(deletion.references, []);
const deleted = await action('deleteModule', deletion);
assert.ok(!deleted.generationError, deleted.generationError);
console.log(
    JSON.stringify({
        ok: true,
        generationFailureRetainedSources: true,
        regenerated: true,
        normalDeletion: true,
        module: moduleId,
    }),
);

// 子进程在创建记录落盘后退出；实际面板必须允许检查持久化的 creating 状态。
const root = resolve(import.meta.dirname, '../..');
const panelProbe = 'creation-panel-' + Date.now().toString(36);
const interrupted = `const path=require('node:path');const root=${JSON.stringify(root)};const tracker=require(path.join(root,'tools/yzforge/operations/creation.cjs')).createCreationTracker({inside:file=>path.join(root,file)});tracker.run({request:{kind:'module',id:${JSON.stringify(panelProbe)}},files:[]},()=>process.exit(17));`;
assert.throws(
    () => execFileSync(process.execPath, ['-e', interrupted]),
    (error) => error.status === 17,
);
const pendingState = await editor('return await Editor.Message.request("yzforge-editor","state");');
const pending = pendingState.creations.find((record) => record.request.id === panelProbe);
assert.equal(pending.stage, 'creating');
assert.equal(pending.busy, false);
await editor('await Editor.Panel.open("yzforge-editor"); return true;');
const panel = (code) =>
    editor(
        `
for(const window of require('electron').BrowserWindow.getAllWindows()){
    if(!window.webContents.getURL().includes('windows'))continue;
    const result=await window.webContents.executeJavaScript('(async()=>{const find=r=>{const e=r.querySelector("#workbench");if(e)return e;for(const n of r.querySelectorAll("*"))if(n.shadowRoot){const e=find(n.shadowRoot);if(e)return e;}};const root=find(document);if(!root)return {found:false};const el=id=>root.querySelector("#"+id);return {found:true,value:await(async()=>{'+args.code+'})()};})()');
    if(result.found)return result.value;
}throw Error('Workbench not found');`,
        { code },
    );
async function until(check) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw Error('Workbench cleanup timed out');
}
await until(() => panel('return root.dataset.busy!=="true"&&el("health").textContent!=="正在连接";'));
await panel('el("refresh").click(); return true;');
await until(() => panel('return root.dataset.busy!=="true";'));
await panel(
    `el('creationRecord').value=${JSON.stringify(pending.id)};el('creationRecord').dispatchEvent(new Event('change',{bubbles:true}));return true;`,
);
assert.deepEqual(
    await panel(
        `return {label:el('generate').textContent,check:el('previewCreationCleanup').disabled,cleanup:el('cleanupCreation').disabled,oldRetry:!!el('retryCreation')};`,
    ),
    { label: '重新生成', check: false, cleanup: true, oldRetry: false },
);
await panel('el("previewCreationCleanup").click(); return true;');
await until(() => panel('return root.dataset.busy!=="true"&&!el("cleanupCreation").disabled;'));
await panel('el("cleanupCreation").click(); return true;');
await until(() =>
    panel(
        `return root.dataset.busy!=='true'&&![...el('creationRecord').options].some(option=>option.value===${JSON.stringify(pending.id)});`,
    ),
);
const finalState = await editor(
    'return {dirty:await Editor.Message.request("scene","query-dirty"),state:await Editor.Message.request("yzforge-editor","state")};',
);
assert.ok(!finalState.dirty);
assert.ok(!finalState.state.creations.some((record) => record.id === pending.id));
assert.equal(finalState.state.autoStatus.state, 'ready');
console.log(JSON.stringify({ ok: true, interruptedCreationPanelCleaned: true, stage: 'creating' }));
