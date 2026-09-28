// 在独立资源模块验证工作台，不切换或保存用户正在编辑的场景。
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { call } from '../../tools/yzforge/mcp.mjs';
import { readWorkbook, writeWorkbookConfig } from '../../tools/yzforge/workbooks.mjs';

const root = resolve(import.meta.dirname, '../..');
const fixture = 'language-path-check-' + Date.now().toString(36);
const folder = `db://assets/game/modules/${fixture}`;
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
 const result=await w.webContents.executeJavaScript('(async()=>{const find=r=>{const e=r.querySelector("#workbench");if(e)return e;for(const n of r.querySelectorAll("*"))if(n.shadowRoot){const e=find(n.shadowRoot);if(e)return e;}};const root=find(document);if(!root)return {found:false};const input='+JSON.stringify(args.input)+';const el=id=>root.querySelector("#"+id);const set=(id,v)=>{el(id).value=v;el(id).dispatchEvent(new Event("change",{bubbles:true}));};return {found:true,value:await (async()=>{'+args.code+'})()};})()');
 if(result.found)return result.value;
}throw Error('Workbench is not open');`,
        { code, input },
    );
async function until(code) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
        if (await panel(code)) return;
        await new Promise((r) => setTimeout(r, 150));
    }
    throw Error(
        JSON.stringify(await panel('return {status:el("status").textContent,output:el("output").textContent};')),
    );
}
const refresh = async () => {
    await panel('el("refresh").click();');
    await until('return root.dataset.busy!=="true";');
};
const create = async (request) => {
    const plan = await action('previewCreate', request);
    assert.deepEqual(plan.conflicts, []);
    return action('create', { request: plan.request, signature: plan.signature });
};
const before = await editor(
    'return {source:await Editor.Message.request("scene","query-current-scene"),dirty:await Editor.Message.request("scene","query-dirty")};',
);
await editor('await Editor.Panel.open("yzforge-editor");return true;');
await until('return root.dataset.busy!=="true";');
const previousModule = await panel('return el("module").value;');
let created = false,
    source;
try {
    await create({ kind: 'module', id: fixture, delivery: 'none', displayName: '路径多语言验证' });
    created = true;
    await refresh();
    await panel(
        'set("module",input.fixture);root.querySelector("[data-tab=localization]").click();set("languageBundle","default");set("languageLocale","en");el("previewLanguage").click();',
        { fixture },
    );
    await until('return !el("createLanguage").disabled;');
    assert.ok(!(await panel('return el("languagePreview").textContent;')).includes('.xlsx'));
    await panel('el("createLanguage").click();');
    await until('return root.dataset.busy!=="true";');
    let current = await state();
    assert.equal(current.modules.find((m) => m.id === fixture).bundles.default.localization.source, undefined);
    const asset = (locale, name) => `${folder}/localization/default/${locale}/dynamic/images/${name}.png`;
    for (const locale of ['zh-CN', 'en'])
        await editor('await Editor.Message.request("asset-db","create-asset",args.url,null);return true;', {
            url: `${folder}/localization/default/${locale}/dynamic/images`,
        });
    await editor(
        'return await Editor.Message.request("asset-db","copy-asset",args.source,args.target,{overwrite:false,rename:false});',
        {
            source: 'db://assets/game/modules/showcase/localization/default/zh-CN/dynamic/images/greeting.png',
            target: asset('zh-CN', 'greeting'),
        },
    );
    await action('generate');
    await refresh();
    assert.match(await panel('return el("languageStatus").textContent;'), /回退：images\/greeting/);
    await editor(
        'return await Editor.Message.request("asset-db","copy-asset",args.source,args.target,{overwrite:false,rename:false});',
        {
            source: 'db://assets/game/modules/showcase/localization/default/en/dynamic/images/greeting.png',
            target: asset('en', 'greeting'),
        },
    );
    for (const locale of ['zh-CN', 'en'])
        await editor('return await Editor.Message.request("asset-db","move-asset",args.source,args.target);', {
            source: asset(locale, 'greeting'),
            target: asset(locale, 'welcome'),
        });
    await action('generate');
    current = await state();
    assert.deepEqual(
        current.languageResources.filter((r) => r.namespace === `${fixture}/default`).map((r) => r.keys),
        [['images/welcome'], ['images/welcome']],
    );

    await refresh();
    await panel(
        'el("languageTexts").checked=true;el("languageTexts").dispatchEvent(new Event("change",{bubbles:true}));el("previewLanguage").click();',
    );
    await until('return !el("createLanguage").disabled;');
    assert.match(await panel('return el("languagePreview").textContent;'), /localization-default.xlsx/);
    await panel('el("createLanguage").click();');
    await until('return root.dataset.busy!=="true";');
    current = await state();
    source = current.modules.find((m) => m.id === fixture).bundles.default.localization.source;
    const workbook = await readWorkbook(root, source);
    assert.equal(workbook.book.getWorksheet('assets'), undefined);
    assert.deepEqual(workbook.localization.locales, ['zh-CN', 'en']);
    const deletion = await action('previewDelete', { module: fixture, kind: 'localization', id: 'default' });
    assert.deepEqual(deletion.references, []);
    assert.equal(deletion.workbooks.length, 1);
    assert.equal(await editor('return await Editor.Message.request("scene","query-current-scene");'), before.source);
    assert.equal(await editor('return await Editor.Message.request("scene","query-dirty");'), before.dirty);
    console.log(
        'PASS: 原生面板创建纯资源包、缺失资源回退提示、按路径改名、追加纯文案工作簿、停用预览、保持当前编辑状态',
    );
} catch (error) {
    console.error('Path localization check failed:', error);
    throw error;
} finally {
    if (created || (await state()).modules.some((m) => m.id === fixture)) {
        // Only our uniquely named fixture is removed; never invoke project deletion on the user's dirty scene.
        const current = await state();
        source ??= current.modules.find((m) => m.id === fixture)?.bundles.default.localization?.source;
        await action('languageUpdateHistory');
        const extension = await editor(
            'const p=Editor.Package.getPackages({name:"yzforge-editor"})[0];await Editor.Package.disable(p.path);return p.path;',
        );
        try {
            if (source) {
                assert.equal(source, `config-source/${fixture}/localization-default.xlsx`);
                const workbook = await readWorkbook(root, source);
                await writeWorkbookConfig(root, source, { kind: 'localization', enabled: false }, workbook.hash);
            }
            await editor(
                `const root=await Editor.Message.request('asset-db','query-asset-info',args.url);if(!root)throw Error('Fixture missing');
