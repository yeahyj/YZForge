// 真实渲染帧与显示期检查；延迟、错误和运行时钩子仅存在于隔离的测试窗口。
const probes = `
const frame=()=>new Promise(resolve=>cc.director.once(cc.Director.EVENT_AFTER_DRAW,resolve));
const frames=async count=>{for(let i=0;i<count;i++)await frame();};
const visible=r=>cc.isValid(r.instance?.node,true)&&r.instance.node.activeInHierarchy&&cc.isValid(r.instance.container,true)&&r.instance.container.getComponent(cc.UIOpacity).opacity>0;
const watch=()=>{
 const bad=[];let count=0;
 const sample=()=>{count++;const pages=[...app.ui.records.values()].filter(r=>r.definition.kind==='page');
 const shown=pages.filter(visible).map(r=>r.definition.id),interactive=pages.filter(r=>r.interactive).map(r=>r.definition.id);
 if(shown.length!==1||interactive.length>1)bad.push({shown,interactive});};
 cc.director.on(cc.Director.EVENT_BEFORE_DRAW,sample);
 return {stop:()=>cc.director.off(cc.Director.EVENT_BEFORE_DRAW,sample),result:()=>{check(count>0,'No render frames observed');check(!bad.length,'Invalid navigation frames: '+JSON.stringify(bad));return {frames:count,blankOrOverlappingFrames:bad.length};}};
};
`;

