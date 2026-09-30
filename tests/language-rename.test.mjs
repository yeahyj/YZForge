import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import {
    planLanguageRename,
    applyLanguageRename,
    restoreLanguageRename,
    languageRenameHistory,
} from '../tools/yzforge/operations/language-rename.mjs';

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-language-rename-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    t.after(() => rm(root, { recursive: true, force: true }));
    const put = async (path, value) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
    };
    const moduleRoot = 'assets/game/modules/shop',
        request = { module: 'shop', bundle: 'default', from: 'images/logo', to: 'pictures/welcome' };
    await put(moduleRoot + '/module.json', {
        id: 'shop',
        layoutVersion: 3,
        code: { mode: 'eager' },
        bundles: { default: { id: 'shop-default', localization: { locales: { 'zh-CN': {}, en: {} } } } },
    });
    await put('project-settings/framework.json', {
        localization: { defaultLocale: 'zh-CN', locales: ['zh-CN', 'en'] },
    });
    const entries = {};
    for (const [locale, uuid] of [
        ['zh-CN', 'zh-image'],
        ['en', 'en-image'],
    ]) {
        const source = `${moduleRoot}/localization/default/${locale}/dynamic/images/logo.png`,
            id = `shop/default-${locale}/sprite/logo`;
        entries[uuid + '@sprite'] = { id, type: 'SpriteFrame', active: true, source };
        await put(source, 'image-' + locale);
        await put(source + '.meta', { uuid, importer: 'image', userData: { keep: true } });
        await put(`${moduleRoot}/localization/default/${locale}/yz-locale.json`, {
            assets: { 'images/logo': { id, type: 'SpriteFrame' } },
        });
    }
    await put('project-settings/state/resource-identities.json', { formatVersion: 2, entries });
    await put('assets/framework/ui/localization/localized-sprite.ts.meta', { uuid: 'sprite-class' });
    const prefab = moduleRoot + '/bundles/default/dynamic/ui/Home.prefab';
    await put(prefab, [
        {
            __type__: 'sprite-class',
            key: 'images/logo',
            node: { __id__: 1 },
            __prefab: { fileId: 'unchanged-component' },
        },
        { _name: 'Image', _id: 'unchanged-node' },
        { __type__: 'sprite-class', key: 'images/logo', namespace: 'other/default' },
    ]);
    await put(prefab + '.meta', { uuid: 'home-prefab' });
    const script = moduleRoot + '/code/page.ts';
    await put(
        script,
        "import { ShopI18n as I18n } from '../public';\nexport const image = I18n.asset['images/logo'];\nfunction shadow(I18n: any) { return I18n.asset['images/logo']; }\n",
    );
    const adapter = {
        async assertClean() {},
        async move(from, to) {
            await mkdir(dirname(join(root, to)), { recursive: true });
            await rename(join(root, from), join(root, to));
            await rename(join(root, from + '.meta'), join(root, to + '.meta'));
        },
        async save(path, text) {
            await put(path, text);
        },
    };
    const plan = () => planLanguageRename(root, request);
    const read = (path) => readFile(join(root, path), 'utf8');
    return { root, put, read, request, plan, adapter, script, prefab, moduleRoot };
}

test('改名同步语言、原生图片键与静态契约引用，UUID 和实例标识保留，可完整恢复', async (t) => {
    const f = await fixture(t),
        beforeScript = await f.read(f.script),
        beforePrefab = await f.read(f.prefab),
        plan = await f.plan();
    assert.equal(plan.moves.length, 2);
    assert.equal(plan.updates.length, 2);
    assert.deepEqual(plan.unresolved, []);
    const result = await applyLanguageRename(f.root, { ...f.request, signature: plan.signature }, f.adapter);
    assert.equal(result.stage, 'applied');
    for (const move of plan.moves) {
        assert.equal(JSON.parse(await f.read(move.to + '.meta')).uuid, move.uuid);
        await assert.rejects(f.read(move.from), { code: 'ENOENT' });
    }
    assert.match(await f.read(f.script), /export const image = I18n.asset\['pictures\/welcome'\]/);
    assert.match(await f.read(f.script), /return I18n.asset\['images\/logo'\]/);
    const saved = JSON.parse(await f.read(f.prefab));
    assert.equal(saved[0].key, 'pictures/welcome');
    assert.equal(saved[0].__prefab.fileId, 'unchanged-component');
    assert.equal(saved[2].key, 'images/logo');
    await restoreLanguageRename(f.root, result.id, f.adapter);
    assert.equal(await f.read(f.script), beforeScript);
    assert.equal(await f.read(f.prefab), beforePrefab);
    assert.deepEqual(await languageRenameHistory(f.root), []);
});

