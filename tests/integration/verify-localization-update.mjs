import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { call } from '../../tools/yzforge/mcp.mjs';
const editor = async (code, args = {}, safety_checks = true) =>
    (await call('execute_javascript', { context: 'editor', code, args, safety_checks })).data;
const scene = async (code, args = {}) => {
    const reply = (await call('execute_javascript', { context: 'scene', code, args })).data;
    assert.ok(reply.ok);
    return reply.result;
};
const dispatch = (action, args = {}) =>
    editor('return await Editor.Message.request("yzforge-editor","dispatch",args.action,args.input);', {
        action,
        input: args,
    });
const panel = (code) =>
    editor(
        `
for(const w of require('electron').BrowserWindow.getAllWindows()){
 if(!w.webContents.getURL().includes('windows'))continue;
 const value=await w.webContents.executeJavaScript('(async()=>{const find=r=>{const e=r.querySelector("#workbench");if(e)return e;for(const n of r.querySelectorAll("*"))if(n.shadowRoot){const e=find(n.shadowRoot);if(e)return e;}};const root=find(document);if(!root)return {found:false};const el=id=>root.querySelector("#"+id);const set=(id,v)=>{el(id).value=v;el(id).dispatchEvent(new Event("change",{bubbles:true}));};return {found:true,value:await (async()=>{'+args.code+'})()};})()');
 if(value.found)return value.value;
}throw Error('Workbench is not open');`,
        { code },
    );
