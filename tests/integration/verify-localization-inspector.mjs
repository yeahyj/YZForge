import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const reply = await call('execute_javascript', {
    context: 'scene',
    args: { uuid: '3d12663b-ba91-464d-82c7-d633747950a8' },
    code: `const prefab=await new Promise((resolve,reject)=>cc.assetManager.loadAny(args.uuid,(error,asset)=>error?reject(error):resolve(asset)));
const sprites=prefab.data.getComponentsInChildren(cc.js.getClassByName('yzforge.LocalizedSprite'));
const texts=prefab.data.getComponentsInChildren(cc.js.getClassByName('yzforge.LocalizedLabel'));
const sprite=sprites[0],text=texts.find(c=>c.key==='example.welcome');if(!sprite||!text)throw Error('Example bindings missing');
const serialized=()=>{const value=cce.Utils.serialize(prefab);return typeof value==='string'?value:JSON.stringify(value);};
const before=serialized(),result={};
try{
for(const locale of ['zh-CN','en']){sprite.previewLocale=locale;text.previewLocale=locale;await sprite.updatePreview();await text.updatePreview();result[locale]={image:sprite.previewImage?._uuid,text:text.previewText};}
result.unchanged=serialized()===before;result.targetUnchanged=sprite.node.getComponent(cc.Sprite).spriteFrame===null;
}finally{sprite.onLostFocusInEditor();text.onLostFocusInEditor();}
result.cleared=sprite.previewImage===null;return result;`,
});
assert.ok(reply.data.ok);
const result = reply.data.result;
assert.ok(result['zh-CN'].image);
assert.notEqual(result['zh-CN'].image, result.en.image);
assert.equal(result['zh-CN'].text, 'zh-CN · 欢迎，YZForge！');
assert.equal(result.en.text, 'en · Welcome, YZForge!');
assert.ok(result.unchanged && result.targetUnchanged && result.cleared);
console.log('PASS: 原生检查器中英文文字/图片预览、预览资源归还、序列化内容不变');