test('改名前验证签名和所有目标，阻止覆盖已有文件及不可追踪的引用', async (t) => {
    const f = await fixture(t),
        plan = await f.plan();
    await f.put(f.script, (await f.read(f.script)) + '\n// edited\n');
    await assert.rejects(
        applyLanguageRename(f.root, { ...f.request, signature: plan.signature }, f.adapter),
        /重新预览/,
    );
    assert.deepEqual(await languageRenameHistory(f.root), []);
    await f.put(plan.moves[0].to, 'occupied');
    await assert.rejects(f.plan(), /目标文件已存在/);
    const g = await fixture(t);
    await g.put(
        g.script,
        "import * as Public from '../public'; const key='images/logo'; const item=Public.ShopI18n.asset[key]; const alias=Public.ShopI18n.asset; api.assetKey('images/logo','SpriteFrame');",
    );
    const blocked = await g.plan();
    assert.equal(blocked.unresolved.length, 3);
    await assert.rejects(
        applyLanguageRename(g.root, { ...g.request, signature: blocked.signature }, g.adapter),
        /不能自动处理/,
    );
});

test('Creator 移动已完成但响应失败时，恢复根据实际 UUID 和位置识别进度', async (t) => {
    const f = await fixture(t),
        plan = await f.plan();
    let moves = 0;
    const failing = {
        ...f.adapter,
        async move(...args) {
            await f.adapter.move(...args);
            if (++moves === 1) throw Error('lost response');
        },
    };
    await assert.rejects(
        applyLanguageRename(f.root, { ...f.request, signature: plan.signature }, failing),
        /已保存，可恢复/,
    );
    const [record] = await languageRenameHistory(f.root);
    assert.equal(record.stage, 'interrupted');
    await restoreLanguageRename(f.root, record.id, f.adapter);
    for (const move of plan.moves) assert.equal(JSON.parse(await f.read(move.from + '.meta')).uuid, move.uuid);
});

test('恢复先核对全部引用，遇到后续编辑时不移动任何资源、不覆盖人工内容', async (t) => {
    const f = await fixture(t),
        plan = await f.plan();
    const result = await applyLanguageRename(f.root, { ...f.request, signature: plan.signature }, f.adapter);
    await f.put(f.script, '// new work');
    await assert.rejects(restoreLanguageRename(f.root, result.id, f.adapter), /后续编辑/);
    for (const move of plan.moves) await f.read(move.to);
    assert.equal(await f.read(f.script), '// new work');
});

test('路径前缀改名更新全部键，未解析的实例覆盖阻止自动修改', async (t) => {
    const f = await fixture(t);
    f.request.from = 'images';
    f.request.to = 'textures';
    const plan = await f.plan();
    assert.ok(plan.moves.every((move) => move.to.endsWith('/textures/logo.png')));
    await f.put(f.prefab, [...JSON.parse(await f.read(f.prefab)), { propertyPath: ['key'], value: 'images/logo' }]);
    const blocked = await f.plan();
    assert.equal(blocked.unresolved.length, 1);
    await assert.rejects(
        applyLanguageRename(f.root, { ...f.request, signature: blocked.signature }, f.adapter),
        /不能自动处理/,
    );
});
