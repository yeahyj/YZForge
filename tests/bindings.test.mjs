import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { scanBindings, bindingShape } from '../tools/yzforge/binding-scan.cjs';
import { componentExport, resolveBindingFields, bindingSource, bindingPlan } from '../tools/yzforge/bindings.cjs';
import { runtimeOptions } from '../tools/yzforge/settings.cjs';

function engine() {
    class Component {}
    class Button extends Component {}
    class Label extends Component {}
    class UITransform extends Component {}
    class Node {
        constructor(name, components = [], children = []) {
            Object.assign(this, { name, components, children });
        }
        getComponents(ctor) {
            return this.components.filter((value) => value instanceof ctor);
        }
        getComponent(ctor) {
            return this.getComponents(ctor)[0];
        }
    }
    const cc = {
        Component,
        Button,
        Label,
        UITransform,
        Node,
        js: {
            getClassName: (ctor) =>
                Object.values(cc).includes(ctor) ? 'cc.' + ctor.name : ctor.registered || ctor.name,
            _getClassId: (ctor) => ctor.id || 'script-' + ctor.name,
        },
    };
    class AsyncButton extends Button {}
    class Switch extends Component {}
    class Badge extends Component {}
    return { cc, AsyncButton, Switch, Badge };
}
const prefixes = { node: 'Node', btn: 'Button', lbl: 'Label', comp: 'Component' };

test('绑定保留 Node，推导原生控件子类，comp 忽略引擎组件', () => {
    const { cc, AsyncButton, Switch } = engine();
    const root = new cc.Node(
        'Root',
        [],
        [
            new cc.Node('btn_submit', [new AsyncButton()]),
            new cc.Node('comp_state', [new cc.UITransform(), new cc.Label(), new Switch()]),
            new cc.Node('node_any', [new AsyncButton(), new Switch()]),
            new cc.Node('lbl_title', [new cc.Label()]),
        ],
    );
    const fields = scanBindings(cc, root, prefixes);
    assert.deepEqual(
        fields.map(({ name }) => name),
        ['btnSubmit', 'compState', 'nodeAny', 'lblTitle'],
    );
    assert.equal(fields[0].custom.className, 'AsyncButton');
    assert.equal(fields[1].target, root.children[1].components[2]);
    assert.equal(fields[2].target, root.children[2]);
    assert.equal(fields[2].custom, undefined);
    assert.equal(fields[3].custom, undefined);
    assert.ok(bindingShape(fields).every((field) => !('target' in field)));
});

test('多个匹配组件按 Inspector 顺序取第一个，重排后选择随之更新', () => {
    const { cc, AsyncButton, Switch, Badge } = engine();
    const node = new cc.Node('comp_state', [new cc.UITransform(), new Switch(), new Badge()]);
    assert.equal(scanBindings(cc, node, prefixes)[0].target, node.components[1]);
    node.components.reverse();
    assert.equal(scanBindings(cc, node, prefixes)[0].custom.className, 'Badge');
    const button = new cc.Node('btn_submit', [new cc.Button(), new AsyncButton()]);
    assert.equal(scanBindings(cc, button, prefixes)[0].custom, undefined);
    button.components.reverse();
    assert.equal(scanBindings(cc, button, prefixes)[0].custom.className, 'AsyncButton');
});

test('缺失、重名和无效下划线报错，不改动节点或字段', () => {
    const { cc } = engine();
    for (const [node, message] of [
        [new cc.Node('comp_empty', [new cc.UITransform()]), /未找到 自定义组件/],
        [new cc.Node('btn_empty'), /未找到 Button/],
        [new cc.Node('node_bad__name'), /下划线/],
        [new cc.Node('node_bad_'), /下划线/],
        [new cc.Node('Root', [], [new cc.Node('node_a_b'), new cc.Node('node_aB')]), /绑定名称重复/],
    ]) {
        const before = JSON.stringify(node);
        assert.throws(() => scanBindings(cc, node, prefixes), message);
        assert.equal(JSON.stringify(node), before);
    }
});

