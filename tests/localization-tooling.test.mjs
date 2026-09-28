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
} from '../tools/yzforge/localization.mjs';
import {
    readWorkbook,
    workbookSources,
    writeLocalizationWorkbook,
    writeWorkbookConfig,
} from '../tools/yzforge/workbooks.mjs';
const settings = { localization: { defaultLocale: 'zh-CN', locales: ['zh-CN', 'en', 'ja'] } };
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
            assets: [
                ['logo', 'SpriteFrame', '', 'uuid-zh', 'uuid-en'],
                ['$font', 'Font', '', '@common/default/font/chinese', '@common/default/font/latin'],
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
        ['shop/default/sprite/logo', { uuid: 'uuid-zh', type: 'SpriteFrame' }],
        ['shop/default-en/sprite/logo', { uuid: 'uuid-en', type: 'SpriteFrame' }],
        ['common/default/font/chinese', { uuid: 'font-zh', type: 'Font' }],
        ['common/default/font/latin', { uuid: 'font-en', type: 'Font' }],
    ]);
    const compile = async () => compileLocalization(root, [module], settings, await workbookSources(root), registry);
    return { root, source, module, registry, compile };
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
    assert.equal(en.font.id, 'common/default/font/latin');
    assert.equal(en.assets.logo.id, 'shop/default-en/sprite/logo');
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
    for (const [sheetName, column] of [
        ['texts', 4],
        ['assets', 5],
    ]) {
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
test('资源必须存在且类型吻合；不同语言专用包不能互相引用', async (t) => {
    const f = await fixture(t);
    f.registry.get('shop/default-en/sprite/logo').type = 'Font';
    await assert.rejects(f.compile(), /不存在或类型不符/);
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

test('同语言公共资源可跨业务包复用，其他语言资源必须显式回退', async (t) => {
    const f = await fixture(t);
    const declaration = f.module.bundles.default.localization;
    const common = {
        id: 'common',
        bundles: {
            default: {
                id: 'common',
                root: 'bundles/default',
                localization: {
                    source: 'config-source/common/localization-default.xlsx',
                    locales: { 'zh-CN': {}, en: {} },
                },
            },
        },
        directory: join(f.root, 'assets/game/modules/common'),
    };
    await createLocalizationWorkbook(f.root, common.bundles.default.localization.source, ['zh-CN', 'en'], {
        texts: [['hello', '', '你好', 'Hello']],
        assets: [],
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(join(f.root, f.source));
    book.getWorksheet('assets').getCell('E3').value = '@common/default-en/font/shared';
    await writeFile(join(f.root, f.source), Buffer.from(await book.xlsx.writeBuffer()));
    f.registry.set('common/default-en/font/shared', { uuid: 'shared', type: 'Font' });
    let sources = await workbookSources(f.root);
    const good = compileLocalization(f.root, [f.module, common], settings, sources, f.registry);
    assert.equal(
        JSON.parse(good.output['assets/game/modules/shop/localization/default/en/yz-locale.json']).font.id,
        'common/default-en/font/shared',
    );
    book.getWorksheet('assets').getCell('D3').value = '@common/default-en/font/shared';
    await writeFile(join(f.root, f.source), Buffer.from(await book.xlsx.writeBuffer()));
    sources = await workbookSources(f.root);
    assert.throws(() => compileLocalization(f.root, [f.module, common], settings, sources, f.registry), /其他语言/);
    delete declaration.locales.en;
    assert.ok(!Object.values(layout.physicalBundles(f.module)).some((bundle) => bundle.language?.locale === 'en'));
});
