// 独立 Cocos 预览窗口：批量资源、Prefab 池、语言 Bundle 与页面清理。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview, screenshot } from './preview.mjs';

const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), '仅允许当前项目的本机预览或构建地址');
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `
const w=new (require('electron').BrowserWindow)({show:false,width:720,height:1280,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'resources-'+Date.now()}});
w.webContents.__yzforgeRuntimeCheck=true;w.__resourceErrors=[];
w.webContents.on('console-message',(_,level,message)=>{if(level>=3)w.__resourceErrors.push(message);});
try{await w.loadURL(args.url);return w.id;}catch(error){w.destroy();throw error;}`,
    { url: url.href },
);
const run = (code, args = {}) =>
    preview(
        `
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record=id=>Array.from(app.ui.records.values()).find(r=>r.definition.id===id&&!r.termination);
const until=async(test)=>{const end=Date.now()+12000;while(Date.now()<end){if(test())return;await wait(25);}throw Error('Runtime timed out');};
const page=()=>record('showcase.resource-lab-page');
const click=async(field)=>{const p=page();p.instance.view[field].node.emit(cc.Button.EventType.CLICK);await wait(0);await until(()=>!p.show.actions.busy('pool')&&!p.show.actions.busy('prepare')&&!p.show.actions.busy('language'));};
${code}`,
        args,
    );
