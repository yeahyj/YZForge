import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { scanCatalog } from '../tools/yzforge/catalog.mjs';
import layout from '../tools/yzforge/localization-layout.cjs';
import {
    compileLocalization,
    createLocalizationWorkbook,
    localizationDeclarations,
    languageResources,
} from '../tools/yzforge/localization.mjs';
import {
    readWorkbook,
    workbookSources,
    writeLocalizationWorkbook,
    writeWorkbookConfig,
} from '../tools/yzforge/workbooks.mjs';
const settings = { localization: { defaultLocale: 'zh-CN', locales: ['zh-CN', 'en', 'ja'] } };
test('自动归属按声明目录边界解析，排除语言包、相似目录和模块代码', () => {
    const directory = join(tmpdir(), 'source-module');
    const modules = [
        {
            id: 'shared',
            directory,
            bundles: {
                default: { id: 'shared', root: 'bundles/default', localization: { locales: { 'zh-CN': {} } } },
                extra: { id: 'shared-extra', root: 'bundles/extra' },
            },
        },
    ];
    assert.equal(
        layout.sourceNamespace(join(directory, 'bundles/default/dynamic/Popup.prefab'), modules),
        'shared/default',
    );
    assert.equal(layout.sourceNamespace(join(directory, 'bundles/extra/static/Part.prefab'), modules), 'shared/extra');
    for (const suffix of [
        'bundles/default-old/Part.prefab',
        'localization/default/zh-CN/Part.prefab',
        'code/Part.prefab',
    ])
        assert.equal(layout.sourceNamespace(join(directory, suffix), modules), '');
});
async function fixture(t, rows) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-i18n-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = 'config-source/shop/languages.xlsx';
    await createLocalizationWorkbook(
        root,
        source,
        ['zh-CN', 'en'],
        rows ?? {
            texts: [
                ['hello', '', '  你好 {name}\n世界  ', 'Hello {name}'],
                ['empty', '', '默认', '#EMPTY'],
                ['fallback', '', '默认内容', null],
            ],
        },
    );
    const module = {
        id: 'shop',
        layoutVersion: 2,
        directory: join(root, 'assets/game/modules/shop'),
        bundles: {
            default: {
                id: 'shop',
                root: 'bundles/default',
                localization: { source, locales: { 'zh-CN': {}, en: { id: 'shop-en' } } },
            },
        },
    };
    const registry = new Map([
        ['shop/default-zh-cn/sprite/logo', { uuid: 'uuid-zh', type: 'SpriteFrame' }],
        ['shop/default-en/sprite/logo', { uuid: 'uuid-en', type: 'SpriteFrame' }],
        ['shop/default-zh-cn/font/default', { uuid: 'font-zh', type: 'Font' }],
        ['shop/default-en/font/default', { uuid: 'font-en', type: 'Font' }],
    ]);
    const metadata = new Map([
        ['uuid-zh', { source: join(module.directory, 'localization/default/zh-CN/dynamic/images/logo.png') }],
        ['uuid-en', { source: join(module.directory, 'localization/default/en/dynamic/images/logo.jpg') }],
        ['font-zh', { source: join(module.directory, 'localization/default/zh-CN/dynamic/fonts/default.ttf') }],
        ['font-en', { source: join(module.directory, 'localization/default/en/dynamic/fonts/default.ttf') }],
    ]);
    const compile = async () =>
        compileLocalization(root, [module], settings, await workbookSources(root), registry, metadata);
    return { root, source, module, registry, metadata, compile };
}
test('独立工作簿统一派生语言包路由和类型合同；完整保留原文', async (t) => {
    const f = await fixture(t),
        sources = await workbookSources(f.root);
    assert.equal(sources.tables.length, 0);
    assert.equal(sources.workbooks.length, 0);
    assert.equal(sources.localizationWorkbooks.length, 1);
    const result = await f.compile(),
        definition = result.release.bundles.shop;
    assert.equal(definition.catalogs.en.bundle, 'shop-en');
    const zh = JSON.parse(result.output['assets/game/modules/shop/localization/default/zh-CN/yz-locale.json']);
    const en = JSON.parse(result.output['assets/game/modules/shop/localization/default/en/yz-locale.json']);
    assert.equal(zh.texts.hello, '  你好 {name}\n世界  ');
    assert.equal(en.texts.empty, '');
    assert.ok(!('fallback' in en.texts));
    assert.equal(en.font.id, 'shop/default-en/font/default');
    assert.equal(en.assets['images/logo'].id, 'shop/default-en/sprite/logo');
    assert.match(
        result.output['assets/game/modules/shop/contracts/generated/localization-default.ts'],
        /"images\/logo":/,
    );
    assert.match(
        result.output['assets/game/modules/shop/contracts/generated/localization-default.ts'],
        /TextKey<"name">/,
    );
    assert.equal(result.reports.find((item) => item.locale === 'en').translated, 2);
    const baseline = definition.contract;
    f.registry.delete('shop/default-en/sprite/logo');
    f.registry.set('shop/default-en/sprite/renamed', { uuid: 'uuid-en', type: 'SpriteFrame' });
    const renamed = await f.compile();
    assert.equal(renamed.release.bundles.shop.contract, baseline);
    assert.notEqual(renamed.release.bundles.shop.catalogs.en.revision, definition.catalogs.en.revision);
});
test('缺少默认文案、占位符错配、数字/公式和生成名冲突均阻止生成', async (t) => {
    for (const rows of [
        [['hello', '', null, 'hello']],
        [['hello', '', '你好 {name}', 'Hi {other}']],
        [['hello', '', 42, 'hello']],
        [['hello', '', { formula: '1+1' }, 'hello']],
        [
            ['hello.key', '', '一', 'one'],
            ['hello-key', '', '二', 'two'],
        ],
    ]) {
        await assert.rejects(async () => {
            const f = await fixture(t, { texts: rows, assets: [] });
            await f.compile();
        }, /默认语言缺少|参数不一致|必须为纯文本|生成标识冲突/);
    }
});

