// 在独立预览/构建窗口验证四种语言示例；不改变用户正在编辑的场景。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview, screenshot } from './preview.mjs';
const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `const w=new (require('electron').BrowserWindow)({show:false,width:720,height:1280,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'localization-'+Date.now()}});
w.webContents.__yzforgeRuntimeCheck=true;w.__localizationErrors=[];
w.webContents.on('console-message',(_,level,message)=>{if(level>=3)w.__localizationErrors.push(message);});
try{await w.loadURL(args.url);return w.id;}catch(error){w.destroy();throw error;}`,
    { url: url.href },
);
const run = (code, args = {}) =>
    preview(
        `
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(test)=>{const end=Date.now()+12000;while(Date.now()<end){if(test())return;await wait(25);}throw Error('Localization example timed out: '+JSON.stringify({ui:app.ui.inspect(),assets:app.assets.inspect(),handles:app.i18n.handles.size}));};
const record=id=>Array.from(app.ui.records.values()).find(r=>r.definition.id===id&&!r.termination);
const page=()=>record('showcase.localization-lab-page');
const find=(n,name)=>n.name===name?n:n.children.map(c=>find(c,name)).find(Boolean);
const fixed=()=>find(page().instance.node,'StaticText').getComponent(cc.Label);
const fixedImage=()=>find(page().instance.node,'StaticImage').getComponent(cc.Sprite);
const click=async(field)=>{page().instance.view[field].node.emit(cc.Button.EventType.CLICK);await wait(0);await until(()=>!page().show.actions.busy('language')&&!page().show.actions.busy('image'));};
${code}`,
        args,
    );
try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
        ready = await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Bootstrap 未就绪');
    console.log(
        await run(`cc.profiler.hideStats();record('showcase.showcase-page').instance.view._bindBtnLocalization.node.emit(cc.Button.EventType.CLICK);
await until(()=>page()?.interactive);await until(()=>fixedImage().spriteFrame&&fixed().string==='欢迎，YZForge！');
const v=page().instance.view;check(v._bindLblDynamic.string==='你已点击 0 次','Dynamic text did not bind');
check(v._bindSprDynamic.spriteFrame===fixedImage().spriteFrame,'Dynamic/static image did not share resource');
for(let i=0;i<3;i++)await click('_bindBtnIncrement');check(v._bindLblDynamic.string==='你已点击 3 次','Dynamic parameters not updated');
const before=fixedImage().spriteFrame;await click('_bindBtnLanguage');
await until(()=>fixed().string==='Welcome, YZForge!'&&fixedImage().spriteFrame!==before);
check(v._bindLblDynamic.string==='You clicked 3 times','Language switch lost dynamic value');
check(v._bindSprDynamic.spriteFrame===fixedImage().spriteFrame,'Bindings did not switch together');
await click('_bindBtnLoad');check(v._bindSprDynamic.spriteFrame===fixedImage().spriteFrame,'Image reload failed');
check(!v._bindLblStatus.string,'Example reported failure');
return {stage:'four-examples',locale:app.i18n.locale,text:fixed().string,dynamic:v._bindLblDynamic.string,bundles:app.assets.inspect().bundles};`),
    );
    const pointer =
        await run(`const node=page().instance.view._bindBtnIncrement.node;const camera=cc.director.getScene().getComponentsInChildren(cc.Camera).find(c=>(c.visibility&node.layer)!==0);
const point=camera.worldToScreen(node.worldPosition),canvas=cc.game.canvas,rect=canvas.getBoundingClientRect();return {x:Math.round(rect.left+point.x/canvas.width*rect.width),y:Math.round(rect.top+(1-point.y/canvas.height)*rect.height)};`);
    await editor(
        `const w=require('electron').BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error('Missing test window');
w.webContents.sendInputEvent({type:'mouseMove',x:args.x,y:args.y});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:args.x,y:args.y});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:args.x,y:args.y});return true;`,
        { id, ...pointer },
    );
    await run(`await until(()=>page().instance.view._bindLblDynamic.string==='You clicked 4 times');return true;`);
    console.log(await screenshot('localization-examples-en-top.png'));
    console.log(
        await run(`const n=fixedImage().node,c=n.getComponent('yzforge.LocalizedSprite');c.enabled=false;
await until(()=>n.getComponent(cc.Sprite).spriteFrame===null);c.enabled=true;
await until(()=>!!n.getComponent(cc.Sprite).spriteFrame);check(n.getComponent(cc.Sprite).spriteFrame===page().instance.view._bindSprDynamic.spriteFrame,'Reactivated binding stale');
const scroll=find(page().instance.node,'Body').getComponent(cc.ScrollView);scroll.scrollToBottom(0);return {stage:'reactivation',locale:app.i18n.locale};`),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log(await screenshot('localization-examples-en-bottom.png'));
    for (const [width, height, name] of [
        [1280, 720, 'wide'],
        [720, 720, 'square'],
        [720, 1280, 'portrait'],
    ]) {
        await editor(
            'const w=require("electron").BrowserWindow.fromId(args.id);if(!w?.webContents.__yzforgeRuntimeCheck)throw Error("Missing test window");w.setContentSize(args.width,args.height);return true;',
            { id, width, height },
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
        console.log(
            await run(
                `const option=document.querySelector('[data-device="Default"]');if(option)option.click();cc.screen.windowSize=new cc.Size(args.width,args.height);await wait(250);const n=find(page().instance.node,'Body'),t=n.getComponent(cc.UITransform);check(t.width>0&&t.height>0,'Invalid scroll viewport');return {stage:args.name,width:t.width,height:t.height};`,
                { name, width, height },
            ),
        );
        console.log(await screenshot(`localization-examples-${name}.png`));
    }
    console.log(
        await run(`await click('_bindBtnLanguage');await until(()=>fixed().string==='欢迎，YZForge！');
const old=page(),image=fixedImage(),node=image.node;await old.show.ui.back();
await until(()=>!page());await until(()=>app.i18n.handles.size===0);
await until(()=>!app.assets.inspect().resources.some(r=>r.key.includes('yz-locale')||r.key.includes('greeting')));
await app.close();check(app.assets.inspect().resources.length===0,'Resources remain after close');
check(app.i18n.handles.size===0,'Language handles remain');return {stage:'cleanup',resources:app.assets.inspect().resources.length,nodeValid:cc.isValid(node,true)};`),
    );
    const errors = await editor('return require("electron").BrowserWindow.fromId(args.id).__localizationErrors;', {
        id,
    });
    assert.deepEqual(errors, []);
    console.log('PASS: 动态文字与参数、动态图片、编辑器声明文字与图片、语言切换、组件复用、三种比例、资源清理');
} finally {
    await editor(
        'const w=require("electron").BrowserWindow.fromId(args.id);if(w?.webContents.__yzforgeRuntimeCheck)w.destroy();return true;',
        { id },
    );
}
