// 在真实构建产物上验证导航事务；所有临时钩子、持有和延迟均由用例回收。
export async function verifyNavigation({ run, stage, back }) {
    await stage('scoped UI enforces kinds and short popup owners', () =>
        run(`
const home=record('showcase.showcase-page'),ui=home.show.ui;
const page={id:'showcase.data-lab-page',kind:'page'},popup={id:'showcase.confirm-popup',kind:'popup'};
const expect=async(work,code)=>{let error;try{await work();}catch(e){error=e;}check(error?.code===code,'Expected '+code+', got '+error);};
await expect(()=>ui.open(page,undefined),'UI_PAGE_REQUIRES_NAVIGATION');
await expect(()=>ui.pushPage(popup,{title:'wrong',detail:''}),'UI_NOT_PAGE');
await expect(()=>ui.open(popup,{title:'wrong owner',detail:''},{owner:app.flows}),'UI_OWNER_OUTSIDE_SHOW');
const owner=home.show.scope.child('popup-task');
try{const handle=await ui.open(popup,{title:'任务取消',detail:'验证短期所有者'},{owner});
await owner.close();check((await handle.result).status==='cancelled','Task popup survived task');
check(home.interactive,'Popup task closed its page');}finally{await owner.close();}
const snapshot=home.instance.context.diagnostics.snapshot();
check(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.pages)&&Object.isFrozen(snapshot.modules),'Mutable diagnostics');
check(!home.instance.context.diagnostics.module('workshop').businessReady,'Diagnostics started a module');
return {kinds:true,taskOwner:true,readonlyDiagnostics:true};`),
    );

    await stage('navigation result, duplicate policy and expired display capabilities', async () => {
        const result = await run(`
const home=record('showcase.showcase-page'),show=home.show,load=app.assets.load;
let release,started=false;const gate=new Promise(resolve=>release=resolve);
app.assets.load=function(...args){if(args[0].id==='showcase/default/prefab/ui/data-lab-page'){started=true;return gate.then(()=>load.apply(this,args));}return load.apply(this,args);};
globalThis.__oldNavigationUI=show.ui;
try{
const first=show.run(()=>show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined));
// 阻挡资源加载，确定第一个请求处于准备阶段再提交不同目标。
await until(()=>started);
const repeated=await show.ui.pushPage({id:'showcase.time-lab-page',kind:'page'},undefined);
check(repeated.status==='ignored'&&repeated.reason==='busy','Repeated target borrowed first result');
release();const opened=await first;
check(opened.status==='opened'&&!('result' in opened),'Page facade exposes a close result');
check(show.signal.aborted&&record('showcase.data-lab-page').interactive,'New page died with old show');
return {opened:opened.status,repeated:repeated.status};
}finally{release();app.assets.load=load;}`);
        await back();
        await run(`
try{let error;try{await globalThis.__oldNavigationUI.pushPage({id:'showcase.time-lab-page',kind:'page'},undefined);}catch(e){error=e;}
check(error?.code==='OPERATION_CANCELLED','Old display navigated again');
globalThis.__oldNavigationUI.back();check(app.ui.pages.length===1,'Old back closed the restored page');
return true;}finally{delete globalThis.__oldNavigationUI;}`);
        return result;
    });

    await stage('back cancels pending preparation without popping the source', () =>
        run(`
const home=record('showcase.showcase-page'),show=home.show,load=app.assets.load;
let release,started=false;const gate=new Promise(resolve=>release=resolve);
app.assets.load=function(...args){if(args[0].id==='showcase/default/prefab/ui/data-lab-page'){started=true;return gate.then(()=>load.apply(this,args));}return load.apply(this,args);};
try{const pending=show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined).catch(error=>error.code);
await until(()=>started);show.ui.back();
check(await pending==='OPERATION_CANCELLED','Pending request did not cancel');
check(home.interactive&&app.ui.pages.length===1,'Back popped source while cancelling preparation');
release();await until(()=>![...app.ui.records.values()].some(r=>r.definition.id==='showcase.data-lab-page')&&!app.ui.pendingPage);
check(app.ui.pages.length===1,'Late target appeared');return {cancelled:true,sourcePreserved:true};
}finally{release();app.assets.load=load;}`),
    );

    await stage('closing the source prevents late navigation and reclaims resources', async () => {
        await run(
            "await record('showcase.showcase-page').show.ui.pushPage({id:'showcase.ui-lab-page',kind:'page'},undefined);return true;",
        );
        return run(`
const source=record('showcase.ui-lab-page'),load=app.assets.load;
let release,started=false;const gate=new Promise(resolve=>release=resolve);
app.assets.load=function(...args){if(args[0].id==='showcase/default/prefab/ui/data-lab-page'){started=true;return gate.then(()=>load.apply(this,args));}return load.apply(this,args);};
try{const pending=source.show.run(()=>source.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined)).catch(error=>error.code);
await until(()=>started);source.show.dismiss();
check(await pending==='OPERATION_CANCELLED','Closing source did not cancel');
release();await until(()=>![...app.ui.records.values()].some(r=>r.definition.id==='showcase.data-lab-page')&&![...app.ui.records.values()].some(r=>r.definition.id==='showcase.ui-lab-page')&&record('showcase.showcase-page')?.interactive);
check(app.ui.pages.length===1,'Late navigation changed the stack');return {sourceClosed:true,lateTargetRemoved:true};
}finally{release();app.assets.load=load;}`);
    });

    await stage('failed preparation preserves source and blocks retry until cleanup finishes', async () => {
        const result = await run(`
const C=cc.js.getClassByName('showcase.DataLabPage'),originalShow=C.prototype.onShow,originalHide=C.prototype.onHide;
const home=record('showcase.showcase-page');let release,cleaning=false;
const gate=new Promise(resolve=>release=resolve);
C.prototype.onShow=function(){throw Error('expected navigation preparation failure');};
C.prototype.onHide=async function(...args){cleaning=true;await gate;return originalHide.apply(this,args);};
try{
let failure;try{await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);}catch(e){failure=e;}
check(failure?.message==='expected navigation preparation failure','Preparation failure became cancellation');
await until(()=>cleaning);check(home.interactive&&app.ui.pages.length===1,'Failure hid source');
let retry;try{await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);}catch(e){retry=e;}
check(retry?.code==='UI_CLEANUP_PENDING','Retry raced unfinished cleanup');
release();await until(()=>![...app.ui.records.values()].some(r=>r.definition.id==='showcase.data-lab-page'));
C.prototype.onShow=originalShow;C.prototype.onHide=originalHide;
check((await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined)).status==='opened','Retry did not recover');
return {originalError:true,cleanupBarrier:true,retry:true};
}finally{release();C.prototype.onShow=originalShow;C.prototype.onHide=originalHide;}`);
        await back();
        return result;
    });

    await stage('child activation failure leaves the previous page active', () =>
        run(`
const C=cc.js.getClassByName('showcase.DataLabPage'),G=cc.js.getClassByName('yzforge.GameComponent'),original=C.prototype.onShow;
const home=record('showcase.showcase-page');
C.prototype.onShow=async function(show){
await original.call(this,show);
const target=record('showcase.data-lab-page'),child=new cc.Node('activation-failure');this.node.addChild(child);
const component=child.addComponent(G);component.onActivate=function(){throw Error('expected child activation failure');};
component.__bind(target.instance.context,target.instance.scope,app.time);target.instance.components.push(component);
};
try{let failure;try{await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);}catch(e){failure=e;}
check(failure?.message==='expected child activation failure','Activation failure was lost');
check(home.interactive&&!home.show.signal.aborted&&app.ui.pages.length===1,'Child failure suspended the source');
await until(()=>![...app.ui.records.values()].some(r=>r.definition.id==='showcase.data-lab-page'));
return {sourcePreserved:true,failedTargetRemoved:true};
}finally{C.prototype.onShow=original;}`),
    );

    await stage('initialization cannot reenter navigation and staged page stays hidden', async () => {
        const result = await run(`
const C=cc.js.getClassByName('showcase.DataLabPage'),original=C.prototype.onShow;
let ready,release,denied;const prepared=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
C.prototype.onShow=async function(show){
try{await show.ui.pushPage({id:'showcase.time-lab-page',kind:'page'},undefined);}catch(e){denied=e.code;}
await original.call(this,show);ready();await gate;};
try{const home=record('showcase.showcase-page');const pending=home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);
await prepared;const target=record('showcase.data-lab-page');
check(denied==='UI_NAVIGATION_NOT_READY','onShow reentered navigation');
check(!target.interactive&&target.instance.node.getComponent(cc.UIOpacity).opacity===0&&home.interactive,'Uncommitted target became interactive');
release();check((await pending).status==='opened','Prepared target did not commit');
return {reentryRejected:true,stagedHidden:true};
}finally{release();C.prototype.onShow=original;}`);
        await back();
        return result;
    });
}
