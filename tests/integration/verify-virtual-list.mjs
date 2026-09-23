// 使用当前 Cocos MCP，在独立预览窗口执行真实 ScrollView / Part / 资源清理检查。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview, screenshot } from './preview.mjs';

const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), '仅允许本机 Creator 预览或构建地址');
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `
const window=new (require('electron').BrowserWindow)({show:false,width:720,height:1280,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'virtual-list-'+Date.now()}});
window.webContents.__yzforgeRuntimeCheck=true;window.__virtualListErrors=[];
window.webContents.on('console-message',(_,level,message)=>{if(level>=3)window.__virtualListErrors.push(message);});
try{await window.loadURL(args.url);return window.id;}catch(error){window.destroy();throw error;}`,
    { url: url.href },
);

const run = (code, args = {}) =>
    preview(
        `
const check=(v,message)=>{if(!v)throw Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record=id=>Array.from(app.ui.records.values()).find(r=>r.definition.id===id&&!r.termination);
const until=async(fn)=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(fn())return;await wait(25);}throw Error('Timed out');};
const click=async(r,field)=>{r.instance.view[field].node.emit(cc.Button.EventType.CLICK);await wait(0);};
${code}`,
        args,
    );
const capture = async (name) => {
    await run('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;');
    return screenshot(name);
};
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
    await preview(
        'const option=document.querySelector(\'[data-device="Apple iPhone XR; 11"]\');if(option)option.click();await new Promise(resolve=>setTimeout(resolve,250));return true;',
    );
    const initial = await run(`
const home=record('showcase.showcase-page');check(home?.interactive,'Missing showcase home');
await click(home,'_bindBtnUi');await until(()=>record('showcase.ui-lab-page')?.interactive);
await click(record('showcase.ui-lab-page'),'_bindBtnVirtualList');await until(()=>record('showcase.virtual-list-lab-page')?.interactive);
const page=record('showcase.virtual-list-lab-page'),v=page.instance.view;
await v.list.whenIdle();await wait(700);
check(v.list.count===10000,'Expected 10000 rows');
const state=v.list.inspect();check(state.slots<30,'Too many list instances');
const scroll=v._bindNodeList.getComponent(cc.ScrollView),cells=scroll.content.children.filter(n=>n.active);
check(cells.length===state.indices.length,'Visible cells missing');
check(cells[0].getComponent('showcase.VirtualListItemPart')._bindLblTitle.string.includes('#1'),'Initial row wrong');
check(Math.abs(scroll.getScrollOffset().y)<1,'Initial offset wrong');return {state,viewport:scroll.view.contentSize};`);
    console.log(JSON.stringify({ stage: 'list', ...initial }));
    console.log(await capture('virtual-list-list.png'));

    const pointer = await run(`
const node=record('showcase.virtual-list-lab-page').instance.view._bindNodeList;
const camera=cc.director.getScene().getComponentsInChildren(cc.Camera).find(camera=>(camera.visibility&node.layer)!==0);
check(camera,'Missing UI camera');const point=camera.worldToScreen(node.worldPosition),canvas=cc.game.canvas,rect=canvas.getBoundingClientRect();
return {x:Math.round(rect.left+point.x/canvas.width*rect.width),y:Math.round(rect.top+(1-point.y/canvas.height)*rect.height)};`);
    await editor(
        `
const w=require('electron').BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error('Missing test window');
w.webContents.sendInputEvent({type:'mouseMove',x:args.x,y:args.y});
w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:args.x,y:args.y});
for(let i=1;i<=8;i++){w.webContents.sendInputEvent({type:'mouseMove',button:'left',x:args.x,y:args.y-i*20});await new Promise(resolve=>setTimeout(resolve,12));}
w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:args.x,y:args.y-160});return true;`,
        { id, ...pointer },
    );
    assert.equal(
        await run(
            `await wait(250);const v=record('showcase.virtual-list-lab-page').instance.view;check(v._bindNodeList.getComponent(cc.ScrollView).getScrollOffset().y>0,'Pointer drag failed');v.list.scrollToIndex(0);await v.list.whenIdle();return true;`,
        ),
        true,
    );

    const grid = await run(`
const p=record('showcase.virtual-list-lab-page'),v=p.instance.view;await click(p,'_bindBtnMode');await v.list.whenIdle();
await click(p,'_bindBtnJump');await wait(400);await v.list.whenIdle();
const state=v.list.inspect();check(state.range.start<=4999&&state.range.end>4999,'Animated grid positioning failed');check(state.slots<50,'Too many grid instances');
const scroll=v._bindNodeList.getComponent(cc.ScrollView),before=scroll.getScrollOffset().y;
v.list.scrollToIndex(4999,'nearest');check(Math.abs(before-scroll.getScrollOffset().y)<1,'Nearest moved a visible row');
const target=scroll.content.children.find(n=>n.active&&n.getComponent('showcase.VirtualListItemPart')._bindLblTitle.string.includes('#5000'));
check(target,'Grid row 5000 missing');
const other=scroll.content.children.find(n=>n.active&&n!==target),otherLabel=other.getComponent('showcase.VirtualListItemPart')._bindLblTitle.string;
v.list.updateItem(4999,{id:5000,title:'局部更新 #5000',revision:9});await v.list.whenIdle();
check(other.active&&other.getComponent('showcase.VirtualListItemPart')._bindLblTitle.string===otherLabel,'Unrelated row rebound');
await wait(700);await click(p,'_bindBtnEvent');await wait(50);
const live=scroll.content.children.filter(n=>n.active);check(live.every(n=>n.getComponent('showcase.VirtualListItemPart')._bindLblDetail.string.includes('广播 1')),'Stale subscriptions or missing current subscription');
check(live.every(n=>n.getComponent('showcase.VirtualListItemPart')._bindLblTitle.getComponent(cc.UITransform).width<=n.getComponent(cc.UITransform).width),'Child Widget did not adapt after cell reuse');
const listeners=v.ctx.events.listeners.get('showcase/virtual-list-pulse');check(listeners.size===live.length,'Subscription leak');
return {state:v.list.inspect(),offset:scroll.getScrollOffset().y,subscriptions:listeners.size,geometry:live.slice(0,4).map(n=>({position:n.position,width:n.getComponent(cc.UITransform).width,titlePosition:n.getComponent('showcase.VirtualListItemPart')._bindLblTitle.node.position,titleWidth:n.getComponent('showcase.VirtualListItemPart')._bindLblTitle.getComponent(cc.UITransform).width}))};`);
    console.log(JSON.stringify({ stage: 'grid-refresh-events', ...grid }));
    console.log(await capture('virtual-list-grid.png'));

    for (const [width, height, device] of [
        [720, 1280, 'Default'],
        [720, 1600, 'OPPO Reno 2'],
        [900, 1200, 'Apple iPad 10.2'],
    ]) {
        await editor(
            'const w=require("electron").BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error("Missing test window");w.setSize(args.width,args.height);return true;',
            { id, width, height },
        );
        const resized = await run(
            `
const option=document.querySelector('[data-device="'+args.device+'"]');
if(option)option.click();else cc.screen.windowSize=new cc.Size(args.width,args.height);
await wait(250);const v=record('showcase.virtual-list-lab-page').instance.view;await v.list.whenIdle();
const scroll=v._bindNodeList.getComponent(cc.ScrollView);v.list.scrollToIndex(9999,'end');await v.list.whenIdle();
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
check(v.list.inspect().range.end===10000,'Resize lost last row');
check(Math.abs(scroll.getScrollOffset().y-scroll.getMaxScrollOffset().y)<1,'Bottom alignment incorrect');
return {viewport:scroll.view.contentSize,state:v.list.inspect()};`,
            { width, height, device },
        );
        console.log(JSON.stringify({ stage: 'resize', width, height, ...resized }));
        console.log(await capture(`virtual-list-resize-${width}-${height}.png`));
    }
    const cleanup = await run(`
const p=record('showcase.virtual-list-lab-page'),v=p.instance.view,scroll=v._bindNodeList.getComponent(cc.ScrollView);
for(let i=0;i<60;i++)v.list.scrollToIndex((i*163)%10000);
check(v.list.inspect().slots<70,'Fast scrolling grows without bound');await v.list.whenIdle();
await click(p,'_bindBtnData');await v.list.whenIdle();check(v.list.count===0&&scroll.content.children.length===0,'Empty list leaked cells');
await click(p,'_bindBtnData');await v.list.whenIdle();
const handle=v.list;v._bindNodeList.active=false;await handle.dispose();check(scroll.content.children.length===0,'Disable leaked cells');
check(!v.ctx.events.listeners.has('showcase/virtual-list-pulse'),'Disable leaked subscriptions');
v._bindNodeList.active=true;
let releaseActivation,releaseCleanup,releaseParent,activation,lateCommit=true,renders=0,releaseNative,releaseNativeCleanup,nativeButton,nativeWrites=0;
const activationGate=new Promise(resolve=>releaseActivation=resolve),cleanupGate=new Promise(resolve=>releaseCleanup=resolve),parentGate=new Promise(resolve=>releaseParent=resolve);
const nativeGate=new Promise(resolve=>releaseNative=resolve),nativeCleanup=new Promise(resolve=>releaseNativeCleanup=resolve);
v.list=v._bindNodeList.getComponent('yzforge.VirtualList').mount({owner:p.show.scope,assets:p.show.assets,prefab:{id:'showcase/default/prefab/prefabs/virtual-list-item-part',type:'Prefab'},part:cc.js.getClassByName('showcase.VirtualListItemPart'),layout:{itemWidth:scroll.view.width,itemHeight:88},render:(part,item)=>{
 renders++;part.render(item);
 if(renders===1){item.scope.defer(()=>cleanupGate);const n=new cc.Node('NativeButton');n.layer=part.node.layer;n.addComponent(cc.UITransform);part.node.addChild(n);nativeButton=n.addComponent(cc.js.getClassByName('yzforge.AsyncButton'));nativeButton.autoGuard=false;part.onActivate=current=>{activation=current;void current.run(async task=>{await activationGate;lateCommit=task.commit(()=>{part._bindLblTitle.string='过期';});}).catch(()=>{});};}
 else {part.onActivate=()=>{};item.scope.defer(()=>parentGate);}
}});
v.list.setItems([{id:1,title:'重新挂载',revision:0}]);await v.list.whenIdle();check(scroll.content.children.length===1,'Remount failed');
const nativeRun=nativeButton.run(async task=>{task.scope.defer(()=>nativeCleanup);await nativeGate;task.commit(()=>nativeWrites++);}).catch(error=>check(error.code==='OPERATION_CANCELLED','原生子组件取消错误'));await wait(0);
const retained=scroll.content.children[0];v.list.updateItem(0,{id:1,title:'复用后',revision:1});await wait(30);
check(activation.signal.aborted&&renders===1&&!retained.active,'Part deactivation did not cancel immediately');
releaseCleanup();await wait(30);check(renders===1,'Reused before actual Part activation task exited');
releaseActivation();await wait(30);check(renders===1&&!nativeButton.lifetime.context,'复用未取消或等待原生子类');releaseNative();await wait(30);check(renders===1,'原生子类异步清理未完成就复用');releaseNativeCleanup();await v.list.whenIdle();await nativeRun;check(!lateCommit&&nativeWrites===0&&renders===2,'Part/native stale commit or reuse barrier failed');
const closing=v.list.dispose();await wait(30);check(cc.isValid(retained)&&!retained.active,'Prefab destroyed before async binding cleanup');
releaseParent();await closing;check(!cc.isValid(retained),'Prefab not reclaimed after cleanup');
let releaseBrokenTask,brokenNode,brokenDeactivation,cancelBarrier,hookBarrier,brokenRenders=0;
const brokenTask=new Promise(resolve=>releaseBrokenTask=resolve),cleanupErrors=[];
v.list=v._bindNodeList.getComponent('yzforge.VirtualList').mount({owner:p.show.scope,assets:p.show.assets,prefab:{id:'showcase/default/prefab/prefabs/virtual-list-item-part',type:'Prefab'},part:cc.js.getClassByName('showcase.VirtualListItemPart'),layout:{itemWidth:scroll.view.width,itemHeight:88},onError:error=>cleanupErrors.push(error),render:(part,item)=>{
 part.render(item);brokenRenders++;
 if(brokenRenders===1){brokenNode=part.node;part.onActivate=current=>{current.signal.onAbort(()=>{cancelBarrier=part.__deactivate();});void current.run(()=>brokenTask).catch(()=>{});};part.onDeactivate=()=>{hookBarrier=part.__deactivate();throw Error('virtual-list-test: Part cleanup failure');};}
}});
v.list.setItems([{id:1,title:'清理异常',revision:0}]);await v.list.whenIdle();
const brokenPart=brokenNode.getComponent('showcase.VirtualListItemPart');
v.list.updateItem(0,{id:2,title:'异常后替换',revision:0});
brokenDeactivation=brokenPart.__deactivate();
check(brokenPart.__deactivate()===brokenDeactivation,'Repeated deactivation did not share the complete barrier');
check(cancelBarrier===brokenDeactivation&&hookBarrier===brokenDeactivation,'Reentrant deactivation missed the cleanup barrier');
const observedFailure=brokenDeactivation.then(()=>false,error=>error.message==='virtual-list-test: Part cleanup failure');
await wait(30);check(brokenRenders===1&&!brokenNode.active&&cc.isValid(brokenNode,true),'Failed Part released before task drained');
releaseBrokenTask();await v.list.whenIdle();
check(await observedFailure,'Repeated deactivation swallowed cleanup error');
check(brokenRenders===2&&!cc.isValid(brokenNode,true),'Failed Part was reused instead of destroyed');
check(cleanupErrors.length===1&&cleanupErrors[0].message==='virtual-list-test: Part cleanup failure','List did not report Part cleanup failure');
check(scroll.content.children.some(n=>n.active&&n!==brokenNode),'Replacement Part not active');
const replacementNode=scroll.content.children.find(n=>n.active),replacementPart=replacementNode.getComponent('showcase.VirtualListItemPart');
replacementPart.onDeactivate=()=>{throw Error('virtual-list-test: Part cleanup failure');};
let disposeError;
try{await v.list.dispose();}catch(error){disposeError=error;}
check(disposeError?.code==='SCOPE_CLEANUP_FAILED','Dispose swallowed Part cleanup failure');
check(cleanupErrors.length===2&&!cc.isValid(replacementNode,true)&&scroll.content.children.length===0,'Failed dispose did not finish releasing instances');
const events=v.ctx.events;await app.ui.back().completed;await until(()=>record('showcase.ui-lab-page')?.interactive);
check(!events.listeners.has('showcase/virtual-list-pulse'),'Close leaked listeners');
await click(record('showcase.ui-lab-page'),'_bindBtnVirtualList');await until(()=>record('showcase.virtual-list-lab-page')?.interactive);
const reopened=record('showcase.virtual-list-lab-page');await reopened.instance.view.list.whenIdle();check(reopened.instance.view.list.count===10000,'Reopen failed');
await app.ui.back().completed;return {reopened:true,subscriptions:events.listeners.get('showcase/virtual-list-pulse')?.size??0};`);
    console.log(JSON.stringify({ stage: 'cleanup-reopen', ...cleanup }));
    const errors = await editor('return require("electron").BrowserWindow.fromId(args.id).__virtualListErrors;', {
        id,
    });
    assert.ok(
        errors.some((message) => message.includes('virtual-list-test: Part cleanup failure')),
        '缺少预期的清理异常记录',
    );
    assert.deepEqual(
        errors.filter((message) => !message.includes('virtual-list-test: Part cleanup failure')),
        [],
        '运行时出现非预期错误日志',
    );
    console.log('PASS: VirtualList 真实引擎定位、网格、局部更新、复用、清理失败销毁与关闭错误传播');
} finally {
    try {
        if (originalDevice)
            await preview(
                "const option=document.querySelector('[data-device=\"'+args.device+'\"]');if(option)option.click();await new Promise(resolve=>setTimeout(resolve,100));return true;",
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
