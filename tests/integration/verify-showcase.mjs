// Real built-game integration through the local Creator MCP; owns an isolated Electron session.
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview, screenshot } from './preview.mjs';
import { verifyNavigation } from './verify-navigation.mjs';
const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1');
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `
const window=new (require('electron').BrowserWindow)({show:false,width:720,height:1280,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'showcase-'+Date.now()}});
window.webContents.__yzforgeRuntimeCheck=true;window.__showcaseErrors=[];
window.webContents.on('console-message',(_,level,message)=>{if(level>=3&&window.__showcaseErrors.length<20)window.__showcaseErrors.push(message);});
try{await window.loadURL(args.url);await window.webContents.executeJavaScript("globalThis.__showcaseStacks=[];window.addEventListener('error',e=>{if(globalThis.__showcaseStacks.length<3)globalThis.__showcaseStacks.push(e.error?.stack||e.message);});");return window.id;}catch(error){window.destroy();throw error;}`,
    { url: url.href },
);
const results = [];
const run = (code, args = {}) =>
    preview(
        `
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record=id=>[...app.ui.records.values()].find(r=>r.definition.id===id&&!r.termination);
const click=(id,field)=>{const r=record(id);check(r?.interactive,'UI not interactive: '+id);const button=r.instance.view[field];check(button.interactable&&button.node.activeInHierarchy,'Button unavailable: '+field);button.node.emit(cc.Button.EventType.CLICK);};
const until=async(fn)=>{const end=Date.now()+8000;while(Date.now()<end){if(fn())return;await wait(20);}throw Error('Runtime timeout: '+app.ui.inspect().views.map(v=>v.id).join(','));};
const idle=scope=>scope.state==='active'&&scope.tasks.length===0&&scope.children.every(idle);
${code}`,
        args,
    );
const go = async (button, page) =>
    run(
        `click('showcase.showcase-page',args.button);await until(()=>record(args.page)?.interactive);return app.ui.inspect().pages;`,
        { button, page },
    );
const back = () =>
    run("await app.ui.back().completed;await until(()=>record('showcase.showcase-page')?.interactive);return true;");
const press = async (page, button, expected) =>
    run(
        `const r=record(args.page),scope=r.show.scope,label=r.instance.view._bindLblOutput,before=label.string;
click(args.page,args.button);await until(()=>idle(scope.inspect()));
check(label.string!==before,'Operation left only the previous output: '+args.button);
check(label.string.includes(args.expected),'Unexpected output for '+args.button+': '+label.string);return label.string;`,
        { page, button, expected },
    );
