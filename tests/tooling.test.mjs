import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { parseCSV, fieldType, convert, compileTables } from '../tools/yzforge/config.mjs';
import { validateModules, lifecycleCheck } from '../tools/yzforge/checks.mjs';
import { within, writeBatch } from '../tools/yzforge/project.mjs';
import settingsTools from '../tools/yzforge/settings.cjs';
import { logicalKey } from '../assets/framework/assets/catalog.ts';
import { validateValue } from '../assets/framework/config/schema.ts';
import { parseTable } from '../assets/framework/config/config-table.ts';
const runtime = { logicalKey, validateValue, parseTable };
async function fixture(callback) {
  const root = await mkdtemp(join(tmpdir(), 'yzforge-config-'));
  try {
    await mkdir(join(root, 'config-source/lobby'), { recursive: true });
    const module = { id: 'lobby', directory: join(root, 'assets/game/modules/lobby'), dependencies: [], bundles: { default: { id: 'm-lobby', root: 'res' }, forest: { id: 'lobby-forest', root: 'bundles/forest' }, desert: { id: 'lobby-desert', root: 'bundles/desert' } }, assets: {}, views: {} };
    await callback(root, module);
  } finally {
    // This is a newly created test-only directory under the system temporary directory.
    if (!resolve(root).startsWith(resolve(tmpdir()) + '\\') && !resolve(root).startsWith(resolve(tmpdir()) + '/')) throw Error('Unsafe temporary test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
}
async function csv(root, name, content) { await writeFile(join(root, `config-source/lobby/${name}.csv`), content); }
async function mappings(root, tables) { await writeFile(join(root, 'config-source/tables.json'), JSON.stringify({ formatVersion: 1, tables })); }
test('CSV supports embedded commas, newlines, quotes, BOM and trailing empty cells', () => {
  assert.deepEqual(parseCSV('\uFEFFid,name,note\r\n1,"a,b","line1\nline2"\r\n2,"say ""yes""",'), [['id','name','note'],['1','a,b','line1\nline2'],['2','say "yes"','']]);
  assert.throws(() => parseCSV('"unterminated')); assert.throws(() => parseCSV('"closed"x'));
});
test('table type grammar and conversion preserve false/zero/text IDs and reject implicit coercion', () => {
  assert.deepEqual(fieldType('asset<SpriteFrame>[]?'), { kind:'array',element:{kind:'asset',assetType:'SpriteFrame'},nullable:true });
  assert.throws(() => fieldType('int[][]')); assert.throws(() => fieldType('any')); assert.throws(() => fieldType('enum<a,a>'));
  assert.equal(convert('001', {kind:'string'}, {}), '001'); assert.equal(convert('false',{kind:'bool'},{}), false);
  assert.equal(convert('0',{kind:'int'},{}), 0); assert.throws(() => convert('12px',{kind:'int'},{}));
  assert.deepEqual(convert('#FFAA0080',{kind:'color'},{}),{r:255,g:170,b:0,a:128});
});
test('configuration generation shards rows, validates globally and keeps data out of TS', async () => fixture(async (root,module) => {
  await csv(root,'levels','id,name,chapter,enabled\nint,string,enum<forest,desert>,bool\n,,,true\n编号,名称,章节,启用\n2,沙地,desert,false\n1,森林,forest,0');
  // CSV enum commas need quoting just like every other comma-containing cell.
  await csv(root,'levels','id,name,chapter,enabled\nint,string,"enum<forest,desert>",bool\n,,,true\n编号,名称,章节,启用\n2,沙地,desert,false\n1,森林,forest,0');
  await mappings(root,[{id:'lobby.levels',source:'config-source/lobby/levels.csv',shards:{field:'chapter',targets:{forest:'forest',desert:'desert'}},indexes:{chapter:{field:'chapter',unique:false}}}]);
  const compiled=await compileTables(root,[module],runtime,new Map());
  assert.equal(compiled.routes['lobby.levels'].length,2);
  const forest=JSON.parse(compiled.output['assets/game/modules/lobby/bundles/forest/config/levels.json']);
  assert.equal(forest.rows.length,1);assert.equal(forest.rows[0].enabled,false);
  assert.ok(!compiled.output['assets/game/modules/lobby/generated/config/Levels.table.ts'].includes('森林'));
}));
test('blank values use defaults then nullable, without treating false and zero as empty', async () => fixture(async(root,module)=>{
  await csv(root,'items','id,value,enabled,note\nint,int,bool,string?\n,9,true,\n编号,数量,启用,备注\n1,0,false,\n2,,,');
  await mappings(root,[{id:'lobby.items',source:'config-source/lobby/items.csv'}]);
  const compiled=await compileTables(root,[module],runtime,new Map()),data=JSON.parse(compiled.output['assets/game/modules/lobby/res/config/items.json']);
  assert.deepEqual(data.rows,[{id:1,value:0,enabled:false,note:null},{id:2,value:9,enabled:true,note:null}]);
}));
test('misspelled and incompatible configuration constraints cannot silently pass',async()=>fixture(async(root,module)=>{
  await csv(root,'entries','id,name\nint,string\n,\n编号,名称\n1,Example');
  const mapping={id:'lobby.entries',source:'config-source/lobby/entries.csv',constraints:{missing:{min:0}}};
  await mappings(root,[mapping]);await assert.rejects(compileTables(root,[module],runtime,new Map()),/undeclared field/);
  mapping.constraints={name:{min:0}};await mappings(root,[mapping]);await assert.rejects(compileTables(root,[module],runtime,new Map()),/not supported for string/);
}));
test('duplicate primary keys are rejected across shards before writing output', async () => fixture(async(root,module)=>{
  await csv(root,'levels','id,chapter\nint,string\n,\n编号,章节\n1,forest\n1,desert');
  await mappings(root,[{id:'lobby.levels',source:'config-source/lobby/levels.csv',shards:{field:'chapter',targets:{forest:'forest',desert:'desert'}}}]);
  await assert.rejects(compileTables(root,[module],runtime,new Map()),/duplicate primary key across shards/);
}));
test('foreign keys validate declared references rather than guessing from field names', async()=>fixture(async(root,module)=>{
  await csv(root,'items','id,name\nint,string\n,\n编号,名称\n1,Coin');
  await csv(root,'levels','id,itemId,skillIds\nint,ref<items>,int[]\n,,[]\n编号,道具,技能\n1,2,[999]');
  await mappings(root,[{id:'lobby.items',source:'config-source/lobby/items.csv'},{id:'lobby.levels',source:'config-source/lobby/levels.csv'}]);
  await assert.rejects(compileTables(root,[module],runtime,new Map()),/missing foreign key/);
  await csv(root,'levels','id,itemId,skillIds\nint,ref<items>,int[]\n,,[]\n编号,道具,技能\n1,1,[999]');
  const compiled=await compileTables(root,[module],runtime,new Map());assert.equal(compiled.reports.length,2);
}));
test('XLSX import uses raw typed cells and rejects formulas with cell positions',async()=>fixture(async(root,module)=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Items');
  sheet.addRows([['id','name','enabled'],['int','string','bool'],[null,null,true],['编号','名称','启用'],[1,'001',false]]);
  const file=join(root,'config-source/lobby/items.xlsx');await book.xlsx.writeFile(file);
  await mappings(root,[{id:'lobby.items',source:'config-source/lobby/items.xlsx',sheet:'Items'}]);
  const compiled=await compileTables(root,[module],runtime,new Map());assert.equal(JSON.parse(compiled.output['assets/game/modules/lobby/res/config/items.json']).rows[0].name,'001');
  sheet.getCell('A5').value={formula:'1+1',result:2};await book.xlsx.writeFile(file);
  await assert.rejects(compileTables(root,[module],runtime,new Map()),/Items!A5/);
}));
test('dynamic asset fields produce typed logical keys without loading engine assets',async()=>fixture(async(root,module)=>{
  await csv(root,'items','id,icon\nint,asset<SpriteFrame>\n,\n编号,图标\n1,coin');
  await mappings(root,[{id:'lobby.items',source:'config-source/lobby/items.csv'}]);
  const registry=new Map([['lobby/default/sprite/coin',{type:'SpriteFrame'}]]);
  const result=await compileTables(root,[module],runtime,registry);
  assert.deepEqual(JSON.parse(result.output['assets/game/modules/lobby/res/config/items.json']).rows[0].icon,{id:'lobby/default/sprite/coin',type:'SpriteFrame'});
}));
test('module validation rejects cycles and duplicate physical bundle names',()=>{
  const make=(id,dependencies=[],bundle=id)=>({id,dependencies,bundles:{default:{id:bundle,root:'res'}},assets:{},views:{}});
  assert.throws(()=>validateModules([make('a',['b']),make('b',['a'])]),/cyclic/);
  assert.throws(()=>validateModules([make('a',[],'same'),make('b',[],'same')]),/duplicate bundle/);
});
test('code-only modules do not require a resource bundle or a particular business name',()=>{
  assert.doesNotThrow(()=>validateModules([{ id:'metrics', dependencies:[], bundles:{}, assets:{}, views:{} }]));
});
test('project settings isolate applications and allow arbitrary audio groups and calendar rules',()=>{
  const settings={formatVersion:1,appId:'com.example.puzzle',cleanupTimeoutMs:5000,maxAudioVoices:8,bindingPrefixes:{txt:'Label'},audioChannels:{ambient:0.5},calendar:{offsetMinutes:-300,weekStartsOn:0,resetMinute:90}};
  const options=settingsTools.runtimeOptions(settings);
  assert.equal(options.appId,'com.example.puzzle');assert.equal(options.audioChannels.ambient,0.5);
  assert.deepEqual(options.time.calendar,{offsetMinutes:-300,weekStartsOn:0,resetMinute:90});
  assert.throws(()=>settingsTools.runtimeOptions({...settings,appId:''}),/appId/);
  assert.throws(()=>settingsTools.runtimeOptions({...settings,calendar:{resetMinute:1440}}),/Invalid calendar/);
  assert.throws(()=>settingsTools.runtimeOptions({...settings,audioChannels:{ambient:2}}),/audio channel/);
});
test('generation refuses paths outside project and serialized engine asset writes',async()=>fixture(async(root)=>{
  assert.throws(()=>within(root,'../outside.ts'),/escapes project/);
  await assert.rejects(writeBatch(root,{'assets/test.prefab':'[]'}),/through the editor/);
}));
test('source checks detect inherited engine hooks, iterable spread and framework-to-game imports',async()=>fixture(async(root)=>{
  await mkdir(join(root,'assets/framework'),{recursive:true});await mkdir(join(root,'assets/game'),{recursive:true});
  await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2020',module:'ESNext',strict:true}}));
  await writeFile(join(root,'assets/framework/base.ts'),'export class Component {} export class GameComponent extends Component {}');
  await writeFile(join(root,'assets/game/example.ts'),"import { GameComponent as Base } from '../framework/base'; class Middle extends Base {} export class Example extends Middle { ['onLoad']() {} } const wrong=[...new Set([1])];");
  await writeFile(join(root,'assets/framework/wrong.ts'),"import {Example} from '../game/example'; export const wrong=Example;");
  const issues=await lifecycleCheck(root);
  assert.ok(issues.some(text=>text.includes('Reserved engine hook onLoad')));
  assert.ok(issues.some(text=>text.includes('Array.from')));
  assert.ok(issues.some(text=>text.includes('cannot import project')));
}));