const records=(await Editor.Message.request('asset-db','query-assets',{pattern:args.pattern})).filter(a=>!a.uuid.includes('@'));records.push(root);
const infos=[];for(const record of records){const info=await Editor.Message.request('asset-db','query-asset-info',record.uuid);if(info?.file&&(info.file===root.file||info.file.startsWith(root.file+path.sep)))infos.push(info);else throw Error('Outside fixture');}
infos.sort((a,b)=>Number(a.isDirectory)-Number(b.isDirectory)||b.file.length-a.file.length);
for(const info of infos){if(info.isDirectory&&fs.readdirSync(info.file).length)throw Error('Directory still contains files');await Editor.Message.request('asset-db','delete-asset',info.url);if(await Editor.Message.request('asset-db','query-asset-info',info.uuid))throw Error('Creator did not delete fixture');}return true;`,
                { url: folder, pattern: folder + '/**' },
            );
            if (source) {
                await unlink(resolve(root, source));
                await rmdir(resolve(root, 'config-source', fixture));
            }
            const file = resolve(root, 'project-settings/generated/resource-identities.json'),
                identities = JSON.parse(await readFile(file, 'utf8'));
            for (const [uuid, entry] of Object.entries(identities.entries))
                if (entry.id.startsWith(fixture + '/')) delete identities.entries[uuid];
            await writeFile(file, JSON.stringify(identities, null, 2) + '\n');
        } finally {
            await editor(
                'await Editor.Package.enable(args.path);await Editor.Panel.open("yzforge-editor");return true;',
                { path: extension },
            );
        }
        await action('generate');
    }
    await refresh();
    await panel('if(Array.from(el("module").options).some(o=>o.value===input.module))set("module",input.module);', {
        module: previousModule,
    });
}