async function stage(name, work) {
    const data = await work();
    await preview('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;');
    const errors = await editor("return require('electron').BrowserWindow.fromId(args.id).__showcaseErrors;", { id });
    assert.deepEqual(errors, [], 'Runtime console errors at ' + name);
    results.push({ name, data });
    console.log(JSON.stringify({ name, data }));
}
async function capture(name) {
    await run('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;');
    return screenshot(name);
}
async function pointerClick(page, field) {
    const point = await run(
        `
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const node=record(args.page).instance.view[args.field].node;
const camera=cc.director.getScene().getComponentsInChildren(cc.Camera).find(camera=>(camera.visibility&node.layer)!==0);
check(camera,'UI camera missing');const screen=camera.worldToScreen(node.worldPosition);
const canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect();
return {x:Math.round(rect.left+screen.x/canvas.width*rect.width),y:Math.round(rect.top+(1-screen.y/canvas.height)*rect.height)};`,
        { page, field },
    );
    await editor(
        `const w=require('electron').BrowserWindow.fromId(args.id);
w.webContents.sendInputEvent({type:'mouseMove',x:args.x,y:args.y});
w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:args.x,y:args.y});
w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:args.x,y:args.y});return true;`,
        { id, ...point },
    );
}
try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (
            await preview(
                "return !!app?.ui.inspect().views.some(v=>v.id==='showcase.showcase-page'&&v.interactive);",
            ).catch(() => false)
        )
            break;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await stage('home and lazy code baseline', async () => {
        const state = await run(
            "check(record('showcase.showcase-page')?.interactive,'home missing');check(!app.modules.isCodeReady('workshop'),'workshop code eager');check(!app.modules.isReady('workshop'),'workshop business eager');cc.profiler.hideStats();return app.inspect();",
        );
        await capture('showcase-home.png');
        return { modules: state.modules, bundles: state.assets.bundles };
    });
    await verifyNavigation({ run, stage, back });
    await stage('configuration, resource ambiguity, shards and audio', async () => {
        await pointerClick('showcase.showcase-page', '_bindBtnData');
        await run("await until(()=>record('showcase.data-lab-page')?.interactive);return true;");
        await run(
            "check(!!record('showcase.data-lab-page').instance.view._bindSprPreview.spriteFrame,'static sprite reference missing');return true;",
        );
        const outputs = [];
        for (const [button, expected] of [
            ['_bindBtnResource', '类型化 Key'],
            ['_bindBtnAmbiguous', '预期歧义'],
            ['_bindBtnDefault', '权重 1.5'],
            ['_bindBtnExtra', '扩展分片'],
            ['_bindBtnPublic', '公共表'],
            ['_bindBtnMany', '跨模块批量加载'],
        ])
            outputs.push(await press('showcase.data-lab-page', button, expected));
        await run(
            "check(!app.modules.isCodeReady('workshop')&&!app.modules.isReady('workshop'),'public table load started private code/business');return true;",
        );
        for (const expected of ['音频：播放', '音频：暂停', '音频：继续播放', '音频：停止'])
            outputs.push(await press('showcase.data-lab-page', '_bindBtnAudio', expected));
        outputs.push(await press('showcase.data-lab-page', '_bindBtnVolume', 'sfx 音量'));
        await capture('showcase-data.png');
        await back();
        return outputs;
    });
    await stage('repeated table reads release owners without closing the page', async () => {
        await go('_bindBtnData', 'showcase.data-lab-page');
        // Keep one independent public-table lease: batch cleanup must preserve it.
        await press('showcase.data-lab-page', '_bindBtnPublic', '公共表');
        const state = await run(`
const scope=record('showcase.data-lab-page').show.scope;
const snapshot=()=>app.config.inspect().map(entry=>({key:entry.key,users:entry.users})).sort((a,b)=>a.key.localeCompare(b.key));
const before=snapshot(),children=scope.inspect().children.length;
for(let i=0;i<3;i++){
 click('showcase.data-lab-page','_bindBtnMany');await until(()=>idle(scope.inspect()));
 check(JSON.stringify(snapshot())===JSON.stringify(before),'Repeated batch retained extra table owners');
 check(scope.inspect().children.length===children,'Completed batch left a child Scope');
}
return {rounds:3,owners:snapshot(),scopeChildren:children};`);
        await back();
        return state;
    });
    await stage('real pointer input coalesces navigation while resources are pending', async () => {
        await run(`
const original=app.assets.load;
let release;const pending=new Promise(resolve=>{release=resolve;});
const gate={loads:0,clicks:0,release,restore:()=>{}};
const nodes=['_bindBtnData','_bindBtnTime'].map(field=>record('showcase.showcase-page').instance.view[field].node);
const clicked=()=>{gate.clicks++;};for(const node of nodes)node.on(cc.Button.EventType.CLICK,clicked);
app.assets.load=function(...params){
 if(params[0].id==='showcase/default/prefab/ui/data-lab-page'){gate.loads++;return pending.then(()=>original.apply(this,params));}
 return original.apply(this,params);
};
gate.restore=()=>{release();app.assets.load=original;for(const node of nodes)node.off(cc.Button.EventType.CLICK,clicked);};
globalThis.__showcaseGate=gate;return true;`);
        try {
            await pointerClick('showcase.showcase-page', '_bindBtnData');
            await run('await until(()=>globalThis.__showcaseGate.loads===1);return true;');
            await pointerClick('showcase.showcase-page', '_bindBtnTime');
            const state = await run(`
const gate=globalThis.__showcaseGate;await until(()=>gate.clicks===2);gate.release();await app.ui.navigation;
check(JSON.stringify(app.ui.inspect().pages)===JSON.stringify(['showcase.showcase-page','showcase.data-lab-page']),'Second navigation unexpectedly queued a page');
return {physicalClicks:gate.clicks,pages:app.ui.inspect().pages};`);
            await back();
            return state;
        } finally {
            await run('globalThis.__showcaseGate.restore();delete globalThis.__showcaseGate;return true;');
        }
    });
    await stage('domain workflow, failure, confirmation and state after page recreation', async () => {
        await go('_bindBtnWorkflow', 'workshop.workflow-page');
        await run(
            "const r=record('workshop.workflow-page');check(app.modules.isCodeReady('workshop')&&app.modules.isReady('workshop'),'workshop did not load');check(r.instance.view._bindNodeItems.children.length===3,'task cards missing');return true;",
        );
        await press('workshop.workflow-page', '_bindBtnTrain', '训练 1 次');
        await press('workshop.workflow-page', '_bindBtnFailure', '下一次领取将失败');
        for (const expected of ['模拟请求失败', '奖励已保存']) {
            await run(
                "const Part=cc.js.getClassByName('workshop.TaskPart');const part=record('workshop.workflow-page').instance.view._bindNodeItems.children[0].getComponent(Part);part._bindBtnClaim.node.emit(cc.Button.EventType.CLICK);await until(()=>record('workshop.claim-popup')?.interactive);click('workshop.claim-popup','_bindBtnConfirm');await until(()=>!record('workshop.claim-popup'));return true;",
            );
            await run(
                "await until(()=>record('workshop.workflow-page').instance.view._bindLblOutput.string.includes(args.expected));return true;",
                { expected },
            );
        }
        const output = await run(
            "const r=record('workshop.workflow-page');check(r.instance.view._bindLblOutput.string.includes('余额 20'),'reward amount wrong');return r.instance.view._bindLblOutput.string;",
        );
        await capture('showcase-workflow.png');
        await back();
        await run("check(!app.modules.isReady('workshop'),'workshop business lease leaked');return true;");
        await go('_bindBtnWorkflow', 'workshop.workflow-page');
        await run(
            "const Part=cc.js.getClassByName('workshop.TaskPart');const part=record('workshop.workflow-page').instance.view._bindNodeItems.children[0].getComponent(Part);check(part._bindLblState.string==='已领取'&&!part._bindBtnClaim.interactable,'claim state not restored');return true;",
        );
        await back();
        return output;
    });
    await stage('external profile changes update the visible workflow', async () => {
        await go('_bindBtnWorkflow', 'workshop.workflow-page');
        const state = await run(`
const owner=app.flows.child('verify-external-profile');
try{
 const profile=await app.modules.use({id:'profile'},owner);
 const view=record('workshop.workflow-page').instance.view,before=profile.api.snapshot().coins;
 profile.api.changeCoins(7);
 await until(()=>view._bindLblOutput.string.includes('余额 '+(before+7)+' 金币'));
 const updated=view._bindLblOutput.string;
 profile.api.changeCoins(-7);
 await until(()=>view._bindLblOutput.string.includes('余额 '+before+' 金币'));
 return {updated,restored:profile.api.snapshot().coins};
}finally{await owner.close();}`);
        await back();
        return state;
    });
    await stage('UI results, instance cache, duplicate policy, layers and Part', async () => {
        await go('_bindBtnUi', 'showcase.ui-lab-page');
        const info = await run(`
const beforeOpens=app.ui.cache.get('showcase.confirm-popup')?.view.opens??0;let cachedInstance;
for(let i=0;i<2;i++){
 click('showcase.ui-lab-page',i?'_bindBtnCached':'_bindBtnPopup');await until(()=>record('showcase.confirm-popup')?.interactive);
 const r=record('showcase.confirm-popup');if(!i)cachedInstance=r.instance.node.uuid;else check(r.instance.node.uuid===cachedInstance,'cache did not reuse node');
 check(r.instance.view._bindLblDetail.string.includes('实例展示次数 '+(beforeOpens+i+1)),'cached show did not refresh');
 click('showcase.confirm-popup',i?'_bindBtnCancel':'_bindBtnConfirm');await until(()=>!record('showcase.confirm-popup'));await wait(50);
}
click('showcase.ui-lab-page','_bindBtnDuplicate');await until(()=>record('showcase.confirm-popup')?.interactive);await until(()=>record('showcase.ui-lab-page').instance.view._bindLblOutput.string.includes('预期拒绝'));click('showcase.confirm-popup','_bindBtnCancel');await until(()=>!record('showcase.confirm-popup'));await wait(50);
for(const [button,target] of [['_bindBtnOverlay','showcase.inspect-overlay'],['_bindBtnLoading','showcase.progress-loading']]){
 click('showcase.ui-lab-page',button);await until(()=>record(target)?.interactive);click(target,'_bindBtnCancel');await until(()=>!record(target));await wait(50);
}
click('showcase.ui-lab-page','_bindBtnToast');await until(()=>record('showcase.notice-toast')?.interactive);await until(()=>!record('showcase.notice-toast'));
click('showcase.ui-lab-page','_bindBtnPart');await until(()=>record('showcase.ui-lab-page').instance.view._bindLblOutput.string.includes('Part 已插入'));const before=record('showcase.ui-lab-page').instance.view._bindNodeContent.children.length;
click('showcase.ui-lab-page','_bindBtnPart');await until(()=>record('showcase.ui-lab-page').instance.view._bindLblOutput.string.includes('Part 已销毁'));check(record('showcase.ui-lab-page').instance.view._bindNodeContent.children.length===before-1,'Part node leaked');
click('showcase.ui-lab-page','_bindBtnPage');await until(()=>record('showcase.guide-page')?.interactive);await app.ui.back().completed;await until(()=>record('showcase.ui-lab-page')?.interactive);
return {cacheReused:true,partReleased:true,pageResumed:true};`);
        await back();
        return info;
    });
    await stage('real double-click creates one Part and one removal releases it', async () => {
        await go('_bindBtnUi', 'showcase.ui-lab-page');
        await run(`
const original=app.assets.instantiate;
let release;const pending=new Promise(resolve=>{release=resolve;});
const gate={loads:0,clicks:0,release,restore:()=>{}};
const node=record('showcase.ui-lab-page').instance.view._bindBtnPart.node;
const clicked=()=>{gate.clicks++;};node.on(cc.Button.EventType.CLICK,clicked);
app.assets.instantiate=function(...params){
 if(params[0].id==='showcase/default/prefab/prefabs/badge-part'){gate.loads++;return pending.then(()=>original.apply(this,params));}
 return original.apply(this,params);
};
gate.restore=()=>{release();app.assets.instantiate=original;node.off(cc.Button.EventType.CLICK,clicked);};
globalThis.__showcaseGate=gate;return true;`);
        try {
            await pointerClick('showcase.ui-lab-page', '_bindBtnPart');
            await run('await until(()=>globalThis.__showcaseGate.loads===1);return true;');
            await pointerClick('showcase.ui-lab-page', '_bindBtnPart');
            await run(`
const gate=globalThis.__showcaseGate;await until(()=>gate.clicks===2);
check(gate.loads===1,'Duplicate Part creation started');gate.release();
const view=record('showcase.ui-lab-page').instance.view;
await until(()=>idle(record('showcase.ui-lab-page').show.scope.inspect()));
check(view._bindNodeContent.children.filter(node=>node.getComponent('showcase.BadgePart')).length===1,'Expected one live Part');return true;`);
            await pointerClick('showcase.ui-lab-page', '_bindBtnPart');
            const state = await run(`
await until(()=>globalThis.__showcaseGate.clicks===3);
await until(()=>idle(record('showcase.ui-lab-page').show.scope.inspect()));
const remaining=record('showcase.ui-lab-page').instance.view._bindNodeContent.children.filter(node=>node.getComponent('showcase.BadgePart')).length;
check(remaining===0,'Part remained after removal');
return {physicalClicks:globalThis.__showcaseGate.clicks,creations:globalThis.__showcaseGate.loads,remaining};`);
            return state;
        } finally {
            await run('globalThis.__showcaseGate.restore();delete globalThis.__showcaseGate;return true;');
            await back();
        }
    });
    await stage('Part creation failure permits retry and leaving cancels a pending creation', async () => {
        await go('_bindBtnUi', 'showcase.ui-lab-page');
        const state = await run(`
const original=app.assets.instantiate;
try{
 let failed=false;
 app.assets.instantiate=function(...params){
  if(params[0].id==='showcase/default/prefab/prefabs/badge-part'&&!failed){failed=true;return Promise.reject(Error('Injected Part load failure'));}
  return original.apply(this,params);
 };
 click('showcase.ui-lab-page','_bindBtnPart');await until(()=>idle(record('showcase.ui-lab-page').show.scope.inspect()));
 check(record('showcase.ui-lab-page').instance.view._bindLblOutput.string.includes('Injected Part load failure'),'Part error was not reported');
 click('showcase.ui-lab-page','_bindBtnPart');await until(()=>idle(record('showcase.ui-lab-page').show.scope.inspect()));
 check(record('showcase.ui-lab-page').instance.view._bindNodeContent.children.filter(n=>n.getComponent('showcase.BadgePart')).length===1,'Part retry failed');
 click('showcase.ui-lab-page','_bindBtnPart');await until(()=>idle(record('showcase.ui-lab-page').show.scope.inspect()));
 let release;const pending=new Promise(resolve=>{release=resolve;});let started=false;
 app.assets.instantiate=function(...params){started=true;return pending.then(()=>original.apply(this,params));};
 click('showcase.ui-lab-page','_bindBtnPart');await until(()=>started);
 const returning=app.ui.back();
 try{await until(()=>record('showcase.ui-lab-page')?.termination||!record('showcase.ui-lab-page'));}finally{release();}
 await returning.completed;await until(()=>record('showcase.showcase-page')?.interactive);
 check(!app.ui.inspect().views.some(view=>view.id==='showcase.ui-lab-page'),'Old page survived cancellation');
 return {retried:true,pendingCreationCancelled:true};
}finally{app.assets.instantiate=original;}`);
        return state;
    });
    await stage('time simulation and callback cleanup', async () => {
        await go('_bindBtnTime', 'showcase.time-lab-page');
        const outputs = [];
        for (const [button, expected] of [
            ['_bindBtnDay', 'day：'],
            ['_bindBtnBackground', 'resume'],
            ['_bindBtnMonth', '每月锚点'],
            ['_bindBtnWeek', 'week：'],
            ['_bindBtnYear', 'year：'],
            ['_bindBtnRewind', '回拨'],
            ['_bindBtnSync', 'server / synced'],
            ['_bindBtnReset', '初始 1 月 31 日'],
        ])
            outputs.push(await press('showcase.time-lab-page', button, expected));
        await capture('showcase-time.png');
        await back();
        return outputs;
    });
    await stage('actions, cancellation, boot retry and stale commits', async () => {
        await go('_bindBtnAsync', 'showcase.async-lab-page');
        const outputs = [];
        for (const [button, expected] of [
            ['_bindBtnLatest', 'latest 接受：新结果'],
            ['_bindBtnExclusive', '执行 1 次'],
            ['_bindBtnSerial', '1 → 2 → 3'],
            ['_bindBtnRetry', '失败已接住'],
            ['_bindBtnRetry', '第 2 次尝试成功'],
            ['_bindBtnCancel', '实际工作结束：true'],
            ['_bindBtnBatch', '预期批量失败'],
            ['_bindBtnBoot', '第二次成功'],
        ])
            outputs.push(await press('showcase.async-lab-page', button, expected));
        const batch = outputs.find((text) => text.includes('预期批量失败'));
        assert.match(batch, /持有表条目：0 → 0/);
        await run('await until(()=>app.inspect().config.length===0);return true;');
        await run(
            "click('showcase.async-lab-page','_bindBtnLeave');await until(()=>record('showcase.showcase-page')?.interactive);check(record('showcase.showcase-page').instance.view._bindLblOutput.string.includes('已拦截过期回写 1 次'),'stale commit not reported');return true;",
        );
        return outputs;
    });
    await stage('storage faults and namespace isolation', async () => {
        await go('_bindBtnStorage', 'showcase.storage-lab-page');
        const outputs = [];
        for (const [button, expected] of [
            ['_bindBtnSave', '已保存 10'],
            ['_bindBtnRead', 'loaded'],
            ['_bindBtnAccount', '账号 A：1'],
            ['_bindBtnBackup', 'recovered'],
            ['_bindBtnFailure', '失败后余额仍为 10'],
            ['_bindBtnVersion', 'migrated'],
            ['_bindBtnFuture', 'incompatible'],
            ['_bindBtnReset', '已清空'],
        ])
            outputs.push(await press('showcase.storage-lab-page', button, expected));
        await back();
        return outputs;
    });
    await stage('guide, legacy return and stable repeated navigation', async () => {
        await go('_bindBtnGuide', 'showcase.guide-page');
        for (const [button, expected] of [
            ['_bindBtnStructure', '创建模块'],
            ['_bindBtnConfig', '__config'],
            ['_bindBtnService', 'TaskService'],
            ['_bindBtnPresenter', 'WorkflowPagePresenter'],
            ['_bindBtnView', 'WorkflowPage'],
            ['_bindBtnBinding', 'lbl_title'],
            ['_bindBtnVerify', 'npm run verify'],
        ])
            await press('showcase.guide-page', button, expected);
        await back();
        await go('_bindBtnLegacy', 'lobby.dashboard');
        await run(
            "click('lobby.dashboard','_bindBtnBack');await until(()=>record('showcase.showcase-page')?.interactive);return true;",
        );
        const baseline = await run(
            'return {resources:app.inspect().assets.resources.length,config:app.inspect().config.length,modules:app.inspect().modules.map(m=>m.id)};',
        );
        for (let i = 0; i < 3; i++) {
            await go('_bindBtnData', 'showcase.data-lab-page');
            await press('showcase.data-lab-page', '_bindBtnMany', '跨模块批量加载');
            await back();
        }
        const after = await run(
            'return {resources:app.inspect().assets.resources.length,config:app.inspect().config.length,modules:app.inspect().modules.map(m=>m.id)};',
        );
        assert.deepEqual(after, baseline);
        return after;
    });
    await stage('wide, tablet and tall viewport captures', async () => {
        const captures = [];
        for (const [width, height, name] of [
            [1024, 768, 'showcase-tablet.png'],
            [720, 1560, 'showcase-tall.png'],
            [720, 1280, 'showcase-home-final.png'],
        ]) {
            await editor(
                "const w=require('electron').BrowserWindow.fromId(args.id);w.setContentSize(args.width,args.height);return true;",
                { id, width, height },
            );
            await new Promise((resolve) => setTimeout(resolve, 300));
            captures.push(await capture(name));
        }
        return captures;
    });
    // 同一个隔离会话重新加载整个应用，检查持久化而非只检查内存里的 Service。
    await editor("const w=require('electron').BrowserWindow.fromId(args.id);await w.loadURL(args.url);return true;", {
        id,
        url: url.href,
    });
    const reloadedAt = Date.now();
    while (Date.now() - reloadedAt < 20000) {
        if (
            await preview(
                "return !!app?.ui.inspect().views.some(v=>v.id==='showcase.showcase-page'&&v.interactive);",
            ).catch(() => false)
        )
            break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await go('_bindBtnWorkflow', 'workshop.workflow-page');
    await run(
        "check(record('workshop.workflow-page').instance.view._bindLblOutput.string.includes('训练 1 次 · 余额 20'),'platform save did not survive application reload');return true;",
    );
    const closed = await run('await app.close();await app.close();return app.inspect();');
    assert.equal(closed.scope.state, 'closed');
    assert.deepEqual(closed.scope.children, []);
    assert.deepEqual(closed.modules, []);
    assert.deepEqual(closed.ui.views, []);
    assert.deepEqual(closed.assets.resources, []);
    assert.deepEqual(closed.config, []);
    const errors = await editor("return require('electron').BrowserWindow.fromId(args.id).__showcaseErrors;", { id });
    assert.deepEqual(errors, [], 'Runtime console errors');
    console.log(JSON.stringify({ ok: true, stages: results.length, reloadPersistence: true, closed: true, errors }));
} catch (error) {
    console.error(
        JSON.stringify(
            await preview(
                'return {ui:app?.ui.inspect(),stacks:globalThis.__showcaseStacks,output:[...app.ui.records.values()].map(r=>({id:r.definition.id,text:r.instance?.view?._bindLblOutput?.string}))};',
            ).catch(() => null),
        ),
    );
    console.error(
        JSON.stringify(
            await editor("return require('electron').BrowserWindow.fromId(args.id)?.__showcaseErrors;", { id }),
        ),
    );
    throw error;
} finally {
    await editor(
        "const w=require('electron').BrowserWindow.fromId(args.id);if(w&&!w.isDestroyed())w.destroy();return true;",
        { id },
    );
}