export async function verifyReturnNavigation({ run, stage, back }) {
    const probe = (code) => run(probes + code);
    await stage('return, dismiss, finish and handle close have no empty render frame', () =>
        probe(`
const ui=app.ui,id='showcase.data-lab-page',original=ui.definitions.get(id),results=[];
check(!ui.cache.has(id),'Unexpected cached fixture');
let cachedNode;
try{
 for(const [method,cache] of [['button','none'],['dismiss','none'],['finish','none'],['handle','none'],['button','keep-one'],['button','keep-one']]){
  ui.definitions.set(id,{...original,cache});
  await record('showcase.showcase-page').show.ui.pushPage({id,kind:'page'},undefined);await frame();
  const source=record(id),oldShow=source.show,monitor=watch();
  if(cache==='keep-one'&&cachedNode)check(source.instance.node===cachedNode,'Cache did not reuse the same instance');
  try{
   if(method==='button')source.instance.view._bindBtnBack.node.emit(cc.Button.EventType.CLICK);
   else if(method==='dismiss')source.show.dismiss();
   else if(method==='finish')source.show.finish(undefined);
   else void source.handle.close();
   await until(()=>record('showcase.showcase-page')?.interactive);
   const outcome=await source.handle.result;await frames(2);
   check(outcome.status===(method==='finish'?'completed':'cancelled'),'Page result changed');
   check(oldShow.signal.aborted&&!oldShow.commit(()=>{}),'Old display can still commit');
   if(cache==='keep-one'){cachedNode=source.instance.node;check(ui.cache.get(id)?.node===cachedNode,'Cache lost the retired instance');}
   else check(!cc.isValid(source.instance.node),'Uncached page survived cleanup');
   results.push({method,cache,...monitor.result()});
  }finally{monitor.stop();}
 }
 return results;
}finally{
 ui.definitions.set(id,original);
 const cached=ui.cache.get(id);if(cached){ui.cache.delete(id);await ui.dispose(cached);}
}`),
    );

    await stage('slow return preserves localized content and coalesces duplicate requests', () =>
        probe(`
const ui=app.ui,home=record('showcase.showcase-page');
await home.show.ui.pushPage({id:'showcase.localization-lab-page',kind:'page'},undefined);await frame();
const source=record('showcase.localization-lab-page'),oldShow=source.show,view=home.instance.view,original=view.onShow;
const renderers=source.instance.node.getComponentsInChildren(cc.UIRenderer);
const before=renderers.map(r=>({renderer:r,enabled:r.enabled,frame:r instanceof cc.Sprite?r.spriteFrame:undefined}));
let release,entered=false;const gate=new Promise(resolve=>release=resolve);
view.onShow=async function(show){entered=true;await gate;return original.call(this,show);};
const monitor=watch();
try{
 const first=ui.back(),second=ui.back();check(first.completed===second.completed,'Repeated back was queued');
 await until(()=>entered);await frames(4);
 check(visible(source)&&!source.interactive&&!oldShow.signal.aborted,'Source was hidden or cancelled before preparation finished');
 check(!visible(home)&&!home.interactive,'Previous page was published before it was ready');
 check(ui.pages.length===2&&ui.pages[1]===source,'Preparation changed the page stack');
 for(const item of before){check(item.renderer.enabled===item.enabled,'Localized renderer disappeared');if(item.frame)check(item.renderer.spriteFrame===item.frame,'Sprite released before handoff');}
 const ignored=await oldShow.ui.pushPage({id:'showcase.time-lab-page',kind:'page'},undefined);
 check(ignored.status==='ignored','A second navigation entered during return');
 release();await first.completed;await frames(2);
 check(home.interactive&&oldShow.signal.aborted&&ui.pages.length===1,'Return did not commit once');
 return {...monitor.result(),renderersPreserved:before.length,duplicateMerged:true};
}finally{release();view.onShow=original;monitor.stop();}`),
    );

    await stage('returning to localization prepares its new display before publishing', async () => {
        const result = await probe(`
const ui=app.ui;
await record('showcase.showcase-page').show.ui.pushPage({id:'showcase.localization-lab-page',kind:'page'},undefined);
const target=record('showcase.localization-lab-page'),oldShow=target.show;
await target.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);
const source=record('showcase.data-lab-page'),original=target.instance.view.onShow;
let release,entered=false;const gate=new Promise(resolve=>release=resolve);
target.instance.view.onShow=async function(show){await original.call(this,show);entered=true;await gate;};
const monitor=watch();
try{
 const returning=ui.back();await until(()=>entered);await frames(3);
 check(visible(source)&&!visible(target),'Prepared localization leaked through current page');
 release();await returning.completed;await frames(2);
 check(target.show!==oldShow&&oldShow.signal.aborted,'Restored page reused cancelled show');
 check(target.instance.view._bindSprDynamic.spriteFrame&&target.instance.view._bindLblDynamic.string,'Dynamic localized content was not prepared');
 const Localized=cc.js.getClassByName('yzforge.LocalizedComponent');
 const components=target.instance.node.getComponentsInChildren(Localized);
 check(components.length>0&&components.every(c=>!c.key||c.getComponent(cc.UIRenderer).enabled),'Static localized content was not prepared');
 return {...monitor.result(),localizedComponents:components.length};
}finally{release();target.instance.view.onShow=original;monitor.stop();}`);
        await back();
        return result;
    });

    await stage('failed return preserves stack, blocks dirty preparation reuse, then retries', () =>
        probe(`
const ui=app.ui,home=record('showcase.showcase-page'),view=home.instance.view,host=home.instance.host;
const originalShow=view.onShow,originalHide=view.onHide,originalPrepare=host.prepare,report=ui.report,timeout=ui.cleanupTimeoutMs;
const reported=[],results=[];ui.report=error=>{if(error.message.startsWith('expected return ')||error.code==='UI_CLEANUP_PENDING')reported.push(error);else report(error);};
try{
 for(const failureAt of ['onShow','components']){
  ui.cleanupTimeoutMs=failureAt==='components'?60:timeout;
  await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);
  const source=record('showcase.data-lab-page'),oldShow=source.show,stack=[...ui.pages];
  let attemptedShow,releaseHide;const hideGate=new Promise(resolve=>releaseHide=resolve);
  view.onShow=async function(show){attemptedShow=show;if(failureAt==='onShow')throw Error('expected return onShow failure');await originalShow.call(this,show);};
  host.prepare=async function(){await originalPrepare.call(this);if(failureAt==='components')throw Error('expected return components failure');};
  view.onHide=async function(context){if(context.reason==='failed')await hideGate;await originalHide.call(this,context);};
  const monitor=watch();
  try{
   let failure;try{await ui.back().completed;}catch(error){failure=error;}
   check(failure?.message==='expected return '+failureAt+' failure','Preparation error was lost');
   check(source.interactive&&visible(source)&&source.show===oldShow&&!oldShow.signal.aborted,'Failed return ended source display');
   check(ui.pages.length===stack.length&&ui.pages.every((r,i)=>r===stack[i]),'Failed return changed the stack');
   check(attemptedShow.signal.aborted&&home.suspended,'Failed preparation was left active');await frames(3);
   let retry;try{await ui.back().completed;}catch(error){retry=error;}
   check(retry?.code==='UI_CLEANUP_PENDING','Retry overlapped unfinished preparation cleanup');
   if(failureAt==='components'){
    await until(()=>home.faultPending);
    check(ui.blocked.has(home.definition.id)&&cc.isValid(home.instance.node)&&!home.instance.scope.closed,'Deadline released or reused dirty resources');
   }
   releaseHide();await until(()=>!home.resetting);
   check(!home.faultPending&&!ui.blocked.has(home.definition.id),'Drained preparation remained quarantined');
   view.onShow=originalShow;view.onHide=originalHide;host.prepare=originalPrepare;
   await ui.back().completed;await frames(2);
   check(home.interactive&&!home.termination&&!attemptedShow.commit(()=>{}),'Retry did not establish a fresh display');
   results.push({failureAt,...monitor.result()});
  }finally{releaseHide();monitor.stop();view.onShow=originalShow;view.onHide=originalHide;host.prepare=originalPrepare;}
 }
 check(reported.length===5,'Expected preparation, retry and deadline errors were not reported');return results;
}finally{view.onShow=originalShow;view.onHide=originalHide;host.prepare=originalPrepare;ui.report=report;ui.cleanupTimeoutMs=timeout;}`),
    );

    await stage('slow cleanup pins old resources without blocking the new page or navigation', () =>
        probe(`
const ui=app.ui,home=record('showcase.showcase-page');
await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);
const source=record('showcase.data-lab-page'),oldShow=source.show,originalHide=source.instance.view.onHide;
let releaseTask,releaseHide,hideEntered=false,completed=false;
const taskGate=new Promise(resolve=>releaseTask=resolve),hideGate=new Promise(resolve=>releaseHide=resolve);
const work=oldShow.run(()=>taskGate);
source.instance.view.onHide=async function(context){hideEntered=true;await hideGate;await originalHide.call(this,context);};
const monitor=watch();
try{
 const returning=ui.back();void returning.completed.then(()=>{completed=true;});
 await until(()=>home.interactive);await frames(3);
 check(oldShow.signal.aborted&&!completed&&cc.isValid(source.instance.node)&&!source.instance.scope.closed,'Cleanup released an instance with pending tasks');
 check(!oldShow.commit(()=>{}),'Old display can write after handoff');
 await home.show.ui.pushPage({id:'showcase.time-lab-page',kind:'page'},undefined);
 await ui.back().completed;check(home.interactive&&!completed,'Old cleanup blocked new navigation');
 releaseTask();await work;await until(()=>hideEntered);await frames(2);
 check(cc.isValid(source.instance.node)&&!completed,'Async onHide lost its resources');
 releaseHide();await returning.completed;await frames(2);
 check(completed&&!cc.isValid(source.instance.node)&&source.instance.scope.closed,'Old instance did not finish cleanup');
 return {...monitor.result(),cleanupBarrier:true,newNavigationAllowed:true};
}finally{releaseTask();releaseHide();source.instance.view.onHide=originalHide;monitor.stop();}`),
    );

    await stage('cleanup failure reports a failed result without rolling back the visible page', () =>
        probe(`
const ui=app.ui,home=record('showcase.showcase-page'),report=ui.report;let reported=0;
ui.report=error=>{if(error.message==='expected return cleanup failure')reported++;else report(error);};
await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);
const source=record('showcase.data-lab-page'),original=source.instance.view.onHide,monitor=watch();
source.instance.view.onHide=()=>{throw Error('expected return cleanup failure');};
try{
 let failure;try{await ui.back().completed;}catch(error){failure=error;}
 await frames(2);check(failure?.message==='expected return cleanup failure','Cleanup failure was swallowed');
 check((await source.handle.result).status==='failed'&&reported===1,'Failed cleanup result/report missing');
 check(home.interactive&&ui.pages.length===1&&!ui.records.has(source.id),'Cleanup failure changed committed navigation');
 return {...monitor.result(),failedResult:true};
}finally{source.instance.view.onHide=original;ui.report=report;monitor.stop();}`),
    );

    await stage('owner cancellation during return cannot publish a cancelled preparation', () =>
        probe(`
const ui=app.ui,home=record('showcase.showcase-page'),view=home.instance.view,original=view.onShow;
const owner=app.flows.child('return-owner-check');
await ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined,owner);
const source=record('showcase.data-lab-page'),oldShow=source.show;
let release,attemptedShow,attempts=0;const gate=new Promise(resolve=>release=resolve);
view.onShow=async function(show){if(++attempts===1){attemptedShow=show;await gate;}return original.call(this,show);};
try{
 const returning=ui.back();await until(()=>attemptedShow);
 const closing=owner.close();check(oldShow.signal.aborted,'Owner cancellation was postponed for visual continuity');
 let failure;try{await returning.completed;}catch(error){failure=error;}
 check(failure?.code==='OPERATION_CANCELLED'&&attemptedShow.signal.aborted,'Cancelled return was allowed to commit');
 release();await closing;await until(()=>home.interactive);await frames(2);
 check(ui.pages.length===1&&ui.pages[0]===home&&!ui.records.has(source.id),'A cancelled page reappeared');
 check(home.show!==attemptedShow&&!attemptedShow.commit(()=>{}),'Cancelled preparation was reused');
 return {ownerClosed:owner.closed,cancelledPreparationDiscarded:true};
}finally{release();view.onShow=original;await owner.close();}`),
    );

    await stage('cancelling the previous page owner aborts return without waiting for its work', () =>
        probe(`
const ui=app.ui,owner=app.flows.child('return-target-owner');
await ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined,owner);
const target=record('showcase.data-lab-page'),original=target.instance.view.onShow;
await ui.pushPage({id:'showcase.time-lab-page',kind:'page'},undefined,app.flows);
const source=record('showcase.time-lab-page');
let release,attemptedShow;const gate=new Promise(resolve=>release=resolve);
target.instance.view.onShow=async function(show){attemptedShow=show;await gate;return original.call(this,show);};
const monitor=watch();
try{
 const returning=ui.back();await until(()=>attemptedShow);
 const closing=owner.close();let failure;try{await returning.completed;}catch(error){failure=error;}
 check(failure?.code==='OPERATION_CANCELLED'&&attemptedShow.signal.aborted,'Target owner cancellation did not abort return');
 check(source.interactive&&!source.show.signal.aborted&&cc.isValid(target.instance.node),'Cancellation lost source or released undrained target');
 await frames(3);release();await closing;
 check(ui.pages.length===2&&ui.pages[1]===source,'Cancelled target remained in stack');
 await ui.back().completed;await frames(2);
 return {...monitor.result(),targetOwnerCancelled:true};
}finally{release();target.instance.view.onShow=original;monitor.stop();await owner.close();}`),
    );
}

export async function verifyNavigationShutdown({ run, stage, back }) {
    await back();
    await stage('shutdown cancels pending return and drains preparation before releasing resources', () =>
        run(`
const ui=app.ui,home=record('showcase.showcase-page'),view=home.instance.view,original=view.onShow;
await home.show.ui.pushPage({id:'showcase.data-lab-page',kind:'page'},undefined);
let release,attemptedShow,closed=false;const gate=new Promise(resolve=>release=resolve);
view.onShow=async function(show){attemptedShow=show;await gate;return original.call(this,show);};
try{
 const returning=ui.back();await until(()=>attemptedShow);
 const closing=app.close();void closing.then(()=>{closed=true;});
 let failure;try{await returning.completed;}catch(error){failure=error;}
 check(failure?.code==='OPERATION_CANCELLED'&&attemptedShow.signal.aborted,'Shutdown did not cancel return');
 check(!closed&&cc.isValid(home.instance.node)&&!home.instance.scope.closed,'Shutdown released resources before preparation drained');
 release();await closing;
 check(app.scope.closed&&ui.records.size===0&&ui.pages.length===0,'Shutdown left a restored page');
 return {closed:true,resourcesPinnedUntilDrain:true};
}finally{release();view.onShow=original;}
`),
    );
}
