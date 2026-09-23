// 当前 Creator MCP + 隔离浏览器预览 + 本机真实 HTTP，验证红点、请求与聚焦输入。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview, screenshot } from './preview.mjs';
import { startHttpFixture } from './http-fixture.mjs';
const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
process.env.YZFORGE_BUILT_RUNTIME = '1';
const fixture = await startHttpFixture();
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `const w=new (require('electron').BrowserWindow)({show:false,width:900,height:1380,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'network-guide-'+Date.now()}});w.webContents.__yzforgeRuntimeCheck=true;w.__featureErrors=[];w.webContents.on('console-message',(_,level,message)=>{if(level>=3)w.__featureErrors.push(message);});try{await w.loadURL(args.url);return w.id;}catch(e){w.destroy();throw e;}`,
    { url: url.href },
);
const run = (code, args = {}) =>
    preview(
        `
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(value,message)=>{if(!value)throw Error(message);};
const record=id=>Array.from(app.ui.records.values()).find(r=>r.definition.id===id&&!r.termination);
const until=async(fn)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if(fn())return;await wait(20);}throw Error('Runtime timeout');};
const click=(id,field)=>record(id).instance.view[field].node.emit(cc.Button.EventType.CLICK);
${code}`,
        args,
    );
const capture = async (name) => {
    await run('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;');
    return screenshot(name);
};
const pointer = async (expression) => {
    const point = await run(
        `const v=record('showcase.tutorial-lab-page').instance.view;const node=${expression};const camera=cc.director.getScene().getComponentsInChildren(cc.Camera).find(c=>(c.visibility&node.layer)!==0);check(camera,'UI camera missing');const p=camera.worldToScreen(node.worldPosition),canvas=cc.game.canvas,rect=canvas.getBoundingClientRect();return {x:Math.round(rect.left+p.x/canvas.width*rect.width),y:Math.round(rect.top+(1-p.y/canvas.height)*rect.height)};`,
    );
    await editor(
        `const w=require('electron').BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error('Wrong preview');for(const type of ['mouseMove','mouseDown','mouseUp'])w.webContents.sendInputEvent({type,button:'left',clickCount:1,x:args.x,y:args.y});return true;`,
        { id, ...point },
    );
};
let originalDevice;
try {
    const deadline = Date.now() + 30000;
    while (
        Date.now() < deadline &&
        !(await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false))
    )
        await new Promise((resolve) => setTimeout(resolve, 100));
    originalDevice = await run('return document.querySelector("#view-select [data-device].selected")?.dataset.device;');
    await run(
        `click('showcase.showcase-page','_bindBtnUi');await until(()=>record('showcase.ui-lab-page')?.interactive);click('showcase.ui-lab-page','_bindBtnVirtualList');await until(()=>record('showcase.virtual-list-lab-page')?.interactive);const v=record('showcase.virtual-list-lab-page').instance.view;await v.list.whenIdle();check(app.badges.get({id:'showcase/list'})===100,'Badge aggregate');const count=app.badges.inspect().subscriptions;v.list.refresh([0]);await v.list.whenIdle();check(app.badges.inspect().subscriptions===count,'Rebind badge leak');click('showcase.virtual-list-lab-page','_bindBtnEvent');await until(()=>app.badges.get({id:'showcase/list'})===0);check(app.badges.get({id:'showcase/list'})===0,'Batch badge update');v.list.scrollToIndex(5000);await v.list.whenIdle();await app.ui.back().completed;check(app.badges.inspect().subscriptions===0&&app.badges.inspect().nodes===0,'Badges not released');return true;`,
    );
    console.log('PASS 红点聚合、批量更新、列表复用和清理');
    await run(
        `click('showcase.ui-lab-page','_bindBtnNetwork');await until(()=>record('showcase.network-lab-page')?.interactive);return true;`,
    );
    for (const [button, expected] of [
        ['_bindBtnSuccess', '本地模拟 成功'],
        ['_bindBtnFailure', 'HTTP 状态 503'],
        ['_bindBtnTimeout', '请求超时'],
    ])
        await run(
            `click('showcase.network-lab-page',args.button);await until(()=>record('showcase.network-lab-page').instance.view._bindLblOutput.string.includes(args.expected));return true;`,
            { button, expected },
        );
    await run(
        `click('showcase.network-lab-page','_bindBtnSuccess');await wait(30);click('showcase.network-lab-page','_bindBtnCancel');await wait(800);check(record('showcase.network-lab-page').instance.view._bindLblOutput.string.includes('已取消'),'Late response rewrote output');const v=record('showcase.network-lab-page').instance.view;v._bindEditUrl.string=args.base+'/health';click('showcase.network-lab-page','_bindBtnReal');await until(()=>v._bindLblOutput.string.includes('真实本机 HTTP 请求成功'));check(app.http.inspect().pending===0,'HTTP pending leak');return true;`,
        { base: fixture.url },
    );
    console.log(await capture('network-real-http.png'));
    await run(
        `const r=record('showcase.network-lab-page'),v=r.instance.view;v._bindEditUrl.string=args.base+'/slow';click('showcase.network-lab-page','_bindBtnReal');await until(()=>app.http.inspect().pending===1);await app.ui.back().completed;check(app.http.inspect().pending===0,'HTTP not cancelled on close');return true;`,
        { base: fixture.url },
    );
    console.log('PASS 模拟成功/503/超时、最新查询、真实 HTTP 和关闭时 abort');
    await run(
        `click('showcase.ui-lab-page','_bindBtnTutorial');await until(()=>record('showcase.tutorial-lab-page')?.interactive);const v=record('showcase.tutorial-lab-page').instance.view;await v.list.whenIdle();click('showcase.tutorial-lab-page','_bindBtnStart');const focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');await until(()=>focus.session?.step);focus.session.step.options.duration=100000000;focus.session.step.elapsed=0;focus.draw();check(focus.inputShield.active,'Animation input not blocked');return true;`,
    );
    console.log(await capture('guide-focus-entry.png'));
    await pointer('v._bindBtnTrain.node');
    await run(
        `await wait(40);const v=record('showcase.tutorial-lab-page').instance.view;check(v._bindLblState.string.includes('训练 0'),'Input passed through during animation');const focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');focus.session.step.elapsed=25000000;focus.draw();return true;`,
    );
    console.log(await capture('guide-focus-contracting.png'));
    await run(
        `const v=record('showcase.tutorial-lab-page').instance.view,focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');focus.session.step.options.duration=0.55;focus.session.step.elapsed=0.55;focus.draw();check(focus.session.step.focused,'Focus never unlocked');check(focus.path.toString().includes('.circle'),'Stale guide renderer');return true;`,
    );
    console.log(await capture('guide-focus-train.png'));
    await pointer('v._bindBtnBack.node');
    await run(
        `await wait(40);check(record('showcase.tutorial-lab-page')?.interactive,'Top edge allowed a click through the mask');return true;`,
    );
    await pointer('v._bindBtnReset.node');
    await run(
        `await wait(40);const v=record('showcase.tutorial-lab-page').instance.view;check(v.guide.inspect().step==='train'&&v.guide.inspect().state==='running','Outside click reached reset');return true;`,
    );
    await run(
        `const v=record('showcase.tutorial-lab-page').instance.view,focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay'),frame=focus.session.frame;check(frame.hole.radius>0,'First hole must be circular');window.__guidePrevious=JSON.parse(JSON.stringify(frame));const overlayTransform=focus.node.getComponent(cc.UITransform),rect=frame.hole.rect,corner=focus.camera().worldToScreen(overlayTransform.convertToWorldSpaceAR(new cc.Vec3(rect.right-1,rect.top-1,0)));check(focus.inputShield.getComponent(cc.UITransform).hitTest(new cc.Vec2(corner.x,corner.y)),'Circle corner let input through');const originalWait=focus.waitForClick.bind(focus);focus.waitForClick=(session,target,options,owner)=>new Promise(resolve=>window.__releaseGuidePrepare=resolve).then(()=>originalWait(session,target,{...options,duration:100000000},owner));return true;`,
    );
    await pointer('v._bindBtnTrain.node');
    await run(
        `const v=record('showcase.tutorial-lab-page').instance.view,focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');await until(()=>window.__releaseGuidePrepare);check(focus.visual.active&&!focus.session.step,'Mask disappeared between steps');check(JSON.stringify(focus.session.frame)===JSON.stringify(window.__guidePrevious),'Waiting changed the previous hole');return true;`,
    );
    await pointer('v._bindBtnReset.node');
    await run(
        `const v=record('showcase.tutorial-lab-page').instance.view,focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');check(v.guide.inspect().step==='reward-21','Waiting phase allowed reset');window.__releaseGuidePrepare();await until(()=>focus.session.step);check(JSON.stringify(focus.session.step.from)===JSON.stringify(window.__guidePrevious),'Transition did not start at previous frame');check(focus.session.frame.shade===1&&focus.visual.active,'Transition reset the shade');focus.session.step.elapsed=50000000;focus.draw();check(focus.session.frame.hole.radius>0&&focus.session.frame.hole.radius<window.__guidePrevious.hole.radius,'Shape did not morph');return true;`,
    );
    console.log(await capture('guide-focus-morphing.png'));
    await pointer("v.targets.get('showcase/reward/21').value");
    await run(
        `await wait(40);const v=record('showcase.tutorial-lab-page').instance.view,focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');check(v._bindLblState.string.includes('领取 0'),'Transition allowed premature claim');focus.session.step.options.duration=0.55;focus.session.step.elapsed=0.55;focus.draw();check(focus.session.step.focused&&focus.session.frame.hole.radius===0,'Rectangle never settled');check(v.list.inspect().indices.includes(20),'Guide failed to scroll');check(v._bindLblState.string.includes('训练 1'),'Training not applied');return true;`,
    );
    console.log(await capture('guide-focus-list-target.png'));
    await pointer("v.targets.get('showcase/reward/21').value");
    await run(
        `const v=record('showcase.tutorial-lab-page').instance.view;await until(()=>v.guide.inspect().state==='ended');check(v._bindLblOutput.string.includes('已完成'),'Guide did not complete: '+v._bindLblOutput.string);check(v._bindLblState.string.includes('领取 1'),'Reward not claimed');check(!v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay').visual.active,'Mask remains after complete');await app.ui.back().completed;check(app.badges.inspect().nodes===0&&app.badges.inspect().subscriptions===0,'Guide badge leak');click('showcase.ui-lab-page','_bindBtnTutorial');await until(()=>record('showcase.tutorial-lab-page')?.interactive);click('showcase.tutorial-lab-page','_bindBtnStart');await until(()=>record('showcase.tutorial-lab-page').instance.view.guide?.inspect().state==='ended');check(!record('showcase.tutorial-lab-page').instance.view._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay').visual.active,'Completed guide replayed');return true;`,
    );
    console.log('PASS 连续聚焦动画、动画锁输入、外围遮挡、目标真实点击、定位与持久化');
    await run(
        `click('showcase.tutorial-lab-page','_bindBtnReset');await wait(40);click('showcase.tutorial-lab-page','_bindBtnStart');const v=record('showcase.tutorial-lab-page').instance.view;await until(()=>v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay').session?.step?.focused);click('showcase.tutorial-lab-page','_bindBtnTrain');await until(()=>v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay').session?.step?.target.key==='showcase/reward/21');v.list.scrollToIndex(99);await v.list.whenIdle();await until(()=>v.guide.inspect().state==='ended');check(v._bindLblOutput.string.includes('目标'),'Recycled target did not end focus');check(!v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay').visual.active,'Lost target kept mask');return true;`,
    );
    await run(
        `click('showcase.tutorial-lab-page','_bindBtnStart');const v=record('showcase.tutorial-lab-page').instance.view,focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');await until(()=>focus.session?.step?.focused);check(v.guide.inspect().step==='reward-21','Resume lost checkpoint');focus.skipButton.node.emit(cc.Button.EventType.CLICK);await until(()=>v.guide.inspect().state==='ended');check(v._bindLblOutput.string.includes('已跳过'),'Skip failed');return true;`,
    );
    for (const [device, suffix, width, height] of [
        ['OPPO Reno 2', 'tall', 720, 1600],
        ['Apple iPad 10.2', 'tablet', 900, 1200],
    ]) {
        await editor(
            'const w=require("electron").BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error("Missing owned window");w.setSize(args.width,args.height);w.webContents.setZoomFactor(args.zoom);return true;',
            { id, width, height, zoom: suffix === 'tablet' ? 0.5 : 1 },
        );
        await run(
            `const option=document.querySelector('#view-select [data-device="'+args.device+'"]');if(!option)throw Error('Device profile missing');option.click();await wait(120);click('showcase.tutorial-lab-page','_bindBtnReset');await wait(30);click('showcase.tutorial-lab-page','_bindBtnStart');const focus=record('showcase.tutorial-lab-page').instance.view._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');await until(()=>focus.session?.step?.focused);return true;`,
            { device },
        );
        console.log(await capture(`guide-focus-device-${suffix}.png`));
        console.log(
            await run(
                `const v=record('showcase.tutorial-lab-page').instance.view,canvas=cc.game.canvas,rect=canvas.getBoundingClientRect(),focus=v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay');return {device:args.device,canvas:{width:canvas.width,height:canvas.height,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}},bounds:focus.viewport(focus.node.getComponent(cc.UITransform)),safe:v.node.getChildByName('SafeContent').getComponent(cc.UITransform).contentSize};`,
                { device },
            ),
        );
        await run(
            `const v=record('showcase.tutorial-lab-page').instance.view;v.guide.cancel();await v.guide.result;return true;`,
        );
    }
    await run(
        `const v=record('showcase.tutorial-lab-page').instance.view,targets=v.targets;click('showcase.tutorial-lab-page','_bindBtnStart');await until(()=>v._bindNodeFocus.getComponent('yzforge.GuideFocusOverlay').session?.step);await app.ui.back().completed;check(targets.inspect().targets===0&&targets.inspect().waiters===0,'Guide target leak');check(app.badges.inspect().nodes===0&&app.badges.inspect().subscriptions===0,'Show cleanup failed');return true;`,
    );
    console.log('PASS 目标回收、中断恢复、跳过、窗口尺寸变化与关闭清理');
    assert.deepEqual(
        await editor('return require("electron").BrowserWindow.fromId(args.id).__featureErrors;', { id }),
        [],
        'Runtime console errors',
    );
} catch (error) {
    console.error(await editor('return require("electron").BrowserWindow.fromId(args.id)?.__featureErrors;', { id }));
    console.error(await capture('network-guide-failure.png').catch(() => undefined));
    throw error;
} finally {
    if (originalDevice)
        await preview(
            "Array.from(document.querySelectorAll('#view-select [data-device]')).find(el=>el.dataset.device===args.device)?.click();return true;",
            { device: originalDevice },
        ).catch(() => {});
    await editor(
        'const w=require("electron").BrowserWindow.fromId(args.id);if(w?.webContents.__yzforgeRuntimeCheck)w.destroy();return true;',
        { id },
    );
    await fixture.close();
}