test('XLSX 读回后拒绝稀疏、空白或非法语言表头，允许正文缺译', async (t) => {
    for (const [sheetName, column] of [['texts', 4]]) {
        for (const value of [null, undefined, '', '   ', ' en ', 42]) {
            const f = await fixture(t),
                book = new ExcelJS.Workbook();
            await book.xlsx.readFile(join(f.root, f.source));
            const sheet = book.getWorksheet(sheetName);
            sheet.getCell(1, column).value = value;
            sheet.getCell(1, column + 1).value = 'en';
            await book.xlsx.writeFile(join(f.root, f.source));
            const address = sheet.getCell(1, column).address;
            await assert.rejects(readWorkbook(f.root, f.source), (error) => {
                assert.ok(error.message.includes(`${sheetName}!${address}`));
                assert.match(error.message, /语言表头为空或无效/);
                return true;
            });
        }
    }
    const f = await fixture(t),
        result = await f.compile();
    const en = JSON.parse(result.output['assets/game/modules/shop/localization/default/en/yz-locale.json']);
    assert.ok(!Object.hasOwn(en.texts, 'fallback'));
    assert.equal(en.texts.empty, '');
});
test('资源按实际目录配对，类型和语言分组必须吻合', async (t) => {
    const f = await fixture(t);
    f.registry.get('shop/default-en/sprite/logo').type = 'Font';
    await assert.rejects(f.compile(), /资源类型不一致/);
    f.registry.get('shop/default-en/sprite/logo').type = 'SpriteFrame';
    f.module.bundles.default.localization.locales.en.group = 'default-zh-cn';
    assert.throws(() => localizationDeclarations([f.module], settings), /分组.*冲突/);
});
test('安全追加语言列保留旧翻译与无关 ZIP 内容，过期预览不能覆盖文件', async (t) => {
    const f = await fixture(t),
        before = await readWorkbook(f.root, f.source),
        oldBytes = await readFile(join(f.root, f.source));
    const result = await writeLocalizationWorkbook(f.root, f.source, { locales: ['ja'] }, before.hash);
    const after = await readWorkbook(f.root, f.source);
    assert.deepEqual(after.localization.locales, ['zh-CN', 'en', 'ja']);
    assert.equal(after.localization.texts[0].values['zh-CN'], '  你好 {name}\n世界  ');
    assert.ok(!Object.hasOwn(after.localization.texts[0].values, 'ja'));
    const oldZip = await JSZip.loadAsync(oldBytes),
        newZip = await JSZip.loadAsync(await readFile(join(f.root, f.source)));
    for (const file of Object.keys(oldZip.files).filter(
        (file) => !oldZip.files[file].dir && !['xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml'].includes(file),
    ))
        assert.deepEqual(
            await oldZip.file(file).async('nodebuffer'),
            await newZip.file(file).async('nodebuffer'),
            file,
        );
    await assert.rejects(writeLocalizationWorkbook(f.root, f.source, { locales: ['fr'] }, before.hash), /已变化/);
    assert.ok(result.backup.startsWith('.yzforge/workbook-history/'));
});
test('删除模块可以安全停用并恢复工作簿，不留下孤立的导出声明', async (t) => {
    const f = await fixture(t),
        before = await readWorkbook(f.root, f.source);
    const disabled = await writeWorkbookConfig(f.root, f.source, { kind: 'localization', enabled: false }, before.hash);
    const sources = await workbookSources(f.root);
    assert.equal(compileLocalization(f.root, [], settings, sources, f.registry).reports.length, 0);
    await assert.rejects(f.compile(), /未找到有效多语言/);
    await writeWorkbookConfig(f.root, f.source, { kind: 'localization', enabled: true }, disabled.hash);
    assert.equal((await f.compile()).reports.length, 2);
});
test('语言工作簿不能同时伪装成普通配置表或被两个资源包占有', async (t) => {
    const f = await fixture(t);
    const copy = {
        ...f.module,
        id: 'other',
        bundles: {
            default: { id: 'other', root: 'bundles/default', localization: f.module.bundles.default.localization },
        },
    };
    assert.throws(() => localizationDeclarations([f.module, copy], settings), /工作簿归属/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(join(f.root, f.source));
    book.addWorksheet('__config');
    await writeFile(join(f.root, f.source), Buffer.from(await book.xlsx.writeBuffer()));
    await assert.rejects(readWorkbook(f.root, f.source), /混用/);
});

test('调整语言包位置后，待归档的旧目录不会被重新编目为普通动态资源', async (t) => {
    const f = await fixture(t);
    const oldCatalog = 'assets/game/modules/shop/bundles/default/dynamic/i18n/default/en.json';
    await mkdir(join(f.root, 'project-settings/generated'), { recursive: true });
    await writeFile(
        join(f.root, 'project-settings/generated/generated-files.json'),
        JSON.stringify({ [oldCatalog]: 'old-output-digest' }),
    );
    const metadata = new Map([
        ['old-catalog', { source: join(f.root, oldCatalog), importer: 'json' }],
        [
            'current-catalog',
            { source: join(f.module.directory, 'localization/default/en/yz-locale.json'), importer: 'json' },
        ],
        [
            'business-json',
            { source: join(f.module.directory, 'bundles/default/dynamic/i18n/rules.json'), importer: 'json' },
        ],
    ]);
    const identities = await scanCatalog(f.root, [f.module], metadata, await workbookSources(f.root));
    assert.deepEqual(Object.keys(identities.entries), ['business-json']);
    assert.deepEqual(Object.keys(f.module.assets), ['shop/default/json/i18n/rules']);
});

test('纯资源包不需要工作簿，已声明但丢失的工作簿仍报错', async (t) => {
    const f = await fixture(t);
    const empty = { tables: [], localizationWorkbooks: [] };
    assert.throws(() => compileLocalization(f.root, [f.module], settings, empty, f.registry, f.metadata), /未找到有效/);
    delete f.module.bundles.default.localization.source;
    const result = compileLocalization(f.root, [f.module], settings, empty, f.registry, f.metadata);
    const zh = JSON.parse(result.output['assets/game/modules/shop/localization/default/zh-CN/yz-locale.json']);
    assert.deepEqual(zh.texts, {});
    assert.deepEqual(Object.keys(zh.assets), ['images/logo']);
    delete f.module.bundles.default.localization.locales.en;
    assert.ok(!Object.values(layout.physicalBundles(f.module)).some((bundle) => bundle.language?.locale === 'en'));
    assert.ok(
        !compileLocalization(f.root, [f.module], settings, empty, f.registry, f.metadata).release.bundles.shop.catalogs
            .en,
    );
});

test('新工作簿只含文案，旧资源表不会被静默忽略', async (t) => {
    const f = await fixture(t),
        current = await readWorkbook(f.root, f.source);
    assert.equal(current.book.getWorksheet('assets'), undefined);
    assert.equal(current.book.getWorksheet('__localization').getCell('B1').value, 2);
    await writeLocalizationWorkbook(f.root, f.source, { enabled: false }, current.hash);
    assert.equal((await readWorkbook(f.root, f.source)).book.getWorksheet('__localization').getCell('B1').value, 2);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(join(f.root, f.source));
    book.addWorksheet('assets').addRows([
        ['key', 'type', 'comment', 'zh-CN', 'en'],
        ['logo', 'SpriteFrame', '', 'old-uuid'],
    ]);
    await writeFile(join(f.root, f.source), Buffer.from(await book.xlsx.writeBuffer()));
    await assert.rejects(readWorkbook(f.root, f.source), /旧资源映射/);
});

test('相对路径 key 跟随实际改名，缺少版本列入回退清单，默认版本必须完整', async (t) => {
    const f = await fixture(t),
        initial = await f.compile();
    const english = f.registry.get('shop/default-en/sprite/logo');
    f.registry.delete('shop/default-en/sprite/logo');
    const missing = await f.compile();
    assert.deepEqual(missing.reports.find((r) => r.locale === 'en').missingAssets, ['images/logo']);
    f.registry.set('shop/default-en/sprite/logo', english);
    f.metadata.get('uuid-en').source = join(f.module.directory, 'localization/default/en/dynamic/images/renamed.png');
    await assert.rejects(f.compile(), /默认语言缺少资源路径 images\/renamed/);
    f.metadata.get('uuid-zh').source = join(
        f.module.directory,
        'localization/default/zh-CN/dynamic/images/renamed.png',
    );
    const renamed = await f.compile();
    const zh = JSON.parse(renamed.output['assets/game/modules/shop/localization/default/zh-CN/yz-locale.json']);
    assert.deepEqual(Object.keys(zh.assets), ['images/renamed']);
    assert.notEqual(renamed.release.bundles.shop.contract, initial.release.bundles.shop.contract);
});

test('图片自动选择 SpriteFrame，拒绝同 key 的扩展名与大小写冲突', async (t) => {
    const f = await fixture(t);
    for (const [uuid, type] of [
        ['image', 'ImageAsset'],
        ['texture', 'Texture2D'],
    ]) {
        f.registry.set('shop/default-en/' + uuid, { uuid, type });
        f.metadata.set(uuid, { ...f.metadata.get('uuid-en') });
    }
    assert.deepEqual((await f.compile()).reports.find((r) => r.locale === 'en').assetKeys, ['images/logo']);
    f.registry.set('shop/default-en/duplicate', { uuid: 'dup', type: 'SpriteFrame' });
    for (const filename of ['logo.png', 'Logo.jpg']) {
        f.metadata.set('dup', { source: join(f.module.directory, 'localization/default/en/dynamic/images', filename) });
        await assert.rejects(f.compile(), /key 冲突/);
    }
});

test('图集按子图片路径生成 key，默认字体可独立缺省', async (t) => {
    const f = await fixture(t),
        module = layout.expandModule(f.module);
    const source = join(f.module.directory, 'localization/default/en/dynamic/images/icons.plist');
    f.metadata.set('atlas', { source, importer: 'sprite-atlas' });
    for (const name of ['coin', 'gem']) {
        f.registry.set('shop/default-en/sprite/' + name, { uuid: 'atlas@' + name, type: 'SpriteFrame' });
        f.metadata.set('atlas@' + name, { source, importer: 'sprite-frame', suffix: '/' + name + '.png' });
    }
    const resources = languageResources(module, 'default-en', f.registry, f.metadata);
    assert.deepEqual(Object.keys(resources.assets), ['images/icons/coin', 'images/icons/gem', 'images/logo']);
    assert.ok(resources.font);
    assert.ok(!resources.assets['fonts/default']);
    f.registry.delete('shop/default-zh-cn/font/default');
    f.registry.delete('shop/default-en/sprite/coin');
    f.registry.delete('shop/default-en/sprite/gem');
    const compiled = await f.compile();
    assert.equal(
        JSON.parse(compiled.output['assets/game/modules/shop/localization/default/zh-CN/yz-locale.json']).font,
        null,
    );
});

test('语言资源物理索引允许路径改名和同路径替换，不改变普通资源规则', async (t) => {
    const f = await fixture(t),
        module = layout.expandModule(f.module);
    const source = join(f.module.directory, 'localization/default/en/dynamic/images/logo.png');
    const metadata = new Map([['old-uuid', { source, importer: 'sprite-frame', suffix: '/spriteFrame' }]]);
    const first = await scanCatalog(f.root, [module], metadata, { tables: [] });
    await mkdir(join(f.root, 'project-settings/generated'), { recursive: true });
    await writeFile(join(f.root, 'project-settings/generated/resource-identities.json'), JSON.stringify(first));
    metadata.get('old-uuid').source = source.replace('logo.png', 'renamed.png');
    const moved = await scanCatalog(f.root, [module], metadata, { tables: [] });
    assert.equal(moved.entries['old-uuid'].id, 'shop/default-en/sprite/images/renamed');
    module.assets = {};
    metadata.delete('old-uuid');
    metadata.set('new-uuid', { source, importer: 'sprite-frame', suffix: '/spriteFrame' });
    const replaced = await scanCatalog(f.root, [module], metadata, { tables: [] });
    assert.equal(replaced.entries['new-uuid'].id, first.entries['old-uuid'].id);
});
