import assert from 'node:assert/strict';
import { readFile, rename, readdir, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { call } from '../../tools/yzforge/mcp.mjs';
import { readWorkbook, writeWorkbookConfig } from '../../tools/yzforge/workbooks.mjs';
const root = resolve(import.meta.dirname, '../..');
const module = 'workbench-check-' + Date.now().toString(36);
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
const action = async (name, input = {}) => {
    const result = await editor(
        'return await Editor.Message.request("yzforge-editor", "dispatch", args.name, args.input);',
        { name, input },
    );
    assert.ok(!result?.generationError, result?.generationError);
    return result;
};
const state = () => editor('return await Editor.Message.request("yzforge-editor", "state");');
async function create(input) {
    const preview = await action('previewCreate', input);
    assert.deepEqual(preview.conflicts, []);
    return action('create', { request: preview.request, signature: preview.signature });
}
async function until(check) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw Error('Automatic generation timed out');
}
const initial = await state();
assert.ok(
    ![...initial.modules, ...initial.orphans].some((item) => item.id === module),
    'Previous fixture exists; inspect it before retrying',
);
await create({ kind: 'module', id: module, codeOnly: true, displayName: '工作台集成验证' });
let removed = false,
    passed = false;
try {
    assert.deepEqual((await state()).modules.find((item) => item.id === module).bundles, {});
    await create({ kind: 'service', id: 'Inventory', module });
    await create({ kind: 'component', id: 'Movement', module });
    await create({ kind: 'bundle', id: 'default', module });
    const empty = await action('previewDelete', { module, kind: 'bundle', id: 'default' });
    assert.deepEqual(empty.references, []);
    const emptyDeleted = await action('deleteModule', empty);
    await action('restore', { id: emptyDeleted.restoreId });
    console.log('PASS: code-only module, role suffixes, and standalone default bundle deletion/restoration');
    const part = await create({ kind: 'part', id: 'Item', module, bundle: 'default' });
    assert.equal(part.className, module + '.ItemPart');
    await call('inspect_prefab', { target: part.uuid });
    const changed = await call('execute_javascript', {
        context: 'scene',
        args: { uuid: part.uuid },
        code: 'const prefab=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(error,value)=>error?no(error):yes(value)));if(prefab.data.children.length)throw Error("Expected the newly created empty fixture");const rootId=prefab.data._prefab.fileId;const child=new cc.Node("lbl_title");child.layer=prefab.data.layer;child.addComponent(cc.Label).string="Part binding";prefab.data.addChild(child);const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;child._prefab=new PrefabInfo();child._prefab.root=prefab.data;child._prefab.asset=prefab;child._prefab.fileId=require("crypto").randomBytes(16).toString("base64").replace(/=+$/,"");for(const component of child.components){component.__prefab=new CompPrefabInfo();component.__prefab.fileId=require("crypto").randomBytes(16).toString("base64").replace(/=+$/,"");}const serialized=cce.Utils.serialize(prefab);return {rootId,content:typeof serialized==="string"?serialized:JSON.stringify(serialized)};',
    });
    const serialized = changed.data.result ?? changed.data;
    await editor('await Editor.Message.request("asset-db", "save-asset", args.uuid, args.content); return true;', {
        uuid: part.uuid,
        content: serialized.content,
    });
    const binding = await action('bindComponent', { module, id: 'item-part' });
    assert.equal(binding.bound, 1);
    assert.deepEqual(binding.fields, ['lblTitle']);
    await create({ kind: 'popup', id: 'Reward', module, bundle: 'default', presenter: true });
    await create({ kind: 'table', id: 'entries', module, bundle: 'default' });
    console.log('PASS: Part binding is serialized without dragging; Popup/Presenter and XLSX outputs are generated');
    const workbookSource = 'config-source/' + module + '/entries.xlsx';
    const tablePath = resolve(root, 'assets/game/modules/' + module + '/bundles/default/dynamic/config/entries.json');
    let workbook = await readWorkbook(root, workbookSource);
    try {
        await writeWorkbookConfig(root, workbookSource, { ...workbook.config, enabled: false }, workbook.hash);
        await until(async () => {
            try {
                await readFile(tablePath);
                return false;
            } catch (error) {
                if (error.code === 'ENOENT') return true;
                throw error;
            }
        });
    } finally {
        workbook = await readWorkbook(root, workbookSource);
        await writeWorkbookConfig(root, workbookSource, { ...workbook.config, enabled: true }, workbook.hash);
    }
    await until(async () => {
        try {
            return JSON.parse(await readFile(tablePath, 'utf8')).tableId === module + '.entries';
        } catch (error) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
    });
    console.log('PASS: external XLSX changes automatically remove and regenerate table outputs');
    const preview = await action('previewDelete', { module, kind: 'module' });
    assert.deepEqual(preview.references, []);
    assert.equal(preview.workbooks.length, 1);
    const deleted = await action('deleteModule', preview);
    removed = true;
    const restored = await action('restore', { id: deleted.restoreId });
    removed = false;
    const validation = await editor(
        'return await Editor.Message.request("scene", "execute-scene-script", {name:"yzforge-editor",method:"validateBinding",args:[args.uuid,args.className,args.prefixes]});',
        { uuid: part.uuid, className: part.className, prefixes: initial.settings.bindingPrefixes },
    );
    assert.equal(validation.bound, 1);
    assert.equal((await readWorkbook(root, workbookSource)).config.enabled, true);
    console.log(JSON.stringify({ restored, binding: validation }));
    console.log('PASS: complete module recovery preserves UUIDs, inherited node references and workbook settings');
    await action('check');
    passed = true;
} finally {
    if (passed && !process.argv.includes('--keep-for-build')) {
        if (!removed) {
            const preview = await action('previewDelete', { module, kind: 'module' });
            assert.deepEqual(preview.references, [], 'Fixture acquired external references; preserved for review');
            await action('deleteModule', preview);
            removed = true;
        }
        const source = resolve(root, 'config-source', module);
        const names = await readdir(source).catch((error) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        if (names.length) {
            assert.deepEqual(names, ['entries.xlsx']);
            const target = resolve(root, '.yzforge/trash/test-source-' + Date.now());
            assert.ok(relative(root, source).startsWith('config-source'));
            assert.ok(relative(root, target).startsWith('.yzforge'));
            await mkdir(resolve(root, '.yzforge/trash'), { recursive: true });
            await rename(source, target);
        }
    }
}
console.log(JSON.stringify({ ok: true, keptForBuild: !removed, module }));