test('扫描包括非激活节点和嵌套根，不越过嵌套预制体的绑定边界', () => {
    const { cc, Switch } = engine();
    const nested = new cc.Node('comp_part', [new Switch()], [new cc.Node('btn_missing')]);
    nested._prefab = { root: nested };
    const inactive = new cc.Node('node_hidden');
    inactive.active = false;
    assert.deepEqual(
        scanBindings(cc, new cc.Node('Root', [], [nested, inactive]), prefixes).map((field) => field.name),
        ['compPart', 'nodeHidden'],
    );
});

async function fixture(t) {
    const folder = await mkdtemp(join(tmpdir(), 'yzforge-bindings-'));
    t.after(async () => {
        assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep));
        await rm(folder, { recursive: true, force: true });
    });
    return async (name, source) => {
        const file = join(folder, name + '.ts');
        await writeFile(file, source);
        return file;
    };
}
test('脚本解析支持文件名与类名不同、导出别名、多类、默认与匿名默认导出', async (t) => {
    const make = await fixture(t);
    for (const [source, custom, exported] of [
        ['@ccclass("ui.Submit") export class Submit {}', { className: 'ui.Submit', runtimeName: 'Submit' }, 'Submit'],
        ['@ccclass("ui.Submit") class Submit {} export { Submit as Action };', { className: 'ui.Submit' }, 'Action'],
        [
            'export class Other {} @ccclass("ui.Submit") export default class Submit {}',
            { className: 'ui.Submit' },
            'default',
        ],
        ['@ccclass("ui.Submit") export default class {}', { className: 'ui.Submit' }, 'default'],
        ['class Submit {} export default Submit;', { runtimeName: 'Submit' }, 'default'],
        ['@ccclass(NAME) export class Submit {}', { runtimeName: 'Submit' }, 'Submit'],
    ])
        assert.equal(componentExport(await make('unrelated-file', source), custom), exported);
});

test('未导出的组件、错误注册名和无法唯一匹配的类拒绝生成', async (t) => {
    const make = await fixture(t);
    for (const source of [
        '@ccclass("ui.Submit") class Submit {} export class Other {}',
        'export class Other {}',
        '@ccclass("ui.Submit") export class A {} @ccclass("ui.Submit") export class B {}',
    ]) {
        const file = await make('invalid', source);
        assert.throws(() => componentExport(file, { className: 'ui.Submit', runtimeName: 'Submit' }), /无法唯一确定/);
    }
});

test('仅从 ccclass 读取注册名，忽略 menu 等其他装饰器并识别别名', async (t) => {
    const make = await fixture(t);
    const file = await make(
        'decorators',
        `
const REGISTRY_NAME = 'demo.Actual';
@ccclass(REGISTRY_NAME) export class Actual { actualOnly() {} }
@menu('demo.Actual') @ccclass('demo.Other') export class Other { otherOnly() {} }
`,
    );
    assert.equal(componentExport(file, { className: 'demo.Actual', runtimeName: 'Actual' }), 'Actual');
    for (const [setup, decorator] of [
        ['const { ccclass: register } = _decorator;', 'register'],
        ['const register = _decorator.ccclass;', 'register'],
        ['', '_decorator.ccclass'],
    ]) {
        const file = await make('alias', `${setup} @${decorator}('demo.Anonymous') export default class {}`);
        assert.equal(componentExport(file, { className: 'demo.Anonymous' }), 'default');
    }
});

