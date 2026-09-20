import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const url=new URL(process.argv[2]);assert.equal(url.hostname,'127.0.0.1');
const requestOffset=(await(await fetch(new URL('/__requests',url))).json()).length;
const output=await call('execute_javascript',{context:'editor',args:{url:url.href},code:`return await (async()=>{
  const BrowserWindow=require('electron').BrowserWindow;
  const window=new BrowserWindow({show:false,width:720,height:1280,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
  const errors=[];window.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});
  try{
    await window.loadURL(args.url);
    await window.webContents.executeJavaScript('globalThis.__buildErrors=[];const priorError=console.error;console.error=(...args)=>{__buildErrors.push(args.map(value=>value?.stack||String(value)).join(" "));priorError(...args)};addEventListener("unhandledrejection",event=>__buildErrors.push(event.reason?.stack||String(event.reason)));');
    let state;const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      state=await window.webContents.executeJavaScript('(async()=>{if(!globalThis.System)return null;try{const cc=await System.import("cc"),root=cc.director.getScene()?.getChildByName("GameRoot"),app=root?.getComponent("game.GameRoot")?.app;if(!app)return null;const ui=[...app.ui.records.values()].find(r=>r.definition.id==="lobby.dashboard");if(!ui?.interactive)return null;globalThis.__verifyBuilt={cc,app};return{appId:app.storage.prefix,bindings:Object.keys(ui.instance.view).filter(k=>k.startsWith("_bind")).length,config:ui.instance.view._bindLblItems.string,sprite:!!ui.instance.view._bindSprIcon.spriteFrame};}catch(error){return {error:String(error)}}})()');
      if(state)break;await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(!state||state.error){const diagnostics=await window.webContents.executeJavaScript('(async()=>{const cc=globalThis.System?await System.import("cc"):null;return{errors:globalThis.__buildErrors,hidden:document.hidden,ready:document.readyState,title:document.title,canvas:!!document.querySelector("canvas"),paused:cc?.game?.isPaused(),scene:cc?.director?.getScene()?.name,roots:cc?.director?.getScene()?.children.map(n=>({name:n.name,components:n.components.map(c=>c.constructor.name)}))};})()');throw Error(JSON.stringify({state,errors,diagnostics}));}
    const initialRequests=await window.webContents.executeJavaScript('fetch("/__requests").then(response=>response.json())');
    const result=await window.webContents.executeJavaScript('(async()=>{const{cc,app}=globalThis.__verifyBuilt;const owner=app.flows.child("built-smoke");try{const h=await app.ui.open({id:"lobby.reward-popup"},{title:"Build check",amount:321},owner);const r=[...app.ui.records.values()].find(r=>r.handle===h);r.instance.view._bindBtnConfirm.node.emit(cc.Button.EventType.CLICK);return await h.result;}finally{await owner.close();}})()');
    await window.webContents.executeJavaScript('globalThis.__verifyBuilt.cc.profiler.hideStats();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');
    const screenshot=require('path').join(Editor.Project.path,'temp','mcp-captures','yzforge-web-build.png');
    require('fs').writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG());
    return {state,result,errors,screenshot,initialRequests};
  }finally{window.destroy();}
})();`});
const value=output.data;assert.equal(value.state.sprite,true);assert.equal(value.state.bindings,9);assert.equal(value.result.status,'completed');assert.equal(value.result.value.amount,321);assert.deepEqual(value.errors,[]);
const requests=(await(await fetch(new URL('/__requests',url))).json()).slice(requestOffset);
value.initialRequests=value.initialRequests.slice(requestOffset);
assert.ok(!value.initialRequests.some(item=>item.includes('0505cd73-cb77-404c-a4ec-b2f75ec5a5a2')||item.endsWith('.wav')),'Unrequested popup/audio were loaded at startup');
assert.ok(requests.some(item=>item.includes('/assets/m-lobby/')),'Built module bundle was not requested');
console.log(JSON.stringify({ok:true,...value,requests},null,2));
