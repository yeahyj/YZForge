// 在独立预览/构建窗口中验证真实缓存实例的异常清理，不修改场景或预制体。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview } from './preview.mjs';

const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
process.env.YZFORGE_BUILT_RUNTIME = '1';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const id = await editor(
    `
const window=new (require('electron').BrowserWindow)({show:false,width:720,height:1050,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'ui-cleanup-'+Date.now()}});
window.webContents.__yzforgeRuntimeCheck=true;
window.__cleanupErrors=[];
window.webContents.on('console-message',(_,level,message)=>{if(level>=3&&window.__cleanupErrors.length<20)window.__cleanupErrors.push(message);});
try {await window.loadURL(args.url);return window.id;}
catch(error){window.destroy();throw error;}`,
    { url: url.href },
);

try {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        if (await preview('return !!app?.ui.inspect().views.some(view=>view.interactive);').catch(() => false)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result = await preview(`
if(!app)throw Error('Expected running framework application');
const check=(value,message)=>{if(!value)throw Error(message);};
const ui=app.ui, original=ui.definitions.get('showcase.confirm-popup');
check(original,'This integration check requires the showcase confirm popup');
const owner=app.flows.child('ui-cleanup-check');
await app.modules.use({id:original.module},owner);
const definitions=[], instances=[], hideHooks=[], results=[];
try {
    for(const mode of ['evict','close']) {
        const current=[];
        for(let index=0;index<2;index++) {
            const id='cleanup-check.'+mode+'-'+index;
            check(!ui.definitions.has(id),'Fixture ID already exists');
            definitions.push(id);
            ui.definitions.set(id,{...original,id});
            const handle=await ui.open({id,kind:'popup'},{title:'清理回归',detail:'仅当前测试窗口'},owner);
            await handle.close();
            const instance=ui.cache.get(id);
            check(instance,'Expected cached popup');
            const item={id,instance,originalDispose:instance.view.onDispose,released:false};
            instance.scope.defer(()=>{item.released=true;});
            instances.push(item);current.push(item);
        }
        current[0].instance.view.onDispose=()=>{throw Error('Expected cached view disposal failure');};
        if(mode==='close') {
            const active=Array.from(ui.records.values()).find(record=>record.interactive);
            check(active,'Expected an active page during shutdown');
            const view=active.instance.view, onHide=view.onHide;
            hideHooks.push({view,onHide});
            view.onHide=async function(context) {
                await onHide.call(this,context);
                throw Error('Expected active view hide failure');
            };
        }
        let failure;
        try {
            if(mode==='evict')await ui.evictModule(original.module);
            else await ui.close();
        } catch(error) {failure=error;}
        check(failure?.code===(mode==='evict'?'UI_CLEANUP_FAILED':'UI_SHUTDOWN_FAILED'),'Expected aggregated cleanup error');
        check(failure.details.failures.length===(mode==='evict'?1:2),'Expected every cleanup failure to be reported');
        for(const item of current) {
            check(!ui.cache.has(item.id),'Cached instance survived '+mode);
            check(item.released&&item.instance.scope.closed,'Scope did not finish cleanup after '+mode);
            check(!cc.isValid(item.instance.node),'Node survived '+mode);
        }
        if(mode==='close')check([...ui.layers.values()].every(node=>!cc.isValid(node)),'UI layers survived shutdown');
        results.push({mode,instancesClosed:current.length,error:failure.code,failures:failure.details.failures.length});
    }
} finally {
    for(const {view,onHide} of hideHooks)view.onHide=onHide;
    for(const item of instances) {
        item.instance.view.onDispose=item.originalDispose;
        ui.cache.delete(item.id);
        await ui.dispose(item.instance);
        await item.instance.scope.close();
    }
    for(const id of definitions)ui.definitions.delete(id);
    await owner.close();
}
await app.close();
check(app.scope.closed,'App did not close');
check(app.assets.inspect().resources.length===0,'Resource leases survived App shutdown');
return {cases:results,closed:true};`);
    assert.equal(result.closed, true);
    const errors = await editor("return require('electron').BrowserWindow.fromId(args.id).__cleanupErrors;", { id });
    assert.deepEqual(errors, [], 'Unexpected runtime errors');
    console.log(JSON.stringify({ ok: true, ...result, errors }));
} finally {
    await editor(
        "const window=require('electron').BrowserWindow.fromId(args.id);if(window?.webContents.__yzforgeRuntimeCheck)window.destroy();return true;",
        { id },
    );
    delete process.env.YZFORGE_BUILT_RUNTIME;
}
