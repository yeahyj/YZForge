import assert from 'node:assert/strict';
import { unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { call } from '../../tools/yzforge/mcp.mjs';
import { readWorkbook } from '../../tools/yzforge/workbooks.mjs';
const root = resolve(import.meta.dirname, '../..'),
    fixture = 'language-check-' + Date.now().toString(36);
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const action = async (name, input = {}) => {
    const result = await editor(
        'return await Editor.Message.request("yzforge-editor","dispatch",args.name,args.input);',
        { name, input },
    );
    assert.ok(!result?.generationError, result?.generationError);
    return result;
};
const state = () => editor('return await Editor.Message.request("yzforge-editor","state");');
const panel = (code, input = {}) =>
    editor(
        `
for(const w of require('electron').BrowserWindow.getAllWindows()){
 if(!w.webContents.getURL().includes('windows'))continue;
 const found=await w.webContents.executeJavaScript('(()=>{const find=r=>{const found=r.querySelector("#workbench");if(found)return found;for(const n of r.querySelectorAll("*")){if(n.shadowRoot){const next=find(n.shadowRoot);if(next)return next;}}};window.__languagePanel=find(document);return !!window.__languagePanel;})()');
 if(found)return await w.webContents.executeJavaScript('(async()=>{const input='+JSON.stringify(args.input)+';const root=window.__languagePanel;const el=id=>root.querySelector("#"+id);const set=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new Event("change",{bubbles:true}));};'+args.code+'})()');
}throw Error('Workbench is not open');`,
        { code, input },
    );
async function until(code) {
    const end = Date.now() + 25000;
    while (Date.now() < end) {
        if (await panel(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw Error(
        JSON.stringify(await panel('return {status:el("status").textContent,output:el("output").textContent};')),
    );
}
const create = async (request) => {
    const plan = await action('previewCreate', request);
    assert.deepEqual(plan.conflicts, []);
    return action('create', { request: plan.request, signature: plan.signature });
};
assert.equal(
    await editor('return await Editor.Message.request("scene", "query-dirty");'),
    false,
    '请先保存当前场景或预制体；此回归需要创建、删除和恢复测试资产，未保存时不开始创建',
);
await editor('await Editor.Panel.open("yzforge-editor");return true;');
await until('return root.dataset.busy!=="true";');
await create({ kind: 'module', id: fixture, delivery: 'none', displayName: '多语言工作台验证' });
let removed = false;
try {
    await panel('el("refresh").click();');
    await until('return root.dataset.busy!=="true";');
    await panel(
        'set("module",input.fixture);root.querySelector("[data-tab=localization]").click();set("languageBundle","default");set("languageLocale","en");el("languageTexts").checked=true;el("languageTexts").dispatchEvent(new Event("change",{bubbles:true}));el("previewLanguage").click();',
        { fixture },
    );
    await until('return !el("createLanguage").disabled;');
    assert.match(await panel('return el("languagePreview").textContent;'), /localization-default.xlsx/);
    await panel('el("createLanguage").click();');
    await until('return root.dataset.busy!=="true";');
    assert.equal(await panel('return el("health").dataset.state;'), 'ready');
    const saved = await state(),
        module = saved.modules.find((item) => item.id === fixture),
        source = module.bundles.default.localization.source;
    assert.deepEqual(module.bundles.default.localization.locales.en, {});
    assert.deepEqual(Object.keys(module.bundles), ['default']);
    assert.equal(await panel('return !!el("languageStorage");'), false);
    assert.deepEqual(await panel('return Array.from(el("bundle").options,o=>o.value);'), ['default']);
    assert.ok(!saved.workbooks.some((item) => item.source === source));
    assert.ok((await panel('return el("languageStatus").textContent;')).includes('0 / 1'));
    assert.equal(
        saved.localizationWorkbooks.find((item) => item.source === source).localization.texts[0].values.en,
        undefined,
    );
    await assert.rejects(
        action('previewCreate', { kind: 'table', module: fixture, bundle: 'default-en', id: 'invalid' }),
        /业务资源包/,
    );
    await assert.rejects(
        action('previewDelete', { module: fixture, kind: 'language', id: 'default/zh-CN' }),
        /默认语言不能/,
    );
    const preview = await action('previewDelete', { module: fixture, kind: 'language', id: 'default/en' });
    assert.deepEqual(preview.references, []);
    const stopped = await action('deleteModule', preview);
    assert.ok(!(await state()).modules.find((item) => item.id === fixture).bundles.default.localization.locales.en);
    await action('restore', { id: stopped.restoreId });
    assert.deepEqual(
        (await state()).modules.find((item) => item.id === fixture).bundles.default.localization.locales.en,
        {},
    );
    const deletion = await action('previewDelete', { module: fixture, kind: 'module' });
    assert.deepEqual(deletion.references, []);
    const deleted = await action('deleteModule', deletion);
    removed = true;
    assert.equal((await readWorkbook(root, source)).config.enabled, false);
    await action('restore', { id: deleted.restoreId });
    removed = false;
    assert.equal((await readWorkbook(root, source)).config.enabled, true);
    const final = await action('previewDelete', { module: fixture, kind: 'module' });
    await action('deleteModule', final);
    removed = true;
    await unlink(resolve(root, source));
    await rmdir(resolve(root, 'config-source', fixture));
    await panel('el("refresh").click();');
    await until('return root.dataset.busy!=="true";');
    console.log('PASS: 真实多语言面板创建、专用语言包归属、缺译统计、删除保护、工作簿停用与恢复');
} finally {
    if (!removed) console.error('Fixture retained for inspection:', fixture);
}
