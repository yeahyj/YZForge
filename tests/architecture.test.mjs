import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import layout from '../tools/yzforge/project/layout.cjs';
import { modules } from '../tools/yzforge/project/project.mjs';
import { initializeState } from '../tools/yzforge/operations/initialize-state.mjs';
import { scanCatalog } from '../tools/yzforge/project/catalog.mjs';
import { publicContracts } from '../tools/yzforge/generators/public-contracts.mjs';
import { codeBoundaryCheck } from '../tools/yzforge/validation/checks.mjs';
import { architectureCheck } from '../tools/yzforge/validation/architecture.mjs';
import recovery from '../tools/yzforge/operations/recovery.cjs';

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-architecture-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    t.after(() => rm(root, { recursive: true, force: true }));
    const put = async (file, content) => {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await writeFile(join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
    };
    await put('tsconfig.json', { compilerOptions: { moduleResolution: 'node', target: 'ES2020' } });
    const module = {
        id: 'demo',
        layoutVersion: 3,
        code: { mode: 'eager' },
        dependencies: {},
        bundles: {},
        views: {},
        components: {},
    };
    const directory = join(root, 'assets/game/modules/demo');
    return { root, put, module, directory };
}
test('目录来自唯一规则，公开类型不随界面脚本移动，源声明拒绝路径覆盖', async (t) => {
    const f = await fixture(t);
    f.module.views.home = { className: 'demo.Home', visibility: 'public' };
    await f.put('assets/game/modules/demo/module.json', f.module);
    const [module] = await modules(f.root);
    assert.equal(module.views.home.script, 'code/ui/home/Home.ts');
    assert.equal(module.views.home.types, 'contracts/Home.types.ts');
    assert.equal(
        layout.importPath(module.views.home.binding, module.views.home.types),
        '../../../../contracts/Home.types',
    );
    assert.deepEqual(layout.sourceManifest(module), f.module);
    assert.throws(() => layout.resolveModule({ ...f.module, code: { mode: 'eager', root: 'elsewhere' } }), /固定目录/);
    assert.throws(
        () => layout.resolveModule({ ...f.module, views: { home: { ...f.module.views.home, binding: 'wrong.ts' } } }),
        /固定规则/,
    );
});
test('公开入口合并人工与本轮生成契约，排除过期生成物，数据模块不伪造业务引用', async (t) => {
    const f = await fixture(t),
        prefix = 'assets/game/modules/demo';
    await f.put(prefix + '/contracts/api.ts', 'export interface DemoApi { readonly ready: boolean }');
    await f.put(prefix + '/contracts/generated/obsolete.ts', 'export const Old = 1;');
    const output = { [prefix + '/contracts/generated/resources.ts']: 'export const DemoRes = {};' };
    const module = { ...f.module, directory: f.directory };
    await publicContracts(f.root, [module], output);
    assert.match(output[prefix + '/public.ts'], /DemoModule/);
    assert.match(output[prefix + '/public.ts'], /contracts\/generated\/resources/);
    assert.doesNotMatch(output[prefix + '/public.ts'], /obsolete/);
    module.code.mode = 'none';
    await publicContracts(f.root, [module], output);
    assert.doesNotMatch(output[prefix + '/public.ts'], /ModuleRef|DemoModule/);
});
test('类型引用和转导出不能穿透私有边界，应用装配只允许 eager 工厂', async (t) => {
    const f = await fixture(t),
        prefix = 'assets/game/modules/demo',
        module = { ...f.module, directory: f.directory };
    await f.put(prefix + '/code/Service.ts', 'export class Service {}');
    await f.put(prefix + '/contracts/api.ts', "export type { Service } from '../code/Service';");
    await assert.rejects(codeBoundaryCheck(f.root, [module]), /包含类型引用/);
    await f.put(prefix + '/contracts/api.ts', 'export interface DemoApi {}');
    await f.put(prefix + '/public.ts', "export * from './contracts/api';");
    await f.put('assets/game/app/start.ts', "import type { DemoApi } from '../modules/demo/contracts/api';");
    await assert.rejects(codeBoundaryCheck(f.root, [module]), /只使用 public.ts/);
    await f.put('assets/game/app/start.ts', "import type { DemoApi } from '../modules/demo/public';");
    await f.put(
        'assets/game/app/generated/assembly.ts',
        "import { Service } from '../../modules/demo/code/Service'; export const factory=Service;",
    );
    await codeBoundaryCheck(f.root, [module]);
    module.code = { mode: 'bundled' };
    await assert.rejects(codeBoundaryCheck(f.root, [module]), /模块边界/);
});
test('基础层、组件实现与公开入口的传递依赖接受架构检查', async (t) => {
    const f = await fixture(t),
        module = { ...f.module, directory: f.directory };
    await f.put(
        'assets/framework/ui/widget.ts',
        "import { Component } from 'cc'; export class Widget extends Component {}",
    );
    await f.put(
        'assets/framework/components/host.ts',
        "import { Widget } from '../ui/widget'; export const widget=Widget;",
    );
    await assert.rejects(architectureCheck(f.root, [module]), /组件基础设施不能加载/);
    await f.put('assets/framework/components/host.ts', 'export const host=1;');
    await f.put(
        'assets/framework/core/token.ts',
        "import type { Widget } from '../ui/widget'; export type Token=Widget;",
    );
    await assert.rejects(architectureCheck(f.root, [module]), /core 只能依赖/);
    await f.put('assets/framework/core/token.ts', 'export const token=1;');
    await f.put(
        'assets/game/modules/demo/contracts/widget.ts',
        "export { Widget } from '../../../../framework/ui/widget';",
    );
    await f.put('assets/game/modules/demo/public.ts', "export * from './contracts/widget';");
    await assert.rejects(architectureCheck(f.root, [module]), /公开入口会加载/);
});
test('值依赖循环被拒绝，纯类型循环不制造运行时循环', async (t) => {
    const f = await fixture(t);
    await f.put('assets/framework/core/a.ts', "import { b } from './b'; export const a=()=>b;");
    await f.put('assets/framework/core/b.ts', "import { a } from './a'; export const b=()=>a;");
    await assert.rejects(architectureCheck(f.root, []), /循环依赖/);
    await f.put('assets/framework/core/a.ts', "import type { B } from './b'; export interface A { next: B }");
    await f.put('assets/framework/core/b.ts', "import type { A } from './a'; export interface B { next: A }");
    await architectureCheck(f.root, []);
});

