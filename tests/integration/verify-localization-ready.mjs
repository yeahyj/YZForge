// 在独立游戏窗口注入慢加载、失败和取消，断言首屏可见性与导航事务。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview } from './preview.mjs';
const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `const w=new (require('electron').BrowserWindow)({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'language-ready-'+Date.now()}});
w.webContents.__yzforgeRuntimeCheck=true;w.__errors=[];w.webContents.on('console-message',(_,level,message)=>{if(level>=3&&!message.includes('EXPECTED_LANGUAGE_FAILURE'))w.__errors.push(message);});
try{await w.loadURL(args.url);return w.id;}catch(e){w.destroy();throw e;}`,
    { url: url.href },
);
try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
        ready = await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(ready, 'Bootstrap 未就绪');
    console.log(
        await preview(`
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{const end=Date.now()+12000;while(!test()){if(Date.now()>end)throw Error('Readiness timeout '+test.toString()+': '+JSON.stringify({ui:app.ui.inspect(),assets:app.assets.inspect()}));await wait(15);}};
const record=id=>Array.from(app.ui.records.values()).find(r=>r.definition.id===id&&!r.termination);
const page=()=>record('showcase.localization-lab-page');
const find=(node,name)=>node.name===name?node:node.children.map(n=>find(n,name)).find(Boolean);
const original=record('showcase.showcase-page');
const key={id:'showcase.localization-lab-page',kind:'page'};
const owner=app.scope.child('language-ready-check');
const prefab=await app.assets.load({id:'showcase/default/prefab/ui/localization-lab-page',type:'Prefab'},owner.lifetime);
const LabelType=cc.js.getClassByName('yzforge.LocalizedLabel'),SpriteType=cc.js.getClassByName('yzforge.LocalizedSprite');
const components=[...prefab.data.getComponentsInChildren(LabelType),...prefab.data.getComponentsInChildren(SpriteType)];
const before=components.map(c=>c.namespace);
for(const c of components)c.namespace='';
const staticTemplate=find(prefab.data,'StaticImage').getComponent(SpriteType),previousKey=staticTemplate.key;
const fetch=app.assets.fetch;
let release;
try {
  staticTemplate.key='images/logo';
  prefab.compileCreateFunction();
  let started=false;const loading=new Promise(r=>release=r);
  app.assets.fetch=async function(address){if(address.type==='SpriteFrame'&&address.path==='dynamic/images/logo/spriteFrame'){started=true;await loading;}return fetch.call(this,address);};
  let opened=false;const pending=app.ui.pushPage(key,undefined,owner.lifetime).then(v=>{opened=true;return v;});
  const observed=pending.catch(e=>{throw e;});observed.catch(()=>{});
  await until(()=>started);await wait(100);
  check(!opened&&!page().interactive,'Page returned before native images ready');
  check(page().instance.container.getComponent(cc.UIOpacity).opacity===0,'Preparing page became visible');
  check(original.interactive&&!original.suspended,'Previous page hidden while language loads');
  check(!find(page().instance.node,'StaticImage').getComponent(cc.Sprite).enabled,'Unready image renderer exposed');
  release();await observed;
  check(find(page().instance.node,'StaticImage').getComponent(cc.Sprite).enabled,'Ready image remained hidden');
  check(find(page().instance.node,'StaticText').getComponent(cc.Label).string==='欢迎，YZForge！','Automatic namespace incorrect');
  check(!app.assets.inspect().bundles.includes('showcase-default-en'),'Chinese startup requested English bundle');
  await app.ui.back().completed;await until(()=>original.interactive);
  app.assets.fetch=fetch;staticTemplate.key=previousKey;prefab.compileCreateFunction();
  // 公共预制体换宿主仍从源资源取词条；禁用/重启期间隐藏旧内容。
  await app.modules.use({id:'lobby'},owner.lifetime);
  const shared=await app.assets.instantiate({id:'showcase/default/prefab/ui/localization-lab-page',type:'Prefab'},cc.director.getScene(),owner.lifetime,{moduleId:'lobby'});
  (shared.getComponent(cc.UIOpacity)??shared.addComponent(cc.UIOpacity)).opacity=0;
  const fixed=find(shared,'StaticText').getComponent(LabelType);
  await fixed.lifetime.__ready();
  check(fixed.node.getComponent(cc.Label).string==='欢迎，YZForge！','Caller module replaced source namespace');
  const image=find(shared,'StaticImage').getComponent(SpriteType),renderer=image.node.getComponent(cc.Sprite),localize=image.localize;
  await image.lifetime.__ready();image.enabled=false;
  const stalled=new Promise(r=>release=r);image.localize=async function(context){await stalled;return localize.call(this,context);};
  image.enabled=true;await wait(30);check(!renderer.enabled,'Reactivation flashed previous sprite');
  release();await image.lifetime.__ready();check(renderer.enabled&&renderer.spriteFrame,'Reactivated image missing');
  await app.assets.destroyInstance(shared);
}finally{
  release?.();app.assets.fetch=fetch;staticTemplate.key=previousKey;
  components.forEach((c,i)=>c.namespace=before[i]);
  prefab.compileCreateFunction();
}
// 首次准备失败不能提交新页面，错误必须返回调用者。
const localize=SpriteType.prototype.localize;
try {
  SpriteType.prototype.localize=async function(){throw Error('EXPECTED_LANGUAGE_FAILURE');};
  let failure;try{await app.ui.pushPage(key,undefined,owner.lifetime);}catch(e){failure=e;}
  check(String(failure).includes('EXPECTED_LANGUAGE_FAILURE'),'Initial failure was swallowed');
  await until(()=>!Array.from(app.ui.records.values()).some(r=>r.definition.id===key.id));check(original.interactive&&!original.suspended,'Initial failure replaced old page');
}finally{SpriteType.prototype.localize=localize;}
// 等待首屏时取消导航，不显示迟到的新页，不挂死清理。
try {
  let started=false;const stalled=new Promise(r=>release=r);
  SpriteType.prototype.localize=async function(context){started=true;await stalled;return localize.call(this,context);};
  const pending=app.ui.pushPage(key,undefined,owner.lifetime).then(()=>{throw Error('Cancelled page opened');},e=>e);
  await until(()=>started);const back=app.ui.back();release();await back.completed;
  const failure=await pending;check(failure.code==='OPERATION_CANCELLED','Cancellation did not reach caller');
  check(original.interactive&&!original.suspended,'Cancellation hid old page');
}finally{release?.();SpriteType.prototype.localize=localize;}
await owner.close();await app.close();check(app.assets.inspect().resources.length===0,'Held resources after shutdown');
return {passed:['slow-first-frame','automatic-source','shared-prefab-host','no-English-load','reactivation','initial-failure','cancel-preparation'],resources:0};`),
    );
    assert.deepEqual(await editor('return require("electron").BrowserWindow.fromId(args.id).__errors;', { id }), []);
    console.log('PASS: 慢加载首屏、自动归属、跨模块复用、无英文预加载、重新启用、失败与取消、资源清理');
} finally {
    await editor(
        'const w=require("electron").BrowserWindow.fromId(args.id);if(w?.webContents.__yzforgeRuntimeCheck)w.destroy();return true;',
        { id },
    );
}
