// 使用独立的 Cocos 预览窗口和真实 AudioSource，不切换或保存用户的编辑场景。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
import { preview } from './preview.mjs';

const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const currentScene = () =>
    editor(`return {
    source:await Editor.Message.request('scene','query-current-scene'),
    dirty:await Editor.Message.request('scene','query-dirty')
};`);
const before = await currentScene();
const previousRuntime = process.env.YZFORGE_BUILT_RUNTIME;
process.env.YZFORGE_BUILT_RUNTIME = '1';
let id;
const run = (code) =>
    preview(`
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(test)=>{const end=Date.now()+8000;while(!test()){if(Date.now()>end)throw Error('Audio check timed out');await wait(10);}};
const key={id:'lobby/default/audio/confirm',type:'AudioClip'};
await app.assets.resolve(key,app.scope);
const withAudio=async(limit,action)=>{
 const baseline=app.assets.cache.retainedCount,owner=app.flows.child('verify-audio');
 const parent=new cc.Node('AudioCheck');cc.director.getScene().addChild(parent);
 const listeners=new Set(),clock={background:false,onStateChange(callback){listeners.add(callback);return()=>listeners.delete(callback);}};
 const setBackground=value=>{clock.background=value;for(const callback of listeners)callback();};
 const audio=new app.audio.constructor(parent,app.assets,clock,owner,limit);audio.setMuted(true);
 let result;
 try{result=await action({audio,owner,setBackground});}
 finally{await audio.close();await owner.close();parent.destroy();}
 check(audio.playing.size===0&&audio.loading.size===0,'Audio operations leaked');
 check(listeners.size===0,'Host listener leaked');
 check(app.assets.cache.retainedCount===baseline,'Audio clip lease leaked');
 return result;
};
${code}`);

try {
    id = await editor(
        `const w=new (require('electron').BrowserWindow)({show:false,width:720,height:1280,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'audio-check-'+Date.now()}});
w.webContents.__yzforgeRuntimeCheck=true;w.__audioErrors=[];
w.webContents.on('console-message',(_,level,message)=>{if(level>=3)w.__audioErrors.push(message);});
try{await w.loadURL(args.url);return w.id;}catch(error){w.destroy();throw error;}`,
        { url: url.href },
    );
    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        ready = await preview('return !!app?.ui.inspect().views.some(v=>v.interactive);').catch(() => false);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Bootstrap 未就绪');

    await run(`return await withAudio(1,async({audio,owner,setBackground})=>{
 const handle=await audio.play(key,owner,{loop:true}),voice=[...audio.playing][0];
 await until(()=>voice.source.playing);
 const original=voice.source.play;let plays=0;
 voice.source.play=function(){plays++;return original.call(this);};
 try{
  handle.pause();await until(()=>!voice.source.playing);
  setBackground(true);handle.resume();
  check(plays===0,'Background resume played immediately');
  setBackground(false);await until(()=>voice.source.playing);
  check(plays===1,'Deferred resume did not play exactly once');
  handle.pause();await until(()=>!voice.source.playing);
  setBackground(true);setBackground(false);
  check(plays===1&&!voice.source.playing,'Foreground overrode manual pause');
  handle.resume();await until(()=>voice.source.playing);
  setBackground(true);await until(()=>!voice.source.playing);
  setBackground(false);await until(()=>voice.source.playing);
  check(plays===3,'Normal host pause/resume failed');
  await handle.stop();handle.resume();
  check(plays===3&&!handle.active,'Stopped playback resumed');
 }finally{voice.source.play=original;}
 // 后台新建的播放也须等回到前台，用户暂停仍有优先权。
 setBackground(true);const background=await audio.play(key,owner,{loop:true});
 const next=[...audio.playing][0];check(!next.source.playing,'Background playback started early');
 background.pause();setBackground(false);check(!next.source.playing,'Manual pause was lost');
 background.resume();await until(()=>next.source.playing);await background.stop();
});`);
    console.log('PASS: 后台恢复播放、手动暂停优先、后台新建、停止后不复活');

    await run(`for(let delay=0;delay<20;delay++)await withAudio(1,async({audio,owner})=>{
 const old=await audio.playBgm(key,owner),replacement=audio.playBgm(key,owner);
 for(let i=0;i<delay;i++)await Promise.resolve();
 const effects=audio.play(key,owner,{loop:true});
 const results=await Promise.allSettled([replacement,effects]);
 check(results[0].status==='fulfilled','BGM lost its replacement slot');
 check(results[1].status==='rejected'&&results[1].reason.code==='AUDIO_VOICE_LIMIT','Concurrent effect exceeded capacity');
 check(audio.playing.size===1&&!old.active&&results[0].value.active,'BGM replacement state invalid');
 await results[0].value.stop();
 const next=await audio.play(key,owner,{loop:true});check(next.active,'Voice slot was not returned');
});return true;`);
    console.log('PASS: 20 个并发时序下 BGM 保留名额，音效不突破容量，停止后名额可复用');

    await run(`return await withAudio(1,async({audio,owner})=>{
 await audio.playBgm(key,owner);
 let unblock;const gate=new Promise(resolve=>unblock=resolve);
 [...audio.playing][0].scope.defer(()=>gate);
 const first=audio.playBgm(key,owner).then(()=>null,error=>error.code);
 try{
  await until(()=>audio.bgmReservation&&audio.playing.size===0);
  const latest=await audio.playBgm(key,owner);
  check(latest.active&&audio.playing.size===1,'Latest BGM could not take over reserved slot');
  unblock();check(await first==='OPERATION_CANCELLED','Superseded BGM was delivered');
  check(latest.active&&audio.playing.size===1,'Late old cleanup stopped the latest BGM');
 }finally{unblock();await first;}
});`);
    console.log('PASS: 新 BGM 接管替换名额，旧请求取消和迟到清理不影响新播放');

    await run(`for(const mode of ['cancel','failure'])await withAudio(1,async({audio,owner})=>{
 await audio.playBgm(key,owner);
 const old=[...audio.playing][0],caller=owner.child('replacement');
 let unblock;const gate=new Promise(resolve=>unblock=resolve);
 old.scope.defer(async()=>{await gate;if(mode==='failure')throw Error('Expected cleanup failure');});
 const result=audio.playBgm(key,caller).then(()=>null,error=>error.code);
 try{
  await until(()=>audio.bgmReservation&&audio.playing.size===0);
  if(mode==='cancel')caller.cancel();
  unblock();const code=await result;
  check(code===(mode==='cancel'?'OPERATION_CANCELLED':'SCOPE_CLEANUP_FAILED'),'Replacement error classification changed');
  const next=await audio.play(key,owner,{loop:true});check(next.active&&audio.playing.size===1,'Failed replacement leaked its slot');
 }finally{unblock();await result;await caller.close();}
});return true;`);
    console.log('PASS: 取消与清理失败归还 BGM 名额，音频引用和前后台监听完整回收');

    assert.deepEqual(
        await editor('return require("electron").BrowserWindow.fromId(args.id).__audioErrors;', { id }),
        [],
    );
} finally {
    if (id !== undefined)
        await editor(
            'const w=require("electron").BrowserWindow.fromId(args.id);if(w?.webContents.__yzforgeRuntimeCheck)w.destroy();return true;',
            { id },
        );
    if (previousRuntime === undefined) delete process.env.YZFORGE_BUILT_RUNTIME;
    else process.env.YZFORGE_BUILT_RUNTIME = previousRuntime;
    assert.deepEqual(await currentScene(), before, '用户当前编辑内容被改变');
}