test('组件通过能力接口消费服务，纯类型引用也不能重新耦合具体管理器', async (t) => {
    const f = await fixture(t);
    await f.put('assets/framework/assets/asset-manager.ts', 'export class Assets {}');
    await f.put('assets/framework/assets/asset-access.ts', 'export interface AssetAccess { load():void }');
    await f.put(
        'assets/framework/components/host.ts',
        "export type Service = import('../assets/asset-manager').Assets;",
    );
    await assert.rejects(architectureCheck(f.root, []), /应依赖能力接口/);
    await f.put(
        'assets/framework/components/host.ts',
        "export type Service = import('../assets/asset-access').AssetAccess;",
    );
    await architectureCheck(f.root, []);
});

test('内联类型、typeof import、import equals 和静态模板导入遵守相同边界', async (t) => {
    const f = await fixture(t);
    for (const text of [
        "export type Node = import('cc').Node;",
        "export type Engine = typeof import('cc');",
        "import Engine = require('cc'); export const engine=Engine;",
        'export const engine = import(`cc`);',
    ]) {
        await f.put('assets/framework/core/probe.ts', text);
        await assert.rejects(architectureCheck(f.root, []), /core 只能依赖/);
    }
    await f.put('assets/framework/core/probe.ts', 'export const x=1;');
    await f.put('assets/game/modules/demo/code/private.ts', 'export type Value = string;');
    await f.put('tsconfig.json', {
        compilerOptions: {
            moduleResolution: 'node',
            baseUrl: '.',
            paths: { '@demo/*': ['assets/game/modules/demo/*'] },
        },
    });
    for (const text of [
        "export type Value = import('@demo/code/private').Value;",
        "export type Value = typeof import('@demo/code/private');",
        "import Value = require('@demo/code/private'); export { Value };",
        'export const value = import(`@demo/code/private`);',
    ]) {
        await f.put('assets/game/boot/probe.ts', text);
        await assert.rejects(codeBoundaryCheck(f.root, [{ ...f.module, directory: f.directory }]), /模块边界/);
    }
    await f.put('assets/game/boot/probe.ts', "const name='./private'; export const value=import(name);");
    await assert.rejects(codeBoundaryCheck(f.root, []), /静态字符串/);
    await f.put('assets/game/boot/probe.ts', "import { value } from './missing'; export { value };");
    await assert.rejects(codeBoundaryCheck(f.root, []), /无法解析/);
});
test('资源身份缺失不能静默重建，初始化拒绝覆盖已有项目', async (t) => {
    const f = await fixture(t);
    await assert.rejects(scanCatalog(f.root, [], new Map(), { tables: [] }), /缺少资源身份状态/);
    await initializeState(f.root);
    const identity = await readFile(join(f.root, 'project-settings/state/resource-identities.json'), 'utf8');
    await assert.rejects(initializeState(f.root), /项目状态已存在/);
    assert.equal(await readFile(join(f.root, 'project-settings/state/resource-identities.json'), 'utf8'), identity);
    const other = await fixture(t);
    await other.put('assets/game/modules/demo/bundles/default/yz-index.json', {});
    await assert.rejects(initializeState(other.root), /禁止重新分配资源身份/);
});

test('删除恢复比较源声明，忽略推导路径且拒绝覆盖真正的后续修改', async (t) => {
    const f = await fixture(t),
        id = '1790000000000-abcd',
        original = 'assets/game/modules/demo';
    const before = { ...f.module, bundles: { default: { id: 'demo-default' } } };
    const after = { ...before, bundles: {} };
    const record = {
        id,
        stage: 'deleted',
        original,
        manifest: layout.resolveModule(before),
        preview: { nextManifest: layout.resolveModule(after), targets: [] },
        files: [],
        assets: [],
        workbookChanges: [],
    };
    await f.put(`.yzforge/trash/${id}/record.json`, record);
    await f.put(original + '/module.json', after);
    const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
    const engine = recovery.createRecovery({
        inside: (file) => resolve(f.root, file),
        read,
        root: () => f.root,
        workbookTools: async () => ({}),
        saveJson: async (file, value) => writeFile(file, JSON.stringify(layout.sourceManifest(value))),
    });
    await engine.restore({ id });
    assert.deepEqual(await read(resolve(f.directory, 'module.json')), before);
    await f.put(`.yzforge/trash/${id}/record.json`, record);
    await f.put(original + '/module.json', { ...after, displayName: 'user change' });
    await assert.rejects(engine.restore({ id }), /清单已修改/);
    assert.equal((await read(resolve(f.directory, 'module.json'))).displayName, 'user change');
});
