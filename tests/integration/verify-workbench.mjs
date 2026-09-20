import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const editor = async (code, args={}) => (await call('execute_javascript', {context:'editor', code, args})).data;
const action = (name,args={}) => editor('return await Editor.Message.request("yzforge-editor","dispatch",args.name,args.input);',{name,input:args});
const module='workbench-check';
const initial=await editor('return await Editor.Message.request("yzforge-editor","state");');
assert.ok(!initial.modules.some(item=>item.id===module),'A previous test module exists; inspect it before retrying');
console.log(JSON.stringify(await action('createModule',{id:module,displayName:'工作台流程验证',codeOnly:true})));
let deleted=false;
try {
  let state=await editor('return await Editor.Message.request("yzforge-editor","state");');
  assert.deepEqual(state.modules.find(item=>item.id===module).bundles,{});
  await action('createScript',{module,id:'sample-service',kind:'service'});
  await action('createScript',{module,id:'sample-component',kind:'component'});
  await action('generate');
  console.log('PASS: code-only module and ordinary scripts generate without a resource bundle');
  await action('createBundle',{module,id:'extra'});
  await action('createTableTemplate',{module,id:'entries',bundle:'extra'});
  await action('generate');
  const service=`db://assets/game/modules/${module}/code/services/SampleService.ts`;
  await editor('await Editor.Message.request("asset-db","save-asset",args.url,args.content);return true;',{url:service,content:"import {EntriesTable} from '../../generated/config/Entries.table'; export const referencedTable=EntriesTable;\n"});
  const generatedPath=`assets/game/modules/${module}/generated/config/Entries.table.ts`;
  const beforeRemoval=await editor('return require("fs").readFileSync(require("path").join(Editor.Project.path,args.file),"utf8");',{file:generatedPath});
  await action('removeTable',{id:`${module}.entries`});
  await assert.rejects(action('generate'),/旧生成文件仍被手写代码导入/);
  const afterRejection=await editor('return require("fs").readFileSync(require("path").join(Editor.Project.path,args.file),"utf8");',{file:generatedPath});
  assert.equal(afterRejection,beforeRemoval,'Failed generation replaced the last good output');
  const scriptArgs={module,kind:'script',path:`assets/game/modules/${module}/code/services/SampleService.ts`};
  const scriptPreview=await action('previewDelete',scriptArgs);assert.deepEqual(scriptPreview.references,[]);
  await action('deleteModule',{...scriptArgs,signature:scriptPreview.signature});
  const regenerated=await action('generate');assert.equal(regenerated.obsolete.length,4);
  console.log('PASS: obsolete configuration with business references is blocked before writes, then archived after references are removed');
  const resolution=await editor('return await Editor.Profile.getProject("project","general.designResolution");');
  let view;
  try {
    await editor('await Editor.Profile.setProject("project","general.designResolution",args.value);return true;',{value:{...resolution,width:1280,height:720}});
    view=await action('createView',{module,id:'sample-view',kind:'popup',bundle:'extra'});
  } finally {
    await editor('await Editor.Profile.setProject("project","general.designResolution",args.value);return true;',{value:resolution});
  }
  const size=(await call('execute_javascript',{context:'scene',args:{uuid:view.uuid},code:'const p=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(error,value)=>error?no(error):yes(value)));const s=p.data.getComponent(cc.UITransform).contentSize;return {width:s.width,height:s.height};'})).data.result;
  assert.deepEqual(size,{width:1280,height:720});
  await action('bindView',{module,id:'sample-view'});
  await action('generate');
  console.log('PASS: UI created in selected bundle, reads landscape project size and binds without node dragging');
  const before=await editor('return await Editor.Message.request("asset-db","query-asset-info",args.uuid);',{uuid:view.uuid});
  const preview=await action('previewDelete',{module,kind:'module'});
  assert.deepEqual(preview.references,[]);
  const removed=await action('deleteModule',{module,kind:'module',signature:preview.signature});deleted=true;
  await action('restore',{id:removed.restoreId});deleted=false;
  const after=await editor('return await Editor.Message.request("asset-db","query-asset-info",args.uuid);',{uuid:view.uuid});
  assert.equal(after.uuid,before.uuid);assert.equal(after.url,before.url);
  console.log('PASS: delete preview, recoverable deletion and restore preserve the prefab UUID');
} catch(error) { console.error('Workbench verification failed:',error); throw error; }
finally {
  if(!deleted){
    const preview=await action('previewDelete',{module,kind:'module'});
    assert.deepEqual(preview.references,[],'Test data became externally referenced; preserve it for inspection');
    await action('deleteModule',{module,kind:'module',signature:preview.signature});
  }
  await action('generate');
  await editor('const io=require("fs/promises"),p=require("path");const source=p.join(Editor.Project.path,"config-source",args.module);const names=await io.readdir(source);if(names.length!==1||names[0]!=="entries.csv")throw Error("Unexpected test source files; preserve for review");const destination=p.join(Editor.Project.path,".yzforge","trash","test-source-"+Date.now());await io.rename(source,destination);return true;',{module});
}
console.log(JSON.stringify({ok:true,verified:['code-only module','service/component templates','optional bundle','project UI size','automatic binding','delete/restore UUID'],final:await action('check')}));
