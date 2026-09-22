import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview } from './preview.mjs';
const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1');
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `
const window=new (require('electron').BrowserWindow)({show:false,width:720,height:1050,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'runtime-check-'+Date.now()}});
window.webContents.__yzforgeRuntimeCheck=true;
try {await window.loadURL(args.url);return window.id;}
catch(error){window.destroy();throw error;}`,
    { url: url.href },
);
try {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        const ready = await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await import('./verify-preview.mjs');
    assert.equal(
        await preview(`
const check=(v,message)=>{if(!v)throw Error(message);};
const baseline=app.inspect().scope.children.length;
const probe=new cc.Node('ConstructorProbe'), layer=new cc.Node('ConstructorLayers');
cc.director.getScene().addChild(probe);probe.addChild(layer);
const source=root.getComponent('game.GameRoot').appOptions();let error;
try {await app.constructor.create({...source,root:probe,uiRoot:layer,maxAudioVoices:0});}
catch(e){error=e;}
check(error,'Expected invalid audio options to fail');
await new Promise(resolve=>setTimeout(resolve,40));
check(layer.children.length===0,'Partial App leaked UI layers');
check(app.inspect().scope.children.length===baseline,'Unrelated App was changed');
probe.destroy();return true;`),
        true,
    );
    console.log('PASS: failed App construction reclaims engine UI layers');
    assert.equal(
        await preview(`
const page=[...app.ui.records.values()].find(r=>r.definition.id==='lobby.dashboard'), actions=page.show.actions;
if('close' in page.show.scope)throw Error('Host scope leaked ownership');
let finish,oldCommitted=false; const gate=new Promise(resolve=>finish=resolve);
const first=actions.latest('runtime-search',async task=>{await gate;task.commit(()=>{oldCommitted=true;});});
const rejected=first.catch(error=>error.code);
await Promise.resolve();
const second=actions.latest('runtime-search',task=>{task.commit(()=>{});return 2;});
if(await second!==2||await rejected!=='OPERATION_CANCELLED')throw Error('Latest delivery failed');
finish();await new Promise(resolve=>setTimeout(resolve,25));
if(oldCommitted)throw Error('Stale result committed');
page.instance.view._bindBtnReward.node.emit(cc.Button.EventType.CLICK);
page.instance.view._bindBtnReward.node.emit(cc.Button.EventType.CLICK);
await new Promise(resolve=>setTimeout(resolve,100));
const popups=[...app.ui.records.values()].filter(r=>r.definition.id==='lobby.reward-popup');
if(popups.length!==1)throw Error('Exclusive reward action duplicated');
await popups[0].handle.close();return true;`),
        true,
    );
    console.log('PASS: real UI uses borrowed lifetimes, latest queries and exclusive reward actions');
} finally {
    await editor(
        'const window=require("electron").BrowserWindow.fromId(args.id);if(window?.webContents.__yzforgeRuntimeCheck)window.destroy();return true;',
        { id },
    );
    delete process.env.YZFORGE_BUILT_RUNTIME;
}