let originalDevice;
try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
        ready = await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Bootstrap 未就绪');
    originalDevice = await preview(
        'return document.querySelector("#view-select [data-device].selected")?.dataset.device;',
    );
    console.log(
        await run(`
cc.profiler.hideStats();check(app.i18n.locale==='zh-CN','Initial language wrong');
check(!app.assets.inspect().bundles.some(b=>b.includes('extra')),'English bundle loaded eagerly');
record('showcase.showcase-page').instance.view._bindBtnResources.node.emit(cc.Button.EventType.CLICK);
await until(()=>page()?.interactive);await until(()=>!!page().instance.view._bindSprLogo.spriteFrame);
const v=page().instance.view;check(v._bindLblTitle.string===app.i18n.t('resources.title'),'Initial title wrong');
return {stage:'initial',locale:app.i18n.locale,bundles:app.assets.inspect().bundles};`),
    );

    // 通过真实鼠标输入触发一次池预热，验证 Button 和滚动视口命中。
    const pointer = await run(`
const node=page().instance.view._bindBtnWarm.node;
const camera=cc.director.getScene().getComponentsInChildren(cc.Camera).find(c=>(c.visibility&node.layer)!==0);
const point=camera.worldToScreen(node.worldPosition),canvas=cc.game.canvas,rect=canvas.getBoundingClientRect();
return {x:Math.round(rect.left+point.x/canvas.width*rect.width),y:Math.round(rect.top+(1-point.y/canvas.height)*rect.height)};`);
    await editor(
        `const w=require('electron').BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error('Missing test window');
w.webContents.sendInputEvent({type:'mouseMove',x:args.x,y:args.y});
w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:args.x,y:args.y});
w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:args.x,y:args.y});return true;`,
        { id, ...pointer },
    );
    console.log(
        await run(`
const v=page().instance.view;await until(()=>v.pool.inspect().idle===3);
for(let i=0;i<3;i++)await click('_bindBtnSpawn');
check(v.pool.inspect().borrowed===3&&v.pool.inspect().size===3,'Borrow counts wrong');
const nodes=v.leases.map(l=>l.node),scopes=v.leases.map(l=>l.scope);
await click('_bindBtnSpawn');check(v.leases.length===3&&v._bindLblOutput.string.includes('实例池已达'),'Missing capacity guard');
await click('_bindBtnRelease');check(v.pool.inspect().idle===3&&nodes.every(n=>!n.active),'Return failed');
check(scopes.every(s=>s.signal.aborted),'Old borrow scopes survived');
for(let i=0;i<3;i++)await click('_bindBtnSpawn');
check(v.leases.every(l=>nodes.includes(l.node)&&!scopes.includes(l.scope)),'Nodes not reused with new lifetimes');
await click('_bindBtnLoad');check(v._bindLblOutput.string===app.i18n.t('resources.loaded'),'Resource batch not ready');
const sprite=v._bindSprLogo.spriteFrame;
await click('_bindBtnLanguage');await until(()=>v._bindSprLogo.spriteFrame!==sprite);
check(app.i18n.locale==='en'&&v._bindLblTitle.string==='Resources & Languages','English not applied');
check(v._bindLblInfo.string.includes(app.i18n.t('resources.fallback')),'Default text fallback missing');
check(app.assets.inspect().bundles.some(b=>b.includes('extra')),'English bundle missing');
check(app.assets.inspect().resources.some(r=>r.key.includes('locales/en')),'English catalog not retained');
return {stage:'pool-batch-language',pool:v.pool.inspect(),locale:app.i18n.locale};`),
    );
    console.log(await screenshot('resources-localization-english.png'));

    console.log(
        await run(`
const v=page().instance.view,reports=[],originalError=console.error;
console.error=(...args)=>{if(args[0]==='[YZForge]'&&args[1]?.code==='I18N_PREVIOUS_CLEANUP_FAILED'){reports.push(args[1]);return;}originalError.apply(console,args);};
try{
app.i18n.current.scope.defer(()=>{throw Error('Injected old catalog cleanup failure');});
await app.i18n.setLocale('zh-CN',page().show.scope);
check(reports.length===1&&reports[0].details.previousLocale==='en','Cleanup failure not reported separately');
}finally{console.error=originalError;}
await until(()=>!app.assets.inspect().resources.some(r=>r.key.includes('locales/en')));
check(app.i18n.locale==='zh-CN'&&v._bindLblTitle.string===app.i18n.t('resources.title'),'Committed language switch failed');
const owner=page().show.scope.child('resource-failure-check'),key=app.i18n.asset('resources.logo','SpriteFrame');
const snapshot=()=>JSON.stringify(app.assets.inspect().resources.map(r=>({key:r.key,users:r.users})).sort((a,b)=>a.key.localeCompare(b.key)));
const baseline=snapshot();let failure;
try{await app.assets.loadMany({good:key,bad:{id:'showcase/default/sprite/does-not-exist',type:'SpriteFrame'}},owner,{concurrency:1});}catch(e){failure=e;}
check(failure&&snapshot()===baseline,'Failed batch affected existing resources');
let cancelled;try{await app.assets.loadMany({first:key,second:key},owner,{concurrency:1,onProgress:p=>{if(p.completed===1)owner.cancel();}});}catch(e){cancelled=e;}
await owner.close();check(cancelled?.code==='OPERATION_CANCELLED'&&snapshot()===baseline,'Cancelled batch leaked');
return {stage:'batch-rollback-and-catalog-cleanup',failure:failure.code,cancelled:cancelled.code,cleanupReported:reports[0].code};`),
    );

    // 真正的 GameComponent 激活任务结束前，池不得复用或销毁节点。
    console.log(
        await run(`
const p=page(),v=p.instance.view,owner=p.show.scope.child('pool-drain-check');
const pool=v.ctx.assets.in(owner).createPool({id:'showcase/default/prefab/prefabs/badge-part',type:'Prefab'},{maxSize:1,maxIdle:1});
let releaseTask,releaseCleanup,lateCommit=true;
const taskGate=new Promise(resolve=>releaseTask=resolve),cleanupGate=new Promise(resolve=>releaseCleanup=resolve);
const lease=await pool.spawn(v._bindNodePool,owner),node=lease.node,part=node.getComponent('showcase.BadgePart');
check(part.activation,'Pooled Part did not activate');const activation=part.activation;
activation.scope.defer(()=>cleanupGate);
const work=activation.run(async task=>{await taskGate;lateCommit=task.commit(()=>{});}).catch(e=>check(e.code==='OPERATION_CANCELLED','Wrong task cancellation'));
await wait(0);let returned=false;const returning=lease.release().then(()=>{returned=true;});await wait(30);
check(!returned&&activation.signal.aborted&&!node.active&&cc.isValid(node,true),'Premature return or node destruction');
let full;try{await pool.spawn(v._bindNodePool,owner);}catch(e){full=e;}check(full?.code==='POOL_FULL','Returning node reused early');
releaseTask();await wait(30);check(!returned,'Async cleanup barrier skipped');releaseCleanup();await returning;await work;
check(!lateCommit&&pool.inspect().idle===1,'Stale commit or missing idle node');
const again=await pool.spawn(v._bindNodePool,owner);check(again.node===node&&again.scope!==lease.scope,'Reuse failed');
await pool.close();check(again.scope.signal.aborted&&!cc.isValid(node,true),'Pool close failed');await owner.close();
return {stage:'physical-task-drain',reused:true,lateCommit};`),
    );

    // 共享池等待借用方祖先任务，不能在旧页面工作结束前复用同一个节点。
    console.log(
        await run(`
const p=page(),v=p.instance.view,owner=p.show.scope.child('shared-pool-check'),borrower=owner.child('borrower');
const pool=v.ctx.assets.in(owner).createPool({id:'showcase/default/prefab/prefabs/badge-part',type:'Prefab'},{maxSize:1,maxIdle:1});
const lease=await pool.spawn(v._bindNodePool,borrower.child('effects'),{prepare:n=>n.getComponent('showcase.BadgePart').render('first')}),node=lease.node;
let releaseTask;const gate=new Promise(resolve=>releaseTask=resolve);
const work=borrower.track((async()=>{await gate;return node.getComponentInChildren(cc.Label).string;})(),'parent-task');
const closing=borrower.close();await wait(30);
try{
check(!borrower.closed&&!node.active&&cc.isValid(node,true)&&pool.inspect().idle===0,'Shared instance returned before ancestor task ended');
let full;try{await pool.spawn(v._bindNodePool,owner);}catch(e){full=e;}check(full?.code==='POOL_FULL','Shared instance lent to another borrower too early');
}finally{releaseTask();await closing;}
check(await work==='first','Late task observed reused or destroyed node');
const again=await pool.spawn(v._bindNodePool,owner);check(again.node===node,'Shared instance not reusable after drain');
await pool.close();await owner.close();
return {stage:'shared-pool-ancestor-drain',reused:true};`),
    );

    for (const [width, height, device] of [
        [720, 1280, 'Default'],
        [720, 1600, 'OPPO Reno 2'],
        [900, 1200, 'Apple iPad 10.2'],
    ]) {
        await editor(
            'const w=require("electron").BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error("Missing test window");w.setSize(args.width,args.height);return true;',
            { id, width, height },
        );
        console.log(
            await run(
                `
const option=document.querySelector('[data-device="'+args.device+'"]');if(option)option.click();else cc.screen.windowSize=new cc.Size(args.width,args.height);
await wait(250);const v=page().instance.view,scroll=v._bindNodeContent.parent.parent.getComponent(cc.ScrollView);
check(scroll&&scroll.view.height>0&&v._bindBtnBack.node.activeInHierarchy,'Invalid responsive layout');
scroll.scrollToBottom(0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const offset=scroll.getScrollOffset().y,max=scroll.getMaxScrollOffset().y;
if(max>0)check(Math.abs(offset-max)<1,'Last controls unreachable: '+JSON.stringify({offset,max}));
const bounds=v._bindNodePool.getComponent(cc.UITransform).getBoundingBoxToWorld(),viewport=scroll.view.getBoundingBoxToWorld();
check(bounds.yMin>=viewport.yMin-1&&bounds.yMax<=viewport.yMax+1,'Pool extends beyond scroll viewport');
return {stage:'resize',width:args.width,height:args.height,viewport:scroll.view.contentSize};`,
                { width, height, device },
            ),
        );
        console.log(await screenshot(`resources-localization-${width}-${height}.png`));
    }
    console.log(
        await run(`
const p=page(),v=p.instance.view,pool=v.pool,nodes=v.leases.map(l=>l.node);
let releaseTask,exited=false,backDone=false,lateCommit=true;
const gate=new Promise(resolve=>releaseTask=resolve);
const work=p.show.run(async task=>{await gate;check(nodes.every(n=>cc.isValid(n,true)),'Parent task observed destroyed nodes');lateCommit=task.commit(()=>{});exited=true;});
await wait(0);const closing=app.ui.back().completed.then(()=>{backDone=true;});await wait(50);
try{check(!backDone&&!exited&&nodes.every(n=>cc.isValid(n,true)&&!n.active)&&pool.inspect().idle===0,'Page pool reclaimed before show.run ended');}
finally{releaseTask();await work;await closing;}
check(exited&&!lateCommit,'Page task did not drain or committed after cancellation');
await until(()=>record('showcase.showcase-page')?.interactive);
check(pool.inspect().closed&&pool.inspect().size===0&&nodes.every(n=>!cc.isValid(n,true)),'Page did not reclaim pool');
check(!app.assets.inspect().resources.some(r=>r.owners.some(h=>h.label.includes('prepared-resources')||h.label.includes('pooled-instance'))),'Page resource holders leaked');
record('showcase.showcase-page').instance.view._bindBtnResources.node.emit(cc.Button.EventType.CLICK);await until(()=>page()?.interactive);
check(page().instance.view.pool.inspect().size===0,'Reopen inherited old pool');await app.ui.back().completed;
await app.close();check(app.assets.inspect().resources.length===0,'App close leaked resources or catalogs');
return {stage:'cleanup',resources:app.assets.inspect().resources.length};`),
    );
    const errors = await editor('return require("electron").BrowserWindow.fromId(args.id).__resourceErrors;', { id });
    assert.deepEqual(errors, [], '新增运行时错误日志');
    console.log('PASS: 批量资源回收、真实输入、Prefab 复用与父级任务屏障、语言提交与清理异常、回退和页面清理');
} finally {
    try {
        if (originalDevice)
            await preview(
                "const option=document.querySelector('[data-device=\"'+args.device+'\"]');if(option)option.click();return true;",
                { device: originalDevice },
            );
    } finally {
        await editor(
            'const w=require("electron").BrowserWindow.fromId(args.id);if(w?.webContents.__yzforgeRuntimeCheck)w.destroy();return true;',
            { id },
        );
        delete process.env.YZFORGE_BUILT_RUNTIME;
    }
}
