import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
await editor("await Editor.Panel.open('yzforge-editor');return true;");
const panel = (code, input = {}) =>
    editor(
        `
for(const w of require('electron').BrowserWindow.getAllWindows()){
 if(!w.webContents.getURL().includes('windows'))continue;
 const found=await w.webContents.executeJavaScript('(()=>{function find(r){const own=r.querySelector("#workbench");if(own)return own;for(const n of r.querySelectorAll("*")){if(n.shadowRoot){const child=find(n.shadowRoot);if(child)return child;}}}globalThis.__showcaseWorkbench=find(document);return !!globalThis.__showcaseWorkbench;})()');
 if(found){w.__showcasePanel=true;return await w.webContents.executeJavaScript('(async()=>{const root=globalThis.__showcaseWorkbench,el=id=>root.querySelector("#"+id),args='+JSON.stringify(args.input)+';'+args.code+'})()');}
}throw Error('YZForge panel not found');`,
        { code, input },
    );
async function until(code) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
        if (await panel(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error(
        'Panel timeout: ' +
            JSON.stringify(await panel('return {status:el("status").textContent,output:el("output").textContent};')),
    );
}
await until('return root.dataset.busy!=="true"&&el("module").options.length>0;');
await panel('root.querySelector("[data-tab=workflow]").click();return true;');
assert.equal(await panel('return root.querySelectorAll(".workflow-grid > .card").length;'), 7);
for (const [id, expected] of [
    ['module', '"workshop"'],
    ['service', 'class TaskService'],
    ['wallet', 'class WalletService'],
    ['presenter', 'class WorkflowPagePresenter'],
    ['page', 'class WorkflowPage'],
    ['part', 'class TaskPart'],
    ['binding', 'class WorkflowPageBinding'],
    ['contract', 'TasksTable'],
    ['tests', 'node:test'],
    ['guide', '# 正式开发工作流'],
]) {
    await panel('root.querySelector("[data-workflow-source="+args.id+"]").click();return true;', { id });
    await until('return root.dataset.busy!=="true";');
    assert.equal(
        await panel('return el("workflowSource").textContent.includes(args.expected);', { expected }),
        true,
        id,
    );
}
await panel('root.querySelector("[data-workflow-jump=tables]").click();return true;');
assert.deepEqual(
    await panel(
        'return {tab:root.querySelector("[data-tab][aria-selected=true]").dataset.tab,module:el("module").value,workbook:el("workbook").value};',
    ),
    { tab: 'tables', module: 'workshop', workbook: 'config-source/workshop/tasks.xlsx' },
);
await panel(
    'root.querySelector("[data-tab=workflow]").click();root.querySelector("[data-workflow-jump=bindings]").click();return true;',
);
assert.equal(await panel('return el("binding").value;'), 'view:workflow-page');
await panel(
    'root.querySelector("[data-tab=workflow]").click();root.querySelector("[data-workflow-jump=create]").click();return true;',
);
assert.equal(await panel('return root.querySelector("[data-tab][aria-selected=true]").dataset.tab;'), 'create');
const missing = await editor(
    "return await Editor.Message.request('yzforge-editor','dispatch','readWorkflowSource',{id:'unknown-source'}).then(()=>false,()=>true);",
);
assert.equal(missing, true, 'source reader accepted arbitrary path');
await panel(
    'root.querySelector("[data-tab=workflow]").click();root.querySelector("[data-workflow-source=presenter]").click();return true;',
);
await until('return root.dataset.busy!=="true";');
const capture = await editor(`
const w=require('electron').BrowserWindow.getAllWindows().find(w=>w.__showcasePanel);
const rect=await w.webContents.executeJavaScript('(()=>{const r=globalThis.__showcaseWorkbench.getBoundingClientRect();return {x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};})()');
const file=require('path').join(Editor.Project.path,'temp/mcp-captures/showcase-workbench.png');
require('fs').writeFileSync(file,(await w.webContents.capturePage(rect)).toPNG());return file;`);
console.log(
    JSON.stringify({ ok: true, steps: 7, sources: 10, jumps: 3, sourcePathRestricted: true, screenshot: capture }),
);
