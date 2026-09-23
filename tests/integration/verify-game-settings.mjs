import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';

// Serve build/ with serve-build.mjs, then pass its loopback URL here.
const origin = new URL(process.argv[2]);
assert.equal(origin.hostname, '127.0.0.1');
const cases = [
    { directory: 'web_local-prod-debug', mode: 'debug', environment: 'prod' },
    { directory: 'web_local-staging-release', mode: 'release', environment: 'staging' },
].map((item) => ({ ...item, url: new URL(item.directory + '/index.html', origin).href }));
const output = await call('execute_javascript', {
    context: 'editor',
    args: { cases },
    code: `return await (async()=>{
        const BrowserWindow = require('electron').BrowserWindow;
        const window = new BrowserWindow({show:false,width:720,height:1280,webPreferences:{
            nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,
            partition:'yzforge-game-settings-'+Date.now()
        }});
        const errors=[], results=[], marker='shared-save-'+Date.now();
        window.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});
        try {
            for (let i=0;i<args.cases.length;i++) {
                const item=args.cases[i];
                await window.loadURL(item.url);
                let ready=false;
                const deadline=Date.now()+25000;
                while(Date.now()<deadline) {
                    ready=await window.webContents.executeJavaScript('(async()=>{if(!globalThis.System)return false;const cc=await System.import("cc"),app=cc.director.getScene()?.getChildByName("GameRoot")?.getComponent("game.GameRoot")?.app;if(!app||!app.ui.inspect().views.length)return false;globalThis.__settingsCheck={cc,app};return true;})()');
                    if(ready)break;
                    await new Promise(resolve=>setTimeout(resolve,150));
                }
                if(!ready)throw Error('Game did not boot: '+item.url+' '+JSON.stringify(errors));
                await window.webContents.executeJavaScript('globalThis.__settingsMarker='+JSON.stringify({marker,index:i}));
                const state=await window.webContents.executeJavaScript('(async()=>{const{app,cc}=globalThis.__settingsCheck,{marker,index}=globalThis.__settingsMarker;const key={id:"integration.game-settings",version:1,validate:value=>typeof value==="string"};const before=app.storage.get(key);if(index===0)app.storage.set(key,marker);const saved=app.storage.get(key);if(index===1)app.storage.remove(key);let unsupported;try{await app.sdk.auth.login(app.flows);}catch(error){unsupported=error.code;}cc.profiler.hideStats();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const report=await fetch("yzforge-build.json").then(response=>response.json());return{settings:app.settings,sdk:app.sdk.inspect(),prefix:app.storage.prefix,before,saved,unsupported,frozen:Object.isFrozen(app.settings)&&Object.isFrozen(app.settings.sdk.parameters),report};})()');
                const screenshot=require('path').join(Editor.Project.path,'temp/mcp-captures',item.directory+'.png');
                require('fs').writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG());
                results.push({...state,screenshot});
            }
            return {results,errors,marker};
        } finally { window.destroy(); }
    })();`,
});
const value = output.data;
assert.deepEqual(value.errors, []);
assert.equal(value.results.length, 2);
for (const [index, state] of value.results.entries()) {
    assert.equal(state.settings.mode, cases[index].mode);
    assert.equal(state.settings.environment, cases[index].environment);
    assert.equal(state.settings.configHash, state.report.configHash);
    assert.equal(state.frozen, true);
    assert.equal(state.sdk.phase, 'ready');
    assert.equal(state.sdk.runtime.platform, 'web');
    assert.equal(state.sdk.runtime.preview, false);
    assert.equal(state.unsupported, 'SDK_UNSUPPORTED');
    assert.equal(state.saved, value.marker);
}
assert.equal(value.results[0].before, undefined);
assert.equal(value.results[1].before, value.marker);
assert.equal(value.results[0].prefix, value.results[1].prefix);
console.log(JSON.stringify({ ok: true, ...value }, null, 2));
