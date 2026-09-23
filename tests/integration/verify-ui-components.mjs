// 当前 Creator 的真实引擎预览；隔离窗口，退出时恢复设备选项并销毁测试窗口。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview, screenshot } from './preview.mjs';
const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `const w=new (require('electron').BrowserWindow)({show:false,width:900,height:1380,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'components-'+Date.now()}});w.webContents.__yzforgeRuntimeCheck=true;w.__componentErrors=[];w.webContents.on('console-message',(_,level,message)=>{if(level>=3)w.__componentErrors.push(message);});try{await w.loadURL(args.url);return w.id;}catch(error){w.destroy();throw error;}`,
    { url: url.href },
);
const run = (code, args = {}) =>
    preview(
        `
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn)=>{const end=Date.now()+12000;while(Date.now()<end){if(fn())return;await wait(20);}throw Error('组件测试等待超时');};
const record=id=>Array.from(app.ui.records.values()).find(r=>r.definition.id===id&&!r.termination);
const page=record('showcase.components-lab-page'),v=page?.instance.view;
const click=field=>{const b=v[field];if(!b.interactable)return;cc.Component.EventHandler.emitEvents(b.clickEvents,{target:b.node});b.node.emit(cc.Button.EventType.CLICK,b);};
const near=(actual,expected,message)=>check(Math.abs(actual-expected)<0.1,message+' '+actual+' != '+expected+' '+JSON.stringify({viewport:cc.view.getViewportRect(),window:cc.screen.windowSize,visible:cc.view.getVisibleSize(),scale:cc.view.getScaleX()}));
const pixelNear=(actual,expected,message)=>check(Math.abs(actual-expected)*cc.view.getScaleX()<1,message+' '+actual+' != '+expected);
${code}`,
        args,
    );
