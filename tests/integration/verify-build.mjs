import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1');
const requestOffset = (await (await fetch(new URL('/__requests', url))).json()).length;
const output = await call('execute_javascript', {
    context: 'editor',
    args: { url: url.href, fixture: process.argv[3] },
    code: `return await (async()=>{
  const BrowserWindow=require('electron').BrowserWindow;
  const window=new BrowserWindow({show:false,width:720,height:1280,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
  const errors=[];window.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});
  try{
    await window.loadURL(args.url);
    await window.webContents.executeJavaScript('globalThis.__buildErrors=[];const priorError=console.error;console.error=(...args)=>{__buildErrors.push(args.map(value=>value?.stack||String(value)).join(" "));priorError(...args)};addEventListener("unhandledrejection",event=>__buildErrors.push(event.reason?.stack||String(event.reason)));');
    let state;const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      state=await window.webContents.executeJavaScript('(async()=>{if(!globalThis.System)return null;try{const cc=await System.import("cc"),root=cc.director.getScene()?.getChildByName("GameRoot"),app=root?.getComponent("game.GameRoot")?.app;if(!app)return null;if(![...app.ui.records.values()].some(r=>r.definition.id==="lobby.dashboard")&&[...app.ui.records.values()].some(r=>r.definition.id==="showcase.showcase-page"&&r.interactive))await app.ui.pushPage({id:"lobby.dashboard"},{title:"综合回归"},app.flows);const ui=[...app.ui.records.values()].find(r=>r.definition.id==="lobby.dashboard");if(!ui?.interactive)return null;globalThis.__verifyBuilt={cc,app};return{appId:app.storage.prefix,bindings:Object.keys(ui.instance.view).filter(k=>k.startsWith("_bind")).length,config:ui.instance.view._bindLblItems.string,sprite:!!ui.instance.view._bindSprIcon.spriteFrame};}catch(error){return {error:String(error)}}})()');
      if(state)break;await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(!state||state.error){const diagnostics=await window.webContents.executeJavaScript('(async()=>{const cc=globalThis.System?await System.import("cc"):null;return{errors:globalThis.__buildErrors,hidden:document.hidden,ready:document.readyState,title:document.title,canvas:!!document.querySelector("canvas"),paused:cc?.game?.isPaused(),scene:cc?.director?.getScene()?.name,roots:cc?.director?.getScene()?.children.map(n=>({name:n.name,components:n.components.map(c=>c.constructor.name)}))};})()');throw Error(JSON.stringify({state,errors,diagnostics}));}
    const initialRequests=await window.webContents.executeJavaScript('fetch("/__requests").then(response=>response.json())');
    const result=await window.webContents.executeJavaScript('(async()=>{const{cc,app}=globalThis.__verifyBuilt;const owner=app.flows.child("built-smoke");try{const h=await app.ui.open({id:"lobby.reward-popup"},{title:"Build check",amount:321},owner);const r=[...app.ui.records.values()].find(r=>r.handle===h);r.instance.view._bindBtnConfirm.node.emit(cc.Button.EventType.CLICK);return await h.result;}finally{await owner.close();}})()');
    let codeBundle=null;
    if(args.fixture){await window.webContents.executeJavaScript('globalThis.__fixture='+JSON.stringify(args.fixture));codeBundle=await window.webContents.executeJavaScript("(async()=>{     const {cc,app}=globalThis.__verifyBuilt, id=globalThis.__fixture;     const check=(value,message)=>{if(!value)throw Error(message);};     const baseline={codeReady:app.modules.isCodeReady(id),businessReady:app.modules.isReady(id),classRegistered:!!cc.js.getClassByName(id+'.ItemPart')};     check(!baseline.codeReady&&!baseline.businessReady&&!baseline.classRegistered,'Private code was eager');     const owner=app.flows.child('code-bundle-verification'),saved=app.modules.loadFactory;let loads=0,starts=0;     app.modules.loadFactory=async(def,scope)=>{const factory=await saved(def,scope);if(def.id!==id)return factory;loads++;return(...args)=>{starts++;return factory(...args);};};     try{         const parent=[...app.ui.records.values()].find(r=>r.definition.id==='lobby.dashboard').instance.view.node;         const assets=app.assets.in(owner,id+'/default','lobby');         const node=await assets.instantiate({id:id+'/default/prefab/prefabs/item-part',type:'Prefab'},parent);         const part=node.getComponent(id+'.ItemPart');         check(part?.ctx.id==='lobby','Resource owner replaced the business host');         check(part._bindLblTitle?.string==='Part binding','Part inherited binding failed');         check(app.modules.isCodeReady(id)&&!app.modules.isReady(id)&&starts===0,'Loading Part started its code owner business factory');         for(let i=0;i<2;i++){const h=await app.ui.open({id:id+'.reward-popup'},undefined,owner);await h.close();}         check(loads===1&&starts===2,'Code loading and business lifetime were not independent');         return {baseline,loads,starts,host:part.ctx.id,bound:!!part._bindLblTitle};     }finally{app.modules.loadFactory=saved;await owner.close();} })()");}
    await window.webContents.executeJavaScript('globalThis.__verifyBuilt.cc.profiler.hideStats();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');
    const screenshot=require('path').join(Editor.Project.path,'temp','mcp-captures','yzforge-web-build.png');
    require('fs').writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG());
    return {state,result,errors,screenshot,initialRequests,codeBundle};
  }finally{window.destroy();}
})();`,
});
const value = output.data;
assert.equal(value.state.sprite, true);
assert.equal(value.state.bindings, 10);
assert.equal(value.result.status, 'completed');
assert.equal(value.result.value.amount, 321);
assert.deepEqual(value.errors, []);
if (process.argv[3]) {
    assert.equal(value.codeBundle.loads, 1);
    assert.equal(value.codeBundle.starts, 2);
    assert.equal(value.codeBundle.host, 'lobby');
}
const requests = (await (await fetch(new URL('/__requests', url))).json()).slice(requestOffset);
value.initialRequests = value.initialRequests.slice(requestOffset);
assert.ok(
    !value.initialRequests.some(
        (item) => item.includes('0505cd73-cb77-404c-a4ec-b2f75ec5a5a2') || item.endsWith('.wav'),
    ),
    'Unrequested popup/audio were loaded at startup',
);
assert.ok(
    requests.some((item) => item.includes('/assets/m-lobby/')),
    'Built module bundle was not requested',
);
console.log(JSON.stringify({ ok: true, ...value, requests }, null, 2));

if (process.argv[3]) {
    const code = '/assets/code-' + process.argv[3] + '/index.js';
    assert.ok(!value.initialRequests.includes(code), 'Optional code was requested during startup');
    assert.equal(requests.filter((request) => request === code).length, 1, 'Code bundle was not loaded exactly once');
    console.log(JSON.stringify({ codeBundleRuntimeVerified: true, fixture: process.argv[3], code }));
}