async function until(test) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        if (await test()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('Language update timeout');
}
const before = await editor(
    `return {selection:Editor.Selection.getSelected('node'),source:await Editor.Message.request('scene','query-current-scene'),dirty:await Editor.Message.request('scene','query-dirty')};`,
);
const fixtureName = '__locale-update-check-' + Date.now();
const fixtureUrl = 'db://assets/' + fixtureName;
let created = false;
let fixture;
try {
    fixture = await scene(`
if(globalThis.__yzforgeManualLocaleCheck)throw Error('Another locale check is running');
const parent=cce.Scene.rootNode;if(!parent)throw Error('Open a scene or prefab first');
const root=new cc.Node('__locale_apply_check');root.layer=cc.Layers.Enum.UI_2D;root.setPosition(100000,100000);root.parent=parent;
root._objFlags|=cc.CCObject.Flags.DontSave|cc.CCObject.Flags.HideInHierarchy;
const data={root};globalThis.__yzforgeManualLocaleCheck=data;
for(const [kind,name,key]of[['text','yzforge.LocalizedLabel','example.welcome'],['sprite','yzforge.LocalizedSprite','example.greeting']]){
 const node=new cc.Node(kind);node.layer=root.layer;node.parent=root;
 const component=node.addComponent(cc.js.getClassByName(name));component.namespace='showcase/default';component.key=key;
 if(typeof component.update==='function'||typeof component.onFocusInEditor==='function')throw Error('Runtime preview code remains');
 const renderer=node.getComponent(kind==='text'?cc.Label:cc.Sprite);
 if(kind==='text'){const p=new (cc.js.getClassByName('yzforge.LocalizedTextParameter'))();p.name='name';p.value='Panel';component.parameters=[p];renderer.string='ORIGINAL';renderer.overflow=cc.Label.Overflow.CLAMP;}
 else renderer.sizeMode=cc.Sprite.SizeMode.CUSTOM;
 node.getComponent(cc.UITransform).setContentSize(400,80);data[kind]=node;
}
return {root:root.uuid,text:data.text.uuid,sprite:data.sprite.uuid};`);
    const read = () =>
        scene(
            `const f=globalThis.__yzforgeManualLocaleCheck;return {text:f.text.getComponent(cc.Label).string,image:f.sprite.getComponent(cc.Sprite).spriteFrame?.uuid??'',rendered:!f.text.getComponent(cc.Label).renderData?.vertDirty&&!f.sprite.getComponent(cc.Sprite).renderData?.vertDirty};`,
        );
    await editor(
        `Editor.Selection.clear('node');Editor.Selection.select('node',args.uuid);await Editor.Panel.open('yzforge-editor');return true;`,
        { uuid: fixture.root },
    );
    await until(() =>
        panel('return !!el("languageApplyLocale")?.options.length&&!el("applyLanguageUpdate").disabled;'),
    );
    await panel(
        `root.querySelector('[data-tab="localization"]').click();set('languageApplyScope','selection');set('languageApplyLocale','en');el('applyLanguageUpdate').click();return true;`,
    );
    await until(async () => (await read()).text === 'Welcome, Panel!');
    await until(() => panel('return root.dataset.busy!=="true";'));
    const english = await read();
    assert.ok(english.image);
    await until(async () => (await read()).rendered);
    await editor(`await Editor.Message.request('scene','undo');return true;`);
    assert.deepEqual({ ...(await read()), rendered: true }, { text: 'ORIGINAL', image: '', rendered: true });
    await editor(`await Editor.Message.request('scene','redo');return true;`);
    assert.equal((await read()).text, english.text);
    await dispatch('applyLanguageUpdate', { scope: 'selection', locale: 'zh-CN' });
    const chinese = await read();
    assert.equal(chinese.text, '欢迎，Panel！');
    assert.notEqual(chinese.image, english.image);

    // A bad binding must fail before changing any of the other native fields.
    await scene(
        `globalThis.__yzforgeManualLocaleCheck.sprite.getComponent('yzforge.LocalizedSprite').key='missing-key';return true;`,
    );
    await assert.rejects(dispatch('applyLanguageUpdate', { scope: 'selection', locale: 'en' }), /语言键不存在/);
    assert.equal((await read()).text, chinese.text);
    await scene(
        `globalThis.__yzforgeManualLocaleCheck.sprite.getComponent('yzforge.LocalizedSprite').key='example.greeting';return true;`,
    );

    // Export a real native prefab to an isolated folder; never save the user's open asset.
    const content = await scene(`
const clone=cc.instantiate(globalThis.__yzforgeManualLocaleCheck.root);clone.parent=null;
clone._objFlags&=~(cc.CCObject.Flags.DontSave|cc.CCObject.Flags.HideInHierarchy);
clone.walk(node=>{node._prefab=null;for(const c of node.components)c.__prefab=null;});
const asset=new cc.Prefab();asset.data=clone;
try{const value=cce.Utils.serialize(asset);return typeof value==='string'?value:JSON.stringify(value,null,2);}finally{clone.destroy();}`);
    await editor(`await Editor.Message.request('asset-db','create-asset',args.url,null);return true;`, {
        url: fixtureUrl,
    });
    created = true;
    const assets = await editor(
        `const result=[];for(const url of args.urls)result.push(await Editor.Message.request('asset-db','create-asset',url,args.content));return result.map(a=>({uuid:a.uuid,url:a.url}));`,
        { urls: ['First', 'Second'].map((name) => `${fixtureUrl}/${name}.prefab`), content },
    );
    const persisted = await scene(
        `const asset=await new Promise((resolve,reject)=>cc.assetManager.loadAny(args.uuid,(e,a)=>e?reject(e):resolve(a)));return {text:asset.data.getComponentsInChildren(cc.Label)[0].string,image:asset.data.getComponentsInChildren(cc.Sprite)[0].spriteFrame?.uuid};`,
        { uuid: assets[0].uuid },
    );
    assert.equal(persisted.text, chinese.text);
    assert.equal(persisted.image, chinese.image);

    // Use the production batch implementation and real asset-db against an isolated scope.
    await editor(
        `
const directory=path.join(Editor.Project.path,'assets',args.name);
const inside=value=>{const file=path.resolve(Editor.Project.path,value),local=path.relative(Editor.Project.path,file);if(local.startsWith('..')||path.isAbsolute(local))throw Error('Outside project');return file;};
const records=[];globalThis.__yzforgeLocaleBatch={records,assets:args.assets};
globalThis.__yzforgeLocaleBatch.tools=require(path.join(Editor.Project.path,'extensions/yzforge-editor/localization-update.js')).createLocalizationUpdates({
 inside,moduleInfo:async()=>({directory,manifest:{id:'locale-check',bundles:{default:{root:'.',id:'locale-check-default'}}}}),
 journal:async(action,payload)=>{const id=Date.now()+'-'+require('crypto').randomBytes(4).toString('hex');const file=inside('.yzforge/editor-history/'+id+'.json');await fs.promises.mkdir(path.dirname(file),{recursive:true});await fs.promises.writeFile(file,JSON.stringify({id,action,...payload},null,2));records.push(file);return id;}
});return true;`,
        { name: fixtureName, assets },
        // The project-bound path guard contains '..'; reviewed paths are our fixture and history directory only.
        false,
    );
    const batch = (method, input) =>
        editor(`return await globalThis.__yzforgeLocaleBatch.tools[args.method](args.input);`, { method, input });
    const args = { scope: 'bundle', module: 'locale-check', bundle: 'default', locale: 'en' };
    const plan = await batch('previewLanguageUpdate', args);
    assert.equal(plan.files.length, 2, JSON.stringify(plan));
    const applied = await batch('applyLanguageUpdate', { ...args, planId: plan.id });
    assert.equal(applied.updated, 2);
    const readFiles = () =>
        editor(
            `return await Promise.all(globalThis.__yzforgeLocaleBatch.assets.map(async a=>{const i=await Editor.Message.request('asset-db','query-asset-info',a.uuid);return fs.readFileSync(i.file,'utf8');}));`,
        );
    const updated = await readFiles();
    for (const value of updated) assert.match(value, /Welcome, Panel!/);
    let buildFailure = '';
    try {
        execFileSync(process.execPath, ['tools/yzforge/cli.mjs', 'check', '--platform', 'web-mobile'], {
            cwd: resolve(import.meta.dirname, '../..'),
            encoding: 'utf8',
            stdio: 'pipe',
        });
    } catch (error) {
        buildFailure = String(error.stderr);
    }
    assert.match(buildFailure, /直接引用了 en 语言资源.*默认语言 zh-CN/);
    const restored = await batch('restoreLanguageUpdate', { id: applied.id });
    assert.equal(restored.restored, 2);
    const initial = await readFiles();
    for (const value of initial)
        assert.equal(JSON.parse(value).find((v) => v.__type__ === 'cc.Label')._string, chinese.text);

    // Fail the second save: the first must be restored, with no partial batch left behind.
    const failurePlan = await batch('previewLanguageUpdate', args);
    const failed = await editor(
        `
const original=Editor.Message.request;let failed=false;
Editor.Message.request=function(channel,method,...rest){if(!failed&&channel==='asset-db'&&method==='save-asset'&&rest[0]===args.target){failed=true;return Promise.reject(Error('EXPECTED_BATCH_SAVE_FAILURE'));}return original.call(this,channel,method,...rest);};
try{await globalThis.__yzforgeLocaleBatch.tools.applyLanguageUpdate(args.input);return '';}
catch(error){return error.message;}finally{Editor.Message.request=original;}`,
        { target: assets[1].url, input: { ...args, planId: failurePlan.id } },
    );
    assert.match(failed, /EXPECTED_BATCH_SAVE_FAILURE/);
    assert.deepEqual(await readFiles(), initial);

    const stalePlan = await batch('previewLanguageUpdate', args);
    await editor(`await Editor.Message.request('asset-db','save-asset',args.url,args.content);return true;`, {
        url: assets[1].url,
        content: initial[1] + '\n',
    });
    await assert.rejects(batch('applyLanguageUpdate', { ...args, planId: stalePlan.id }), /资源已被修改/);
    assert.equal((await readFiles())[0], initial[0]);
    console.log(
        'PASS: 面板下拉与按钮、文字/图片直接更新和重绘、原生撤销重做、真实保存回读、错误不半更新、批量保存/恢复/失败回滚/冲突保护、运行组件无预览回调',
    );
} finally {
    if (fixture) {
        await editor(
            `Editor.Selection.clear('node');for(const id of args.ids)Editor.Selection.select('node',id);return true;`,
            { ids: before.selection },
        );
        await scene(
            `globalThis.__yzforgeManualLocaleCheck?.root.destroy();delete globalThis.__yzforgeManualLocaleCheck;return true;`,
        );
    }
    if (created)
        await editor(`await Editor.Message.request('asset-db','delete-asset',args.url);return true;`, {
            url: fixtureUrl,
        });
    const records = await editor(
        'const records=globalThis.__yzforgeLocaleBatch?.records??[];delete globalThis.__yzforgeLocaleBatch;return records;',
    );
    const history = resolve(import.meta.dirname, '../../.yzforge/editor-history');
    for (const file of records) {
        assert.equal(dirname(resolve(file)), history);
        await unlink(file);
    }
}