test('界面与 Part 更新绑定前及写回前检查未保存状态，阻止旧资产覆盖编辑', async () => {
    const mainSource = await readFile(new URL('../extensions/yzforge-editor/main.js', import.meta.url), 'utf8');
    const source = ts.createSourceFile('main.js', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const functions = source.statements.filter(
        (statement) =>
            ts.isFunctionDeclaration(statement) &&
            ['bindView', 'assertBindingSceneSaved'].includes(statement.name?.text),
    );
    const workbenchSource = await readFile(
        new URL('../extensions/yzforge-editor/workbench.js', import.meta.url),
        'utf8',
    );
    const require = createRequire(new URL('../extensions/yzforge-editor/workbench.js', import.meta.url));
    for (const method of ['bindView', 'bindComponent'])
        for (const dirtyAt of [1, 2, 0]) {
            let checks = 0,
                scans = 0,
                writes = 0;
            const definition = {
                uuid: 'prefab',
                className: 'demo.Part',
                binding: 'generated/PartBinding.ts',
                prefab: 'resource',
            };
            const context = {
                moduleInfo: async () => ({
                    directory: 'module',
                    manifest: { id: 'demo', views: { part: definition }, components: { part: definition } },
                }),
                resourceIdentity: async () => ({ uuid: 'prefab' }),
                read: async () => ({ bindingPrefixes: prefixes }),
                inside: (value) => value,
                rel: (value) => value,
                url: (value) => value,
                writeScript: async () => {},
                waitClass: async () => {},
                journal: async () => {},
                bindingSource: () => 'source',
                resolveBindingFields: async () => [],
                bindingPlan,
                formatScript: async (_file, value) => value,
                bindings: { bindingPlan },
                fs: { readFile: async () => 'previous' },
                path: require('path'),
                scene: async (method) => {
                    if (method === 'scanPrefab') {
                        scans++;
                        return [];
                    }
                    if (method === 'bindPrefab') return { content: 'prefab-content' };
                    return { bound: 0 };
                },
                Editor: {
                    Message: {
                        request: async (target, action, id) => {
                            if (target === 'scene' && action === 'query-dirty') return ++checks === dirtyAt;
                            if (target === 'asset-db' && action === 'save-asset' && id === 'prefab') writes++;
                        },
                    },
                },
                require: (name) => (name === 'fs/promises' ? context.fs : require(name)),
                exports: {},
                setTimeout,
            };
            vm.createContext(context);
            vm.runInContext(functions.map((declaration) => declaration.getText(source)).join('\n'), context);
            vm.runInContext(workbenchSource, context);
            const action =
                method === 'bindView' ? context.bindView : context.exports.createWorkbench(context).bindComponent;
            if (dirtyAt) await assert.rejects(action({ module: 'demo', id: 'part' }), /请先保存/);
            else await action({ module: 'demo', id: 'part' });
            assert.equal(scans, dirtyAt === 1 ? 0 : 1);
            assert.equal(writes, dirtyAt ? 0 : 1);
            assert.equal(checks, dirtyAt === 1 ? 1 : 2);
        }
});

test('具体类型使用去重 type-only 导入，重名安全，序列化继续使用原生类型', async (t) => {
    const make = await fixture(t);
    const file = await make('not-class-name', '@ccclass("ui.Submit") export class Button {}');
    const raw = [
        {
            name: 'btnSubmit',
            field: '_bindBtnSubmit',
            type: 'Button',
            path: 'btn_submit',
            nodeName: 'btn_submit',
            custom: { classId: 'uuid', className: 'ui.Submit', runtimeName: 'Button' },
        },
    ];
    let queries = 0;
    const fields = await resolveBindingFields(
        [...raw, { ...raw[0], name: 'btnAgain', field: '_bindBtnAgain' }],
        join(file, '..', 'generated'),
        async () => {
            queries++;
            return file;
        },
    );
    assert.equal(queries, 1);
    const source = bindingSource('demo', 'Page', fields, '../../../framework');
    assert.match(source, /import type \{ Button as Button2 \}/);
    assert.equal((source.match(/import type \{ Button/g) || []).length, 1);
    assert.match(source, /get btnSubmit\(\): Button2/);
    assert.match(source, /@property\(\{ type: Button, visible: false \}\)/);
    assert.match(source, /__yzforgeBindingSignature: string/);
    const emitted = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, experimentalDecorators: true, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    assert.ok(!emitted.includes('not-class-name'), '自定义类导入不能出现在运行时');
    assert.match(emitted, /type: Button/);
    await assert.rejects(
        resolveBindingFields(raw, '.', async () => null),
        /找不到/,
    );
    assert.deepEqual(
        bindingPlan(fields).fields,
        bindingShape(raw.concat({ ...raw[0], name: 'btnAgain', field: '_bindBtnAgain' })),
    );
    assert.notEqual(
        bindingPlan(fields).signature,
        bindingPlan(fields.map((field) => ({ ...field, imported: { ...field.imported, exported: 'Renamed' } })))
            .signature,
    );
});

test('默认导出、跨文件同名类和 Part 使用同一生成器', () => {
    const fields = ['a', 'b', 'c'].map((id) => ({
        name: 'comp' + id.toUpperCase(),
        field: '_bindComp' + id.toUpperCase(),
        type: 'Component',
        nodeName: 'comp_' + id,
        custom: { runtimeName: 'Item' },
        imported: { module: '../' + id, exported: id === 'c' ? 'default' : 'Item' },
    }));
    const source = bindingSource('demo', 'ItemPart', fields, '../../../framework', true);
    assert.match(source, /import type \{ Item \} from "..\/a"/);
    assert.match(source, /import type \{ Item as Item2 \} from "..\/b"/);
    assert.match(source, /import type Item3 from "..\/c"/);
    assert.match(source, /extends GameComponent/);
    assert.match(source, /get compC\(\): Item3/);
});

test('中文类名和关键字导出别名生成合法导入，不与保留字冲突', async (t) => {
    const make = await fixture(t);
    const file = await make('中文文件', '@ccclass("ui.提示") class 提示组件 {} export { 提示组件 as class };');
    const custom = { className: 'ui.提示', runtimeName: '提示组件' };
    assert.equal(componentExport(file, custom), 'class');
    const fields = [
        {
            name: 'compTip',
            field: '_bindCompTip',
            type: 'Component',
            nodeName: 'comp_tip',
            custom,
            imported: { module: '../中文文件', exported: 'class' },
        },
    ];
    const source = bindingSource('demo', 'TipPart', fields, '../../../framework', true);
    assert.match(source, /import type \{ class as BoundComponent \}/);
    assert.deepEqual(
        ts.createSourceFile('TipPartBinding.ts', source, ts.ScriptTarget.Latest, true).parseDiagnostics,
        [],
    );
    assert.equal(
        componentExport(await make('中文命名', '@ccclass("ui.提示") export class 提示组件 {}'), custom),
        '提示组件',
    );
});

test('写回前核对编译签名和扫描结构，失败不清空已有引用', async () => {
    const { cc } = engine();
    class View extends cc.Component {}
    View.__props__ = ['_bindBtnSubmit', '_bindOld'];
    cc.js.getClassByName = () => View;
    cc.Prefab = class Prefab {};
    const prefab = new cc.Prefab(),
        view = new View(),
        old = {};
    view._bindBtnSubmit = old;
    view._bindOld = old;
    prefab.data = new cc.Node('Root', [view], [new cc.Node('btn_submit', [new cc.Button()])]);
    cc.assetManager = { loadAny: (_uuid, callback) => callback(null, prefab) };
    const exports = {},
        cce = { Utils: { serialize: () => 'serialized' } };
    vm.runInNewContext(await readFile(new URL('../extensions/yzforge-editor/scene.js', import.meta.url), 'utf8'), {
        exports,
        global: { cce },
        cce,
        require: (name) => (name === 'cc' ? cc : name === 'crypto' ? {} : { scanBindings, bindingShape }),
    });
    const fields = bindingShape(scanBindings(cc, prefab.data, prefixes)),
        plan = bindingPlan(fields);
    await assert.rejects(exports.methods.bindPrefab('id', 'View', prefixes, plan), /not compiled yet/);
    assert.equal(view._bindBtnSubmit, old);
    View.__yzforgeBindingSignature = plan.signature;
    await assert.rejects(exports.methods.bindPrefab('id', 'View', prefixes, { ...plan, fields: [] }), /发生变化/);
    assert.equal(view._bindOld, old);
    await exports.methods.bindPrefab('id', 'View', prefixes, plan);
    assert.equal(view._bindOld, null);
    assert.equal(view._bindBtnSubmit, prefab.data.children[0].components[0]);
});

test('项目配置允许 comp 映射 Component，保留原有命名映射', async () => {
    const settings = JSON.parse(await readFile(new URL('../project-settings/framework.json', import.meta.url), 'utf8'));
    assert.equal(settings.bindingPrefixes.comp, 'Component');
    assert.doesNotThrow(() => runtimeOptions(settings));
});