const capture = async (name) => {
    await run('await wait(80);return true;');
    return screenshot(name);
};
let originalDevice;
let originalLandscape;
try {
    const end = Date.now() + 30000;
    while (
        Date.now() < end &&
        !(await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false))
    )
        await new Promise((resolve) => setTimeout(resolve, 100));
    originalDevice = await preview(
        'return document.querySelector("#view-select [data-device].selected")?.dataset.device;',
    );
    originalLandscape = await preview('return cc.screen.windowSize.width>cc.screen.windowSize.height;');
    await preview(
        'const option=document.querySelector(\'[data-device="Apple iPhone XR; 11"]\');if(option)option.click();await new Promise(resolve=>setTimeout(resolve,150));if(cc.screen.windowSize.width>cc.screen.windowSize.height)document.getElementById("btn-rotate").click();await new Promise(resolve=>setTimeout(resolve,150));return true;',
    );
    await run(
        `record('showcase.showcase-page').instance.view._bindBtnUi.node.emit(cc.Button.EventType.CLICK);await until(()=>record('showcase.ui-lab-page')?.interactive);record('showcase.ui-lab-page').instance.view._bindBtnComponents.node.emit(cc.Button.EventType.CLICK);await until(()=>record('showcase.components-lab-page')?.interactive);return true;`,
    );
    await run(`
const state=v.compState,child=name=>state.node.getChildByName(name);
check(v._bindBtnSubmit instanceof cc.Button && cc.js.getClassName(v._bindBtnSubmit)==='yzforge.AsyncButton','自动绑定未识别原生按钮子类');
check(v._bindBtnSubmit.node.getComponents(cc.Button).length===1,'重复按钮组件');
check(v.btnSubmit===v._bindBtnSubmit&&v.lblCountdown===v._bindLblCountdown&&v.sprPreview===v._bindSprPreview,'具体组件 getter 未返回原引用');
check(typeof v.btnSubmit.run==='function'&&typeof v.lblCountdown.startFor==='function'&&typeof v.sprPreview.setSource==='function'&&typeof v.compState.updateCheck==='function','无法直接调用组件接口');
check(v._bindSprPreview.node.getComponents(cc.Sprite).length===1&&v._bindLblCountdown.node.getComponents(cc.Label).length===1,'重复图片或文本组件');
for(let i=0;i<8;i++)click('_bindBtnSubmit');check(!v._bindBtnSubmit.interactable,'忙碌时未禁用');await until(()=>v._bindLblSubmit.string==='完成 1 次');await until(()=>v._bindBtnSubmit.interactable);
for(const [field,name]of [['_bindBtnLoading','loading'],['_bindBtnContent','content'],['_bindBtnReload','empty'],['_bindBtnError','error']]){click(field);check(child(name).active&&state.node.children.filter(n=>n.active).length===1,'Switch 编辑器事件 '+name);}
state.updateCheck(0,2,2);check(child('loading').active&&child('empty').active&&!child('error').active,'Switch 多选');
state.updateCheckByName('content');check(state.checkIndex.join(',')==='1','按名字未同步保存索引');state.enabled=false;state.enabled=true;check(child('content').active,'重新启用丢失名字选择');
const copy=state.checkIndex;copy.push(0);state.refresh();check(!child('loading').active,'外部数组修改污染选择');state.updateCheck();check(state.node.children.every(n=>!n.active),'空选择未全部隐藏');state.updateCheckByName('content');
const sprite=v._bindSprPreview;await until(()=>sprite.spriteFrame);const alphaId=sprite.spriteFrame.uuid;click('_bindBtnBeta');await until(()=>sprite.spriteFrame&&sprite.spriteFrame.uuid!==alphaId);click('_bindBtnAlpha');await until(()=>sprite.spriteFrame?.uuid===alphaId);
click('_bindBtnRestart');check(v._bindLblCountdown.string==='00:15','Inspector 重启倒计时');return true;`);
    console.log('PASS 原生继承、自动绑定、防连点、Switch 多选/名字/事件、换图与计时');
    await run(`
const host=new cc.Node('StandaloneComponents');host.active=false;host.layer=v.node.layer;v.node.addChild(host);
const make=(name,type)=>{const n=new cc.Node(name);n.layer=host.layer;n.addComponent(cc.UITransform).setContentSize(160,50);host.addChild(n);return n.addComponent(cc.js.getClassByName(type));};
const button=make('Button','yzforge.AsyncButton'),timer=make('Timer','yzforge.CountdownLabel'),sprite=make('Sprite','yzforge.AsyncSprite');button.autoGuard=false;timer.autoStart=false;host.active=true;
let calls=0;check(await button.run(task=>task.commit(()=>calls++)),'独立节点 run 需要框架注入');check(calls===1,'独立按钮未执行');timer.startFor(20);check(timer.string==='00:00:20','独立倒计时未工作');sprite.spriteFrame=v._bindSprPreview.spriteFrame;check(sprite.spriteFrame,'原生 spriteFrame 接口不可用');
const owner=page.show.scope.child('native-instance');app.assets.bindInstance(host,owner,'showcase',true);await until(()=>button.lifetime.context?.assets);check(button.lifetime.context.assets,'未注入模块资源');
let release,finish,started=false,closed=false,writes=0;const gate=new Promise(r=>release=r),cleanup=new Promise(r=>finish=r);
const pending=button.run(async task=>{started=true;task.scope.defer(()=>cleanup);await gate;task.commit(()=>writes++);}).catch(e=>check(e.code==='OPERATION_CANCELLED','实例取消错误'));
await until(()=>started);const closing=owner.close().then(()=>closed=true);check(!button.lifetime.context,'实例取消未同步停用');await wait(20);check(!closed,'实例未等待原生子类任务');
release();await wait(20);check(!closed,'实例未等待异步清理');finish();await Promise.all([pending,closing]);check(writes===0&&owner.inspect().children.length===0,'原生组件取消后回写或 Scope 泄漏');
host.destroy();await wait(30);check(!cc.isValid(button,true)&&!cc.isValid(timer,true),'独立组件销毁失败');return true;`);
    console.log('PASS 独立节点直接使用、后续框架注入、实例关闭排空与销毁');
    console.log(await capture('ui-components-portrait.png'));
    const point = await run(
        `const node=v._bindBtnSubmit.node,camera=cc.director.getScene().getComponentsInChildren(cc.Camera).find(camera=>(camera.visibility&node.layer)!==0),p=camera.worldToScreen(node.worldPosition),canvas=cc.game.canvas,rect=canvas.getBoundingClientRect();return {x:Math.round(rect.left+p.x/canvas.width*rect.width),y:Math.round(rect.top+(1-p.y/canvas.height)*rect.height)};`,
    );
    await editor(
        'const w=require("electron").BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error("Wrong preview");for(let i=0;i<4;i++)for(const type of ["mouseMove","mouseDown","mouseUp"])w.webContents.sendInputEvent({type,button:"left",clickCount:1,x:args.x,y:args.y});return true;',
        { id, ...point },
    );
    await run(
        `await until(()=>v._bindLblSubmit.string==='完成 2 次');await until(()=>v._bindBtnSubmit.interactable);return true;`,
    );
    console.log('PASS 真实鼠标连续点击只提交一次');
    await run(`
const marquee=v.compMarquee,view=marquee.getComponent(cc.UITransform),label=marquee.node.getComponentInChildren(cc.Label),width=view.width;
check(marquee.getComponent(cc.Mask)&&label.node.parent===marquee.node,'未自动建立裁剪层级');marquee.pauseDuration=0;marquee.restart();await wait(250);check(marquee.isScrolling&&label.node.position.x < -view.anchorX*width,'长文本没有滚动');
marquee.pause();const x=label.node.position.x;await wait(80);near(label.node.position.x,x,'暂停仍在滚动');marquee.play();await wait(80);check(label.node.position.x<x,'继续播放未前进');
const update=label.updateRenderData;let forced=0;label.updateRenderData=function(force){if(force)forced++;return update.call(this,force);};await wait(100);label.updateRenderData=update;check(forced===0,'滚动每帧重建文字');
click('_bindBtnShortText');await wait(50);check(!marquee.isScrolling&&label.string==='短文字保持静止','短文本仍在滚动');near(label.node.position.x,-view.anchorX*width,'短文本没复位');check(view.width===width,'文本改变了固定宽度');
marquee.string='';await wait(40);check(!marquee.isScrolling,'空文本在滚动');click('_bindBtnLongText');await wait(60);check(marquee.isScrolling,'换回长文本未恢复');
const count=marquee.node.children.length;marquee.enabled=false;check(!label.node.active,'禁用文字没隐藏');marquee.enabled=true;check(marquee.node.children.length===count&&label.node.active,'重新启用重复创建');
const w=marquee.node.getComponent(cc.Widget);w.enabled=false;view.width=2000;await wait(40);check(!marquee.isScrolling,'宽度变大未停');view.width=width;w.enabled=true;w.updateAlignment();await wait(50);check(marquee.isScrolling,'宽度缩小未重算');marquee.pauseDuration=0.8;marquee.restart();return true;`);
    console.log('PASS 滚动文本：自动裁剪、长短切换、暂停继续、禁用恢复、宽度变化');
    await run(`
const button=v._bindBtnSubmit.getComponent('yzforge.AsyncButton');let release,finish,started=false,writes=0,closed=false;
const gate=new Promise(resolve=>release=resolve),cleanup=new Promise(resolve=>finish=resolve);
const pending=button.run(async task=>{started=true;task.scope.defer(()=>cleanup);await gate;task.commit(()=>writes++);}).catch(error=>check(error.code==='OPERATION_CANCELLED','run 取消类型'));
await until(()=>started);button.enabled=false;const closing=button.lifetime.__deactivate().then(()=>closed=true);button.enabled=true;check(await button.run(()=>{writes+=100;})===false,'清理期间不应执行新点击');await wait(20);check(!closed,'自动激活期未等待旧工作');release();await wait(20);check(!closed,'自动激活期未等待异步清理');finish();await Promise.all([pending,closing]);await until(()=>!!button.lifetime.context);check(writes===0,'取消后 run 回写');check(await button.run(()=>{writes++;})===true&&writes===1,'重新启用后无法 run');return true;`);
    console.log('PASS 自动生命周期：run 禁用取消、等待实际任务与清理、重新启用');
    await run(`
const component=v._bindSprPreview.getComponent('yzforge.AsyncSprite'),owner=page.show.scope.child('sprite-test');
let release,loaded=false,first=true;
const gate=new Promise(resolve=>release=resolve);
const assets={in:scope=>{const actual=page.show.assets.in(scope);return {load:async(...args)=>{const frame=await actual.load(...args);if(first){first=false;loaded=true;await gate;}return frame;}};}};
const image=component.bind(owner,assets),old=image.set('icons/alpha/token');
const cancelled=old.then(()=>{throw Error('旧图片应取消');},error=>check(error.code==='OPERATION_CANCELLED','错误取消类型'));
await until(()=>loaded);await image.set('icons/beta/token');const latest=v._bindSprPreview.spriteFrame;check(image.state==='ready','新图片未就绪');
let closed=false;const closing=image.dispose().then(()=>closed=true);await wait(20);check(!closed,'图片工作未结束却已释放');
const next=component.bind(owner,page.show.assets);await next.set('icons/beta/token');release();await Promise.all([cancelled,closing]);
check(v._bindSprPreview.spriteFrame===latest&&next.state==='ready','旧句柄清理覆盖新绑定');
await next.set(null);check(v._bindSprPreview.spriteFrame===null&&next.state==='empty','清空失败');
component.placeholder=latest;component.failure=latest;const failed=next.set('missing-image');check(next.state==='loading'&&v._bindSprPreview.spriteFrame===latest,'占位图未显示');await failed.then(()=>{throw Error('预期图片错误');},()=>{});check(next.state==='error'&&v._bindSprPreview.spriteFrame===latest,'失败图未显示');
await owner.close();check(v._bindSprPreview.spriteFrame===null,'关闭后图片仍占用');check(owner.inspect().children.length===0,'图片 Scope 泄漏');component.placeholder=component.failure=null;return true;`);
    console.log('PASS 异步图片：迟到请求、重新绑定、旧句柄、占位/失败、资源归还');
    await run(`
const component=v._bindBtnSubmit.getComponent('yzforge.AsyncButton'),owner=page.show.scope.child('button-test');
let release,writes=0,started=false;const gate=new Promise(resolve=>release=resolve);
const old=component.bind(owner,async task=>{started=true;await gate;task.commit(()=>writes++);});const pending=old.press().catch(e=>check(e.code==='OPERATION_CANCELLED','旧按钮取消类型'));
await until(()=>started);const current=component.bind(owner,task=>{task.commit(()=>writes+=10);});const staleClose=old.dispose();release();await Promise.all([pending,staleClose]);
check(v._bindBtnSubmit.interactable&&!component.busyVisual.active,'复用未恢复按钮状态');await current.press();check(writes===10,'旧任务写入或新按钮失效');
const ended=owner.child('already-ended');await ended.close();try{component.bind(ended,()=>{});throw Error('取消 owner 绑定应失败');}catch(error){check(error.code==='OPERATION_CANCELLED','取消 owner 类型');}
await current.press();check(writes===20,'无效绑定取消了已有绑定');
v._bindBtnSubmit.node.active=false;await component.clear();v._bindBtnSubmit.node.active=true;v._bindBtnSubmit.node.emit(cc.Button.EventType.CLICK);await wait(20);check(writes===20,'禁用后监听未移除');await owner.close();return true;`);
    console.log('PASS 异步按钮：复用、迟到提交、无效绑定、禁用解绑');
    await run(`
const component=v._bindLblCountdown.getComponent('yzforge.CountdownLabel'),owner=page.show.scope.child('countdown-test');let now=1000,completed=0,eventCount=0;const listeners=new Set();const time={nowMs:()=>now,onChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
const event=new cc.Component.EventHandler();event.target=v.node;event.component='showcase.ComponentsLabPage';event.handler='testCountdownCompleted';v.testCountdownCompleted=()=>eventCount++;component.completedEvents=[event];component.textFormat='剩余 {seconds} 秒';component.startFor(0);await wait(0);check(eventCount===1&&v._bindLblCountdown.string==='剩余 0 秒','配置格式或完成事件失效');cc.game.emit(cc.Game.EVENT_SHOW);await wait(0);check(eventCount===1,'配置完成事件重复');component.startFor(0);component.startFor(5);await wait(0);check(eventCount===1,'重启前的完成事件没有取消');component.stop();component.completedEvents=[];delete v.testCountdownCompleted;
const timer=component.bind(owner,time,{deadlineMs:6000,onComplete:()=>{completed++;}});check(v._bindLblCountdown.string==='00:00:05','初始秒数');now=4501;for(const fn of listeners)fn();check(v._bindLblCountdown.string==='00:00:02','校时未刷新');
now=8000;cc.game.emit(cc.Game.EVENT_SHOW);await wait(0);check(completed===1&&v._bindLblCountdown.string==='00:00:00','恢复后未完成');now=0;timer.refresh();cc.game.emit(cc.Game.EVENT_SHOW);await wait(0);check(completed===1&&listeners.size===0,'重复完成或订阅泄漏');
component.bind(owner,time,{deadlineMs:9000});check(listeners.size===1,'新计时未绑定');component.enabled=false;check(listeners.size===0,'禁用未取消时间监听');const drain=component.lifetime.__deactivate();component.enabled=true;try{component.bind(owner,time,{deadlineMs:1000});throw Error('清理期间重绑应失败');}catch(e){check(e.code==='UI_COMPONENT_DRAINING','清理中重绑错误');}await drain;
component.bind(owner,time,{deadlineMs:1000});await owner.close();check(listeners.size===0,'宿主结束仍有时间监听');return true;`);
    console.log('PASS 倒计时：校时、前台恢复、一次完成、重新绑定与订阅清理');
    await run(`
const safe=v.compSafe,widget=v.compSafe.getComponent(cc.Widget);click('_bindBtnSafe');await wait(50);check(safe.simulate,'未启用模拟');near(widget.top,72,'纵屏顶部补偿');near(widget.bottom,24,'底部补偿');for(let i=0;i<8;i++)safe.refresh();near(widget.top,72,'反复刷新累计');
const make=(name,parent,w,h)=>{const node=new cc.Node(name);node.layer=parent.layer;node.addComponent(cc.UITransform).setContentSize(w,h);parent.addChild(node);return node;};
const stretch=node=>{const w=node.addComponent(cc.Widget);w.isAlignLeft=w.isAlignRight=w.isAlignTop=w.isAlignBottom=true;w.left=w.right=w.top=w.bottom=0;w.alignMode=cc.Widget.AlignMode.ON_WINDOW_RESIZE;w.updateAlignment();return w;};
const configure=component=>{component.simulate=true;component.previewTop=safe.previewTop;component.previewBottom=safe.previewBottom;component.refresh();};
const nested=make('SafeNestedTest',safe.node,100,100),nw=stretch(nested),ns=nested.addComponent(cc.js.getClassByName('yzforge.SafeWidget'));configure(ns);near(nw.top,0,'嵌套安全区重复补偿');near(nw.bottom,0,'嵌套底部重复补偿');
const percent=make('SafePercentTest',v.node,720,1280),pw=stretch(percent);pw.isAbsoluteTop=false;pw.top=0.1;const ps=percent.addComponent(cc.js.getClassByName('yzforge.SafeWidget'));configure(ps);near(pw.top,0.1+72/1280,'百分比补偿');ps.setBaseOffsets({top:0.2});near(pw.top,0.2+72/1280,'基础边距修改');ps.enabled=false;near(pw.top,0.2,'禁用未恢复基础值');ps.enabled=true;near(pw.top,0.2+72/1280,'重新启用重复补偿');
const scaled=make('SafeScaledTarget',v.node,360,640);scaled.setScale(2,2,1);const child=make('SafeScaledChild',scaled,360,640),cw=stretch(child),cs=child.addComponent(cc.js.getClassByName('yzforge.SafeWidget'));configure(cs);near(cw.top,36,'缩放参考节点换算');near(cw.bottom,12,'缩放底部换算');
cw.target=v.node;cs.refresh();near(cw.top,72,'非直接父级 target 单位');
const bare=new cc.Node('SafeRequiredComponents');bare.layer=v.node.layer;v.node.addChild(bare);const bs=bare.addComponent(cc.js.getClassByName('yzforge.SafeWidget'));check(bare.getComponent(cc.Widget)&&bare.getComponent(cc.UITransform),'挂 SafeWidget 未自动补齐依赖');
const offLists=[ns.globalOff,ns.referenceOff,ps.globalOff,ps.referenceOff,cs.globalOff,cs.referenceOff,bs.globalOff,bs.referenceOff];const targets=[nested,percent,scaled,bare];for(const node of targets)node.destroy();await wait(50);check(offLists.every(list=>list.length===0),'安全区监听未清理');v._bindScrollExamples.scrollToBottom(0);return true;`);
    console.log('PASS SafeWidget：不累计、嵌套、百分比、缩放目标、禁用恢复与监听清理');
    console.log(await capture('ui-components-safe-portrait.png'));
    // Creator 的视口 x 取整，而相机居中保留小数；横屏固定竖版设计允许不到一个屏幕像素的差异。
    await run(
        `click('_bindBtnSafe');await wait(30);document.getElementById('btn-rotate').click();await wait(250);click('_bindBtnSafe');await wait(50);const widget=v.compSafe.getComponent(cc.Widget),safe=v.compSafe;check(cc.screen.windowSize.width>cc.screen.windowSize.height,'未横屏');pixelNear(widget.left,72,'横屏左补偿');pixelNear(widget.right,24,'横屏右补偿');safe.symmetry=1;safe.refresh();pixelNear(widget.right,72,'横屏对称');safe.symmetry=0;safe.refresh();cc.game.emit(cc.Game.EVENT_SHOW);await wait(50);pixelNear(widget.left,72,'前台刷新错误');return true;`,
    );
    console.log(await capture('ui-components-safe-landscape.png'));
    console.log('PASS 横竖屏窗口变化、可选左右对称与前台刷新');
    await run(`
const scopes=[v._bindBtnSubmit,v._bindSprPreview,v._bindLblCountdown].flatMap(c=>[c.lifetime.binding,c.lifetime.activation]).filter(Boolean);
const safe=v.compSafe,content=v.compMarquee.node,offLists=[safe.globalOff,safe.referenceOff];
await app.ui.back().completed;check(scopes.every(s=>s.closed),'页面关闭仍有组件 Scope');check(!cc.isValid(content,true),'滚动文本节点未销毁');check(offLists.every(list=>list.length===0),'页面关闭安全区未解绑');return true;`);
    console.log('PASS 页面关闭：所有组件任务、节点与监听排空');
    assert.deepEqual(
        await editor('return require("electron").BrowserWindow.fromId(args.id).__componentErrors;', { id }),
        [],
        '预览控制台出现错误',
    );
} catch (error) {
    console.error(await editor('return require("electron").BrowserWindow.fromId(args.id)?.__componentErrors;', { id }));
    console.error(await capture('ui-components-failure.png').catch(() => undefined));
    throw error;
} finally {
    if (originalDevice)
        await preview(
            'Array.from(document.querySelectorAll("#view-select [data-device]")).find(n=>n.dataset.device===args.device)?.click();return true;',
            { device: originalDevice },
        ).catch(() => {});
    if (originalLandscape !== undefined)
        await preview(
            'await new Promise(resolve=>setTimeout(resolve,100));if((cc.screen.windowSize.width>cc.screen.windowSize.height)!==args.landscape)document.getElementById("btn-rotate").click();return true;',
            { landscape: originalLandscape },
        ).catch(() => {});
    await editor(
        'const w=require("electron").BrowserWindow.fromId(args.id);if(w?.webContents.__yzforgeRuntimeCheck)w.destroy();return true;',
        { id },
    );
}
