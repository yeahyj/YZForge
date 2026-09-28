import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const reply = await call('execute_javascript', {
    context: 'scene',
    args: { uuid: '3d12663b-ba91-464d-82c7-d633747950a8' },
    code: `const prefab=await new Promise((resolve,reject)=>cc.assetManager.loadAny(args.uuid,(error,asset)=>error?reject(error):resolve(asset)));
const root=cc.instantiate(prefab);root.active=false;
const sprites=root.getComponentsInChildren(cc.js.getClassByName('yzforge.LocalizedSprite'));
const texts=root.getComponentsInChildren(cc.js.getClassByName('yzforge.LocalizedLabel'));
const sprite=sprites[0],text=texts.find(c=>c.key==='example.welcome');if(!sprite||!text)throw Error('Example bindings missing');
for(const component of [...sprites,...texts])component.namespace='';
const imageTarget=sprite.node.getComponent(cc.Sprite),textTarget=text.node.getComponent(cc.Label);
const originalText=textTarget.string,originalFrame=imageTarget.spriteFrame;
const originalSize=()=>JSON.stringify([imageTarget.node.getComponent(cc.UITransform).contentSize,textTarget.node.getComponent(cc.UITransform).contentSize]);
const sizeBefore=originalSize();
const saveAsset=new cc.Prefab();saveAsset.data=root;
const serialized=()=>{const value=cce.Utils.serialize(saveAsset,{reserveContentsForSyncablePrefab:true});return typeof value==='string'?value:JSON.stringify(value);};
// Creator 真正保存 Prefab 时先复制树；直接序列化测试不能代替这条路径。
const savedClone=()=>{const clone=cc.instantiate(root),prefab=new cc.Prefab();prefab.data=clone;try{return cce.Utils.serialize(prefab,{reserveContentsForSyncablePrefab:true});}finally{clone.destroy();}};
const cloneContents=value=>{const records=typeof value==='string'?JSON.parse(value):value;return records.filter(c=>c.__type__==='cc.Label'||c.__type__==='cc.Sprite').map(({_id,...c})=>c);};
const cloneBefore=JSON.stringify(cloneContents(savedClone()));
const before=serialized(),result={};
if(!JSON.parse(before).some(c=>c.__type__==='cc.Label'))throw Error('Prefab contents must be included in save probe');
try{
sprite.editorFocused=true;text.editorFocused=true;await sprite.configurePreview();await text.configurePreview();
const options=cc.CCClass.Attr.attr(sprite.constructor,'previewLocale').enumList;
result.options=options;
for(const locale of ['zh-CN','en']){const value=options.find(o=>o.name===locale)?.value;if(!value)throw Error('Language missing from dropdown');sprite.previewLocale=value;text.previewLocale=value;
const deadline=Date.now()+6000;while((!sprite.previewImage||!text.previewText.startsWith(locale+' · ')||!sprite.previewText.startsWith(locale+' · '))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,15));
result[locale]={image:sprite.previewImage?._uuid,text:text.previewText,renderedText:textTarget.string,renderedImage:imageTarget.spriteFrame?._uuid};}
result.unchanged=serialized()===before;result.sizeUnchanged=originalSize()===sizeBefore;
result.cloneUnchanged=JSON.stringify(cloneContents(savedClone()))===cloneBefore;
// 序列化后画面仍保留英文；取消选中后恢复真实原始内容。
result.previewSurvivesSave=textTarget.string==='Welcome, YZForge!'&&imageTarget.spriteFrame===sprite.previewImage;
sprite.onLostFocusInEditor();text.onLostFocusInEditor();
result.restored=textTarget.string===originalText&&imageTarget.spriteFrame===originalFrame&&serialized()===before;
// 预览期间在原生 Label 改动其他属性和文案，取消预览不能覆盖用户编辑。
text.editorFocused=true;await text.configurePreview();textTarget.string='user draft';textTarget.fontSize+=1;
const edited=JSON.parse(serialized()).find(c=>c.__type__==='cc.Label'&&c._string==='user draft');
text.onLostFocusInEditor();result.userEditsPreserved=!!edited&&textTarget.string==='user draft';
// 切换后立刻离开节点，异步结果不得重新挂回图片或文本。
sprite.editorFocused=true;const pending=sprite.updatePreview();sprite.onLostFocusInEditor();await pending;
result.staleIgnored=imageTarget.spriteFrame===originalFrame&&sprite.previewImage===null;
}finally{sprite.onLostFocusInEditor();text.onLostFocusInEditor();result.cleared=sprite.previewImage===null;root.destroy();}
return result;`,
});
assert.ok(reply.data.ok);
const result = reply.data.result;
assert.ok(result['zh-CN'].image);
assert.notEqual(result['zh-CN'].image, result.en.image);
assert.equal(result['zh-CN'].text, 'zh-CN · 欢迎，YZForge！');
assert.equal(result.en.text, 'en · Welcome, YZForge!');
assert.equal(result['zh-CN'].renderedText, '欢迎，YZForge！');
assert.equal(result.en.renderedText, 'Welcome, YZForge!');
assert.equal(result.en.renderedImage, result.en.image);
for (const field of [
    'unchanged',
    'cloneUnchanged',
    'sizeUnchanged',
    'previewSurvivesSave',
    'restored',
    'userEditsPreserved',
    'staleIgnored',
    'cleared',
])
    assert.ok(result[field], field);
assert.deepEqual(
    result.options.map((o) => o.value),
    [0, 1, 2],
);
console.log('PASS: 自动归属、语言下拉、Label/Sprite 直接显示、序列化隔离、尺寸保持、还原与用户编辑、迟到结果清理');
