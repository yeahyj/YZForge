// Integration checks for the supplied example application, not runtime framework dependencies.
import assert from 'node:assert/strict';
import { preview, screenshot } from './preview.mjs';

// 此组深层回归以综合大厅为独立首屏；新项目默认首页是功能展示。
await preview(`
if([...app.ui.records.values()].some(r=>r.definition.id==='showcase.showcase-page')) {
    while(app.ui.inspect().pages.length) await app.ui.back().completed;
    await app.ui.pushPage({id:'lobby.dashboard',kind:'page'},{title:'综合回归'},app.flows);
}
return true;`);

const results = [];
async function verify(name, code) {
    const data = await preview(
        `if(!app)throw Error('Bootstrap is not ready'); if(document.hidden||cc.game.isPaused()||app.clock.background)throw Error('Game View must be visible and running for integration checks'); const check=(value,message)=>{if(!value)throw Error(message);}; const deadline=(pending)=>Promise.race([pending,new Promise((_,no)=>setTimeout(()=>no(Error('Integration deadline exceeded')),8000))]); ${code}`,
    );
    assert.equal(data.ok, true, name);
    results.push({ name, ...data });
    console.log(JSON.stringify({ name, ...data }));
}
await verify(
    'automatic inherited binding, lazy bundle, JSON table and SpriteFrame',
    `
const record=[...app.ui.records.values()].find(r=>r.definition.id==='lobby.dashboard');
check(record?.interactive,'Dashboard not interactive'); check(record.instance.view._bindBtnReward instanceof cc.Button,'Inherited Button binding missing');
check(record.instance.view._bindSprIcon.spriteFrame,'Dynamic SpriteFrame not loaded');check(record.instance.view._bindLblItems.string.includes('3 条配置'),'Configuration did not load');
return {ok:true,bindings:Object.keys(record.instance.view).filter(k=>k.startsWith('_bind')).length,resources:app.assets.cache.retainedCount};`,
);
await verify(
    'popup params/result and physical resource release',
    `
const owner=app.flows.child('verify-popup'), baseline=app.assets.cache.retainedCount;
const handle=await app.ui.open({id:'lobby.reward-popup',kind:'popup'},{title:'集成验证',amount:123},owner);
const record=[...app.ui.records.values()].find(r=>r.handle===handle);
check(record.instance.view._bindLblAmount.string.includes('123'),'Popup params not displayed');
record.instance.view._bindBtnConfirm.node.emit(cc.Button.EventType.CLICK);
const result=await deadline(handle.result);check(result.status==='completed'&&result.value.amount===123,'Wrong popup result');
await owner.close();check(!app.ui.records.has(record.id),'Active record survived close');check(app.assets.cache.retainedCount===baseline,'Prefab resources still retained');
return {ok:true,result,resources:app.assets.cache.retainedCount};`,
);
await verify(
    'early finish in onShow never commits an interactive view',
    `
const C=cc.js.getClassByName('lobby.RewardPopup'), saved=C.prototype.onShow, owner=app.flows.child('verify-early');let showed=false;
try { C.prototype.onShow=function(show){show.finish({claimed:true,amount:7});};
 const handle=await deadline(app.ui.open({id:'lobby.reward-popup',kind:'popup'},{title:'Early',amount:7},owner));const result=await handle.result;
 check(result.status==='completed'&&result.value.amount===7,'Early result failed');check(![...app.ui.records.values()].some(r=>r.handle===handle),'Early view leaked');return {ok:true,result};
} finally {C.prototype.onShow=saved;await owner.close();}`,
);
await verify(
    'duplicate open rejected and one caller cancellation preserves existing UI',
    `
const a=app.flows.child('verify-first'),b=app.flows.child('verify-second');
try {const first=await app.ui.open({id:'lobby.reward-popup',kind:'popup'},{title:'Existing',amount:1},a);let code;
try{await app.ui.open({id:'lobby.reward-popup',kind:'popup'},{title:'Duplicate',amount:2},b);}catch(e){code=e.code;}
check(code==='UI_ALREADY_OPEN','Duplicate was not rejected');await b.close();check([...app.ui.records.values()].some(r=>r.handle===first&&r.interactive),'Second owner closed the first UI');
await first.close();return{ok:true,code};}finally{await a.close();await b.close();}`,
);
await verify(
    'audio natural completion returns clip pin and pool source clears clip',
    `
const owner=app.flows.child('verify-audio'),baseline=app.assets.cache.retainedCount;
try {const handle=await app.audio.play({id:'lobby/default/audio/confirm',type:'AudioClip'},owner);app.audio.resumeFromGesture();const end=await deadline(handle.ended);
check(end==='ended','Audio did not reach its natural end');check(app.audio.playing.size===0,'Audio handle remained active');check(app.audio.free.every(s=>s.clip===null),'Pooled source retained a clip');
check(app.assets.cache.retainedCount===baseline,'Clip resource lease remained');return{ok:true,end,poolSize:app.audio.free.length};}finally{await owner.close();}`,
);
await verify(
    'a parent listener waiting on a child result drains when parent closes',
    `
const parent=[...app.ui.records.values()].find(r=>r.definition.id==='lobby.dashboard');
parent.instance.view._bindBtnReward.node.emit(cc.Button.EventType.CLICK);
await new Promise(resolve=>setTimeout(resolve,150));check([...app.ui.records.values()].some(r=>r.definition.id==='lobby.reward-popup'),'Child popup did not open');
await deadline(parent.handle.close());check(app.ui.records.size===0,'Nested UI records survived');
const reopened=await app.ui.pushPage({id:'lobby.dashboard',kind:'page'},{title:'YZForge'},app.flows);check(!!reopened,'Dashboard failed to reopen');
return{ok:true,activeViews:app.ui.records.size};`,
);
await verify(
    'page navigation from a tracked handler avoids self-wait and resumes its previous page',
    `
const id='lobby.verification-page',source=app.ui.definitions.get('lobby.reward-popup'),owner=app.flows.child('verify-pages');
const previous=app.ui.pages.at(-1);app.ui.definitions.set(id,{...source,id,kind:'page'});
try {
 const handle=await deadline(previous.show.run(()=>app.ui.pushPage({id,kind:'page'},{title:'Navigation',amount:1},owner)));
 check(previous.suspended&&!previous.interactive,'Previous page remained interactive');
 await deadline(app.ui.back().completed);check(previous.interactive&&!previous.suspended,'Back did not resume previous page');
 check((await handle.result).status==='cancelled','Back result mismatch');return{ok:true,activePages:app.ui.pages.length};
} finally {await owner.close();app.ui.definitions.delete(id);}`,
);
await verify(
    'UI timeout isolates a module while retaining resources until physical cleanup',
    `
const C=cc.js.getClassByName('lobby.RewardPopup'),saved=C.prototype.onHide,timeout=app.ui.cleanupTimeoutMs,owner=app.flows.child('verify-timeout');
let release,closing;const gate=new Promise(resolve=>release=resolve);const baseline=app.assets.cache.retainedCount;
try{
 C.prototype.onHide=async()=>{await gate;};app.ui.cleanupTimeoutMs=30;
 const handle=await app.ui.open({id:'lobby.reward-popup',kind:'popup'},{title:'Timeout',amount:1},owner);closing=handle.close();
 const result=await deadline(handle.result);check(result.status==='failed'&&result.cleanupPending,'Logical timeout missing');
 check(app.assets.cache.retainedCount>baseline,'Assets released while onHide still running');
 let code;try{await app.modules.use({id:'lobby'},owner);}catch(e){code=e.code;}
 check(code==='MODULE_CLEANUP_PENDING','Module allowed new use during draining');
 release();await deadline(closing);check(app.assets.cache.retainedCount===baseline,'Physical close retained UI resources');return{ok:true,code};
}finally{release();C.prototype.onHide=saved;app.ui.cleanupTimeoutMs=timeout;if(closing)await closing;await owner.close();}`,
);
await verify(
    'repeated popup closure unregisters long-lived owner cleanup callbacks',
    `
const baseline=app.flows.cleanups.size;
for(let index=0;index<5;index++){const handle=await app.ui.open({id:'lobby.reward-popup',kind:'popup'},{title:'Repeat',amount:index},app.flows);await handle.close();}
check(app.flows.cleanups.size===baseline,'Closed popups retained by app owner');return{ok:true,ownerCleanups:baseline};`,
);
await verify(
    'atlas frame leases retain the atlas and requested frame together',
    `
const bundle=await app.assets.prepareBundle('m-lobby'),saved=bundle.load,owner=app.flows.child('verify-atlas');
const frame=[...app.ui.records.values()].find(r=>r.definition.id==='lobby.dashboard').instance.view._bindSprIcon.spriteFrame;
const atlas=new cc.SpriteAtlas();atlas.spriteFrames={icon:frame};const baseline=frame.refCount;
try{
 bundle.load=function(path,type,callback){if(path==='__verify_atlas'){callback(null,atlas);return;}return saved.apply(this,arguments);};
 const loaded=await app.assets.loadAddress({bundle:'m-lobby',path:'__verify_atlas',type:'SpriteFrame',atlasFrame:'icon'},owner);
 check(loaded===frame&&atlas.refCount===1&&frame.refCount===baseline+1,'Atlas/frame pins not acquired together');
 await owner.close();check(atlas.refCount===0&&frame.refCount===baseline,'Atlas/frame pins not released together');return{ok:true};
}finally{bundle.load=saved;await owner.close();}`,
);
await verify(
    'back requested inside its tracked page callback never waits on itself and duplicate requests close one page',
    `
const id='lobby.verification-back',source=app.ui.definitions.get('lobby.reward-popup'),owner=app.flows.child('verify-back');
const previous=app.ui.pages.at(-1);app.ui.definitions.set(id,{...source,id,kind:'page'});
try {
 const handle=await app.ui.pushPage({id,kind:'page'},{title:'Return',amount:1},owner);const page=app.ui.pages.at(-1);let completed;
 await deadline(page.show.run(async()=>{const request=await app.ui.back();completed=request.completed;app.ui.back();}));
 await deadline(completed);check((await handle.result).status==='cancelled','Return result mismatch');
 check(previous.interactive&&!previous.suspended&&app.ui.inspect().pages.length===1,'Duplicate return closed the previous page');
 return{ok:true};
} finally {await owner.close();app.ui.definitions.delete(id);}`,
);
await verify(
    'recoverable button failures leave the page open and a subsequent attempt succeeds',
    `
const page=[...app.ui.records.values()].find(record=>record.definition.id==='lobby.dashboard');
const target=new cc.Node('verify-action');let attempts=0,errors=0,success=0;
const off=page.show.listen(target,'try',async()=>{attempts++;if(attempts===1)throw Error('expected offline');success++;},()=>{errors++;});
try{target.emit('try');await new Promise(yes=>setTimeout(yes,20));check(errors===1&&page.interactive,'Recoverable failure closed the page');target.emit('try');await new Promise(yes=>setTimeout(yes,20));check(success===1,'Retry failed');return{ok:true,attempts,errors,success};}
finally{off();target.destroy();}`,
);
await verify(
    'dynamic Part instances release independently and direct node destruction also returns their leases',
    `
const page=[...app.ui.records.values()].find(record=>record.definition.id==='lobby.dashboard'),show=page.show;
const count=()=>app.assets.inspect().resources.find(item=>item.key.includes('WalletPart'))?.users??0;
const before=count(),children=show.scope.inspect().children.length,key={id:'lobby/default/prefab/prefabs/wallet-part',type:'Prefab'};
for(let index=0;index<6;index++){
 const node=await show.assets.instantiate(key,page.instance.node,{active:false});check(count()===before+1,'Part lease not acquired');
 if(index%2===0)await deadline(show.assets.destroyInstance(node));
 else{node.destroy();for(let retry=0;retry<100&&count()!==before;retry++)await new Promise(yes=>setTimeout(yes,10));}
 check(count()===before,'Part retained after destruction');
}
check(show.scope.inspect().children.length===children,'Destroyed Part scopes accumulated');
return{ok:true,retainedOwners:before,iterations:6};`,
);
await verify(
    'common configuration is available without its business factory and shared profile updates dynamic Parts',
    `
const diagnostics=app.inspect();check(!diagnostics.modules.some(module=>module.id==='common'),'Reading common config initialized its business factory');
check(diagnostics.assets.resources.some(item=>item.key.includes('m-common')&&item.key.includes('economy')),'Common config not loaded');
const owner=app.flows.child('verify-profile'),handle=await app.modules.use({id:'profile'},owner),original=handle.api.snapshot().coins;
try{handle.api.changeCoins(1);const page=[...app.ui.records.values()].find(record=>record.definition.id==='lobby.dashboard');const Part=cc.js.getClassByName('lobby.WalletPart');const part=page.instance.node.getComponentInChildren(Part);check(part._bindLblBalance.string.includes(String(original+1)),'Shared state did not update Part');return{ok:true,commonFactoryStarted:false,coins:original+1};}
finally{handle.api.changeCoins(original-handle.api.snapshot().coins);await owner.close();}`,
);
console.log(
    JSON.stringify(
        { passed: results.length, results, screenshot: await screenshot('yzforge-verified-dashboard.png') },
        null,
        2,
    ),
);
