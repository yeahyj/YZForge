// 原生引擎回归：UI 取消、业务透明度、动态组件接入和语言组件组合。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview } from './preview.mjs';

const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const state = () =>
    editor(
        `return {source:await Editor.Message.request('scene','query-current-scene'),dirty:await Editor.Message.request('scene','query-dirty')};`,
    );
const before = await state();
let id;
const run = async (code) => {
    const result = await preview(`try{return await(async()=>{
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(test)=>{const end=Date.now()+8000;while(!test()){if(Date.now()>end)throw Error('Runtime timeout');await wait(5);}};
const page=[...app.ui.records.values()].find(record=>record.interactive);
${code}})();}catch(error){return {failure:String(error),stack:error.stack};}`);
    assert.ok(!result?.failure, JSON.stringify(result));
    console.log(result);
};
try {
    id = await editor(
        `const w=new (require('electron').BrowserWindow)({show:false,width:900,height:1300,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'framework-lifecycle-'+Date.now()}});w.webContents.__yzforgeRuntimeCheck=true;try{await w.loadURL(args.url);return w.id;}catch(error){w.destroy();throw error;}`,
        { url: url.href },
    );
    let ready = false;
    for (let i = 0; i < 120; i++) {
        ready = await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.ok(ready, 'Bootstrap 未就绪');
    await run(`
const Base=cc.js.getClassByName('yzforge.UIView');
globalThis.__lifecycleHooks={};
const View=cc._decorator.ccclass('test.FrameworkLifecycleView')(class extends Base{
 onCreate(context){return globalThis.__lifecycleHooks.create?.(this,context);}
 onShow(show){return globalThis.__lifecycleHooks.show?.(this,show);}
});
globalThis.__lifecycleFixture=(name,load,cache='none')=>{
 const owner=app.flows.child(name),root=new cc.Node(name);app.ui.root.addChild(root);root.addComponent(cc.UITransform).setContentSize(500,600);
 const template=new cc.Node('Template');template.active=false;template.addComponent(cc.UITransform).setContentSize(300,200);template.addComponent(cc.UIOpacity).opacity=123;template.addComponent(View);
 const prefab=new cc.Prefab();prefab.data=template;
 const key={id:name,kind:'popup'},definition={...key,module:page.instance.context.id,prefab:{id:'test/default/prefab/view',type:'Prefab'},cache};
 const modules={assertCanOpen(){},isInternalOwner(){return true;},context(){return page.instance.context;},isReady(){return true;},quarantine(){}};
 const errors=[],ui=new app.ui.constructor(root,{load:load??(async()=>prefab)},modules,app.time,app.clock,[definition],owner,error=>errors.push(error));
 return {owner,ui,key,prefab,errors,close:async()=>{globalThis.__lifecycleHooks={};await ui.close();await owner.close();template.destroy();prefab.destroy();root.destroy();}};
};
return {stage:'fixture'};`);
    await run(`
let scope,release,first=true;
const fixture=globalThis.__lifecycleFixture('test.loading',(_key,owner)=>{
 if(!first)return Promise.resolve(fixture.prefab);first=false;scope=owner;
 return new Promise((resolve,reject)=>{const off=owner.signal.onAbort(reject);release=()=>{off();resolve(fixture.prefab);};});
});
try{
 const caller=fixture.owner.child('caller');
 const opening=fixture.ui.open(fixture.key,undefined,caller).then(()=>{throw Error('Cancelled open succeeded');},error=>error.code);
 await until(()=>scope);let closed=false;const closing=caller.close().then(()=>closed=true);
 await until(()=>closed);check(scope.signal.aborted,'Prefab wait scope survived cancellation');
 check(await opening==='OPERATION_CANCELLED','Wrong open cancellation');
 check(fixture.ui.inspect().views.length===0,'Cancelled UI record retained');
 const handle=await fixture.ui.open(fixture.key,undefined,fixture.owner);await handle.close();
 release();await closing;check(fixture.errors.length===0,'Unexpected loading cleanup failure');
}finally{release?.();await fixture.close();}
return {stage:'cancel-during-prefab-load',reopened:true};`);
    await run(`
const fixture=globalThis.__lifecycleFixture('test.show-cancel');let called=0;
try{
 for(let delay=0;delay<24;delay++){
  const caller=fixture.owner.child('attempt:'+delay);let aborted=false;
  globalThis.__lifecycleHooks={show:(_view,show)=>{called++;aborted=show.signal.aborted;}};
  const opening=fixture.ui.open(fixture.key,undefined,caller).catch(error=>{check(error.code==='OPERATION_CANCELLED','Unexpected cancellation error');});
  for(let i=0;i<delay;i++)await Promise.resolve();
  caller.cancel();await opening;await caller.close();
  check(!aborted,'onShow ran after cancellation at microtask '+delay);
 }
 check(called>0,'Sweep did not reach onShow');
}finally{await fixture.close();}
return {stage:'cancel-before-onShow',timings:24};`);
    await run(`
const fixture=globalThis.__lifecycleFixture('test.opacity',undefined,'keep-one');
try{
 const first=await fixture.ui.open(fixture.key,undefined,fixture.owner),instance=[...fixture.ui.records.values()][0].instance;
 check(instance.node.getComponent(cc.UIOpacity).opacity===123,'Prefab opacity overwritten');
 check(instance.container.getComponent(cc.UIOpacity).opacity===255,'Container remained hidden');
 const parent=instance.container.parent.getComponent(cc.UITransform),container=instance.container.getComponent(cc.UITransform);
 check(parent.width===container.width&&parent.height===container.height,'Wrapper changed Widget reference bounds');
 await first.close();check(instance.node.getComponent(cc.UIOpacity).opacity===123,'Hide changed business opacity');
 globalThis.__lifecycleHooks={show:(view)=>{view.node.getComponent(cc.UIOpacity).opacity=77;}};
 const second=await fixture.ui.open(fixture.key,undefined,fixture.owner);
 check([...fixture.ui.records.values()][0].instance===instance,'Cache fixture was not reused');
 check(instance.node.getComponent(cc.UIOpacity).opacity===77,'onShow opacity overwritten');
 instance.node.getComponent(cc.UIOpacity).opacity=0;await second.close();
 globalThis.__lifecycleHooks={};const third=await fixture.ui.open(fixture.key,undefined,fixture.owner);
 check(instance.node.getComponent(cc.UIOpacity).opacity===0,'Intentional invisible state overwritten on reuse');await third.close();
}finally{await fixture.close();}
return {stage:'business-opacity-and-cache'};`);
    await run(`
const node=new cc.Node('DynamicLanguage');node.active=false;page.instance.node.addChild(node);node.addComponent(cc.UITransform);
const label=node.addComponent(cc.Label);label.string='Original';
const localized=node.addComponent(cc.js.getClassByName('yzforge.LocalizedLabel'));localized.key='resources.title';localized.namespace='showcase/default';
const count=page.instance.components.length;
try{
 await page.show.assets.bindComponents(node);node.active=true;await page.show.assets.bindComponents(node);
 check(label.enabled&&label.string==='资源与多语言','New component did not become localized');
 check(!!localized.lifetime.context?.i18n,'New component missing module context');
 await page.show.assets.bindComponents(page.instance.node);
 check(page.instance.components.length===count+1,'Existing components were rebound or duplicated');
 const outside=new cc.Node('Outside');let code;
 try{await page.show.assets.bindComponents(outside);}catch(error){code=error.code;}finally{outside.destroy();}
 check(code==='COMPONENT_HOST_MISSING','Unmanaged node was accepted');
 const stranger=app.flows.child('unrelated');try{await page.instance.context.assets.in(stranger).bindComponents(node);throw Error('Unrelated owner accepted');}
 catch(error){check(error.code==='COMPONENT_OWNER_OUTSIDE_HOST','Wrong owner guard');}finally{await stranger.close();}
 node.active=false;await wait(20);check(label.enabled&&label.string==='Original','Dynamic language did not restore on disable');
 node.active=true;await page.show.assets.bindComponents(node);check(label.string==='资源与多语言','Dynamic language did not reactivate');
}finally{node.destroy();await wait(20);}
return {stage:'dynamic-component-binding'};`);
    await run(`
const owner=page.show.scope.child('component-composition'),node=new cc.Node('Marquee');node.active=false;page.instance.node.addChild(node);node.addComponent(cc.UITransform).setContentSize(250,50);
const marquee=node.addComponent(cc.js.getClassByName('yzforge.MarqueeLabel'));marquee.string='Original';node.active=true;
const timerNode=new cc.Node('Countdown');timerNode.active=false;page.instance.node.addChild(timerNode);
const timer=timerNode.addComponent(cc.js.getClassByName('yzforge.CountdownLabel'));timer.autoStart=false;
await page.show.assets.bindComponents(timerNode);timerNode.active=true;await page.show.assets.bindComponents(timerNode);
const catalogs={zh:{formatVersion:2,namespace:'test/default',contract:'v1',locale:'zh-CN',revision:'zh1',texts:{title:'公告',remaining:'剩余 {seconds} 秒'},assets:{},font:null},en:{formatVersion:2,namespace:'test/default',contract:'v1',locale:'en',revision:'en1',texts:{title:'News',remaining:'{seconds} seconds left'},assets:{},font:null}};
const manager=new app.i18n.constructor(owner,async(address)=>catalogs[address.path],{defaultLocale:'zh-CN',locales:['zh-CN','en'],bundles:{test:{namespace:'test/default',contract:'v1',catalogs:{'zh-CN':{bundle:'test',path:'zh',revision:'zh1'},en:{bundle:'test-en',path:'en',revision:'en1'}}}}});
const localized=new page.show.i18n.constructor(manager,page.show.assets.in(owner),owner),bundle=await localized.use('test');
let now=0,completed=0;
try{
 await bundle.bindText(marquee,bundle.textKey('title'));marquee.refresh();
 check(marquee.string==='公告'&&node.getComponentInChildren(cc.Label).string==='公告','Marquee public text was not bound');
 let code;try{await bundle.bindText(node.getComponentInChildren(cc.Label),bundle.textKey('title'));}catch(error){code=error.code;}
 check(code==='I18N_TARGET_CONFLICT','Private Marquee label was accepted');
 const binding=await bundle.bindCountdownFormat(timer,bundle.textKey('remaining'));
 let conflict;try{timer.bind(owner,{nowMs:()=>now,onChanged:()=>()=>{}},{deadlineMs:5000,format:()=> 'custom'});}catch(error){conflict=error.code;}
 check(conflict==='COUNTDOWN_FORMAT_CONFLICT','Custom formatter overrode language template');
 timer.bind(owner,{nowMs:()=>now,onChanged:()=>()=>{}},{deadlineMs:5000,onComplete:()=>{completed++;}});
 check(timer.string==='剩余 5 秒','Countdown format was not applied');
 await localized.setLocale('en');marquee.refresh();
 check(timer.string==='5 seconds left'&&marquee.string==='News','Language switch did not refresh within the same second');
 now=5000;timer.update();await wait(10);check(completed===1&&timer.string==='0 seconds left','Countdown completion failed');
 now=0;await localized.setLocale('zh-CN');check(timer.string==='剩余 0 秒'&&completed===1,'Completed countdown revived after clock correction or repeated completion');
 code=undefined;try{await bundle.bindText(timer,bundle.textKey('title'));}catch(error){code=error.code;}
 check(code==='I18N_TARGET_CONFLICT','Countdown string writer was accepted');
 const spriteNode=new cc.Node('AsyncSprite');spriteNode.active=false;page.instance.node.addChild(spriteNode);const sprite=spriteNode.addComponent(cc.js.getClassByName('yzforge.AsyncSprite'));
 try{code=undefined;try{await bundle.bindSprite(sprite,{namespace:'test/default',contract:'v1',key:'unused',type:'SpriteFrame'});}catch(error){code=error.code;}
 check(code==='I18N_TARGET_CONFLICT','AsyncSprite conflict was accepted');}finally{spriteNode.destroy();}
 binding.dispose();check(timer.textFormat==='{hh}:{mm}:{ss}','Countdown format did not restore');
 timer.bind(owner,{nowMs:()=>now,onChanged:()=>()=>{}},{deadlineMs:5000,format:()=> 'custom'});
 conflict=undefined;try{await bundle.bindCountdownFormat(timer,bundle.textKey('remaining'));}catch(error){conflict=error.code;}
 check(conflict==='COUNTDOWN_FORMAT_CONFLICT'&&timer.string==='custom','Language template overrode custom formatter');
}finally{await owner.close();check(marquee.string==='Original','Marquee original text not restored');node.destroy();timerNode.destroy();await wait(20);}
return {stage:'marquee-and-countdown-localization'};`);
} finally {
    if (id !== undefined)
        await editor(
            `const w=require('electron').BrowserWindow.fromId(args.id);if(w?.webContents.__yzforgeRuntimeCheck)w.destroy();return true;`,
            { id },
        );
    assert.deepEqual(await state(), before, '编辑场景发生变化');
}
