// Exercise the actual Creator panel DOM and AssetDB-backed actions, not a duplicate HTML mock.
import assert from 'node:assert/strict';
import { access, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { call } from '../../tools/yzforge/mcp.mjs';
const root = resolve(import.meta.dirname, '../..');
const fixture = 'panel-check-' + Date.now().toString(36);
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const panel = async (code, args = {}) =>
    editor(
        `
const windows=require('electron').BrowserWindow.getAllWindows();
for(const window of windows){
 if(!window.webContents.getURL().includes('windows'))continue;
 const found=await window.webContents.executeJavaScript('('+${JSON.stringify(
     String(function locate(document, window) {
         const visit = (r) => {
             const found = r.querySelector('#workbench');
             if (found) return found;
             for (const e of r.querySelectorAll('*'))
                 if (e.shadowRoot) {
                     const m = visit(e.shadowRoot);
                     if (m) return m;
                 }
         };
         window.workbenchTest = visit(document);
         return !!window.workbenchTest;
     }),
 )}+')(document,window)');
 if(found)return await window.webContents.executeJavaScript('(async()=>{const args='+JSON.stringify(args.input)+';const root=window.workbenchTest;const el=id=>root.querySelector("#"+id);const set=(id,value,event="input")=>{el(id).value=value;el(id).dispatchEvent(new Event(event,{bubbles:true}));};'+args.code+'})()');
}
throw Error('Open the YZForge panel before running this check');`,
        { code, input: args },
    );
async function until(code) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
        if (await panel(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw Error(
        'Panel did not settle: ' +
            JSON.stringify(
                await panel(
                    'return {status:el("status").textContent,issue:el("createIssue").textContent,output:el("output").textContent};',
                ),
            ),
    );
}
await until('return root.dataset.busy !== "true";');
await panel('el("refresh").click();');
await until('return root.dataset.busy !== "true";');
const initialTime = await panel('return el("dayBoundary").value;');
assert.match(initialTime, /^\d{2}:\d{2}$/);
await panel('root.querySelector("[data-tab=settings]").click(); el("saveSettings").click();');
await until('return root.dataset.busy !== "true";');
assert.equal(await panel('return el("health").dataset.state;'), 'ready');
assert.equal(await panel('return el("dayBoundary").value;'), initialTime);
await panel(
    'root.querySelector("[data-tab=create]").click();set("kind","module","change");set("delivery","none","change");set("newName",args.id);',
    { id: fixture },
);
await until('return !el("create").disabled;');
const resourcePreview = await panel(
    'return {text:el("createPreview").textContent,initial:el("initial").value,locked:el("initial").disabled};',
);
assert.ok(!resourcePreview.text.includes('Module.ts'));
assert.ok(!resourcePreview.text.includes('public.ts'));
assert.equal(resourcePreview.initial, 'resources');
assert.equal(resourcePreview.locked, true);
console.log('PASS: automatic file preview, resource-only module, calendar settings round trip');
await panel('el("create").click();');
await until('return root.dataset.busy !== "true";');
assert.equal(await panel('return el("health").dataset.state;'), 'ready');
assert.equal(
    await access(resolve(root, 'assets/game/modules', fixture, 'public.ts')).then(
        () => true,
        () => false,
    ),
    false,
);
try {
    await panel('set("module",args.id,"change");set("kind","page","change");set("newName","Sample");', { id: fixture });
    await until('return !el("createIssue").hidden;');
    assert.equal(await panel('return el("create").disabled;'), true);
    assert.match(await panel('return el("createIssue").textContent;'), /只有资源与配置/);
    await panel('set("kind","module","change");set("newName","lobby");');
    await until('return !el("createIssue").hidden;');
    assert.equal(await panel('return el("create").disabled;'), true);
    await panel('set("newName","OldName");set("newName","LatestName");');
    await until('return !el("create").disabled;');
    const latest = await panel('return el("createPreview").textContent;');
    assert.match(latest, /latest-name/);
    assert.ok(!latest.includes('old-name'));
    await panel(
        'set("module","lobby","change");set("moduleDisplayName","未保存草稿");set("module","common","change");',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    await panel('set("module","lobby","change");');
    assert.equal(await panel('return el("moduleDisplayName").value;'), '未保存草稿');
    assert.equal(await panel('return el("moduleDirty").textContent;'), '未保存');
    // Reset the draft to the persisted value without saving any sample rename.
    await panel('set("moduleDisplayName","示例大厅");set("newName","");');
    console.log('PASS: inline validation, stale preview rejection, unsaved draft preservation');
} finally {
    await panel(
        'root.querySelector("[data-tab=recovery]").click();set("deleteModule",args.id,"change");set("deleteKind","module","change");',
        { id: fixture },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    await panel('el("previewDelete").click();');
    await until('return root.dataset.busy !== "true" && !el("delete").disabled;');
    assert.ok(await panel('return el("deletePreview").querySelectorAll(".file-row").length > 0;'));
    await panel('el("delete").click();');
    await until('return root.dataset.busy !== "true";');
    assert.equal(await panel('return el("health").dataset.state;'), 'ready');
}
await panel(
    'root.querySelector("[data-tab=create]").click();set("module","lobby","change");set("kind","page","change");set("newName","Inventory");',
);
await until('return !el("create").disabled;');
console.log('PASS: real panel creation and backed-up deletion; no business factory required');

// Simulate a stopped ordinary-file generation without touching project assets.
const generationId = Date.now() + '-acbd';
const recordRoot = resolve(root, '.yzforge/changes', generationId);
await mkdir(recordRoot, { recursive: true });
const probePath = `.yzforge/changes/${generationId}/probe.ts`;
await writeFile(resolve(root, probePath), 'generated');
await writeFile(
    resolve(recordRoot, 'transaction.json'),
    JSON.stringify({
        formatVersion: 2,
        id: generationId,
        status: 'prepared',
        entries: [{ path: probePath, previous: 'original', content: 'generated' }],
    }),
);
await panel('el("refresh").click();');
await until('return root.dataset.busy !== "true";');
await panel('root.querySelector("[data-tab=recovery]").click();set("generationRecord",args.id,"change");', {
    id: generationId,
});
await writeFile(resolve(root, probePath), 'user edit');
await panel('el("previewGeneration").click();');
await until('return root.dataset.busy !== "true";');
assert.equal(await panel('return el("recoverGeneration").disabled;'), true);
assert.match(await panel('return el("generationPreview").textContent;'), /冲突/);
assert.equal(await readFile(resolve(root, probePath), 'utf8'), 'user edit');
await writeFile(resolve(root, probePath), 'generated');
await panel('el("previewGeneration").click();');
await until('return root.dataset.busy !== "true" && !el("recoverGeneration").disabled;');
await panel('el("recoverGeneration").click();');
await until('return root.dataset.busy !== "true";');
assert.equal(await readFile(resolve(root, probePath), 'utf8'), 'original');
assert.equal(await panel('return el("generationRecord").value;'), '');
console.log('PASS: interrupted generation recovery refuses user edits, then restores its own output');
await panel('root.querySelector("[data-tab=create]").click();');
