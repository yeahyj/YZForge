import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import JSZip from 'jszip';
import {
    createWorkbook,
    readWorkbook,
    workbookSources,
    writeWorkbookConfig,
    formulaFingerprint,
} from '../tools/yzforge/workbooks.mjs';
import { scanCatalog, identityFile, scriptDependencies } from '../tools/yzforge/catalog.mjs';
import { compileTables } from '../tools/yzforge/config.mjs';
import { codeBoundaryCheck } from '../tools/yzforge/checks.mjs';
import naming from '../tools/yzforge/naming.cjs';
import { logicalKey, validateIndex, resolveIndex } from '../assets/framework/assets/catalog.ts';
import { validateValue } from '../assets/framework/config/schema.ts';
import { parseTable } from '../assets/framework/config/config-table.ts';
const runtime = { logicalKey, validateValue, parseTable };
async function fixture(fn) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-workbench-'));
    assert.ok(root.startsWith(resolve(tmpdir()) + sep));
    const module = {
        id: 'inventory',
        layoutVersion: 2,
        dependencies: [],
        directory: resolve(root, 'assets/game/modules/inventory'),
        bundles: { default: { id: 'm-inventory', root: 'bundles/default' } },
        views: {},
    };
    try {
        await fn(root, module);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
const source = 'config-source/inventory/items.xlsx';
const config = {
    module: 'inventory',
    bundle: 'default',
    enabled: true,
    tables: [{ id: 'items', sheet: 'Items', primaryKey: 'id', enabled: true }],
};
test('role suffixes are idempotent and missing or cyclic dependencies fail before creation', () => {
    assert.equal(naming.named('Reward', 'popup').className, 'RewardPopup');
    assert.equal(naming.named('RewardPopup', 'popup').id, 'reward-popup');
    assert.equal(naming.named('inventory', 'service').className, 'InventoryService');
    assert.equal(naming.named('Item', 'part').className, 'ItemPart');
    assert.equal(naming.named('ItemPart', 'part').className, 'ItemPart');
    assert.throws(() => naming.slug('../escape'));
    assert.throws(() =>
        naming.dependencies(
            [
                { id: 'a', dependencies: ['b'] },
                { id: 'b', dependencies: [] },
            ],
            'b',
            ['a'],
        ),
    );
    assert.throws(() => naming.dependencies([{ id: 'a', dependencies: [] }], 'a', ['missing']));
});
test('v2 paths disambiguate basenames and v1 cannot accept hierarchical IDs', () => {
    const address = { type: 'SpriteFrame', bundle: 'm-inventory', path: 'dynamic/a/icon/spriteFrame' };
    const index = validateIndex(
        {
            formatVersion: 2,
            namespace: 'inventory/default',
            assets: {
                'inventory/default/sprite/a/icon': address,
                'inventory/default/sprite/b/icon': { ...address, path: 'dynamic/b/icon/spriteFrame' },
            },
        },
        'inventory/default',
    );
    assert.throws(() => resolveIndex(index, logicalKey('icon', 'SpriteFrame', index.namespace), true), {
        code: 'ASSET_NAME_AMBIGUOUS',
    });
    assert.equal(resolveIndex(index, logicalKey('a/icon', 'SpriteFrame', index.namespace), true), address);
    assert.throws(() => validateIndex({ ...index, formatVersion: 1 }, index.namespace));
    assert.throws(() =>
        validateIndex(
            { ...index, aliases: { 'inventory/default/sprite/a': 'inventory/default/sprite/missing' } },
            index.namespace,
        ),
    );
    assert.equal(
        resolveIndex(
            validateIndex(
                { ...index, aliases: { 'inventory/default/sprite/legacy': 'inventory/default/sprite/a/icon' } },
                index.namespace,
            ),
            logicalKey('legacy', 'SpriteFrame', index.namespace),
        ),
        address,
    );
});
test('config writeback preserves unrelated ZIP payloads, formula text and styles and rejects stale versions', () =>
    fixture(async (root) => {
        const created = await createWorkbook(root, source, config);
        created.book.getWorksheet('Items').getCell('B5').value = { formula: '"Item"&A5', result: 'Item1' };
        created.book.getWorksheet('Items').getCell('B5').font = { bold: true, color: { argb: 'FFFF0000' } };
        await writeFile(resolve(root, source), Buffer.from(await created.book.xlsx.writeBuffer()));
        const current = await readWorkbook(root, source),
            before = await JSZip.loadAsync(await readFile(resolve(root, source)));
        const next = await writeWorkbookConfig(root, source, { ...current.config, bundle: 'extra' }, current.hash);
        const after = await JSZip.loadAsync(await readFile(resolve(root, source)));
        for (const name of Object.keys(before.files))
            if (!before.files[name].dir && name !== 'xl/worksheets/sheet1.xml')
                assert.deepEqual(
                    await after.file(name).async('nodebuffer'),
                    await before.file(name).async('nodebuffer'),
                    name,
                );
        assert.equal(next.config.bundle, 'extra');
        assert.equal((await readWorkbook(root, source)).book.getWorksheet('Items').getCell('B5').formula, '"Item"&A5');
        await assert.rejects(writeWorkbookConfig(root, source, config, current.hash), /文件已变化/);
    }));
test('named numeric enums export TS and JSON and disabling the workbook removes its routes', () =>
    fixture(async (root, module) => {
        await createWorkbook(
            root,
            source,
            config,
            [
                ['id', 'quality'],
                ['int', 'enum<Quality>'],
                [null, null],
                ['编号', '品质'],
                [1, 20],
            ],
            [
                ['Quality', 'Normal', 10, '', true],
                ['Quality', 'Rare', 20, '', true],
            ],
        );
        const compiled = await compileTables(root, [module], runtime, new Map());
        assert.equal(
            JSON.parse(compiled.output['assets/game/modules/inventory/bundles/default/dynamic/config/items.json'])
                .rows[0].quality,
            20,
        );
        assert.match(
            compiled.output['assets/game/modules/inventory/contracts/generated/enums/Quality.ts'],
            /"Rare": 20/,
        );
        assert.match(
            compiled.output['assets/game/modules/inventory/code/generated/config/Items.types.ts'],
            /inventory_Quality/,
        );
        const current = await readWorkbook(root, source);
        await writeWorkbookConfig(root, source, { ...current.config, enabled: false }, current.hash);
        assert.equal((await workbookSources(root)).tables.length, 0);
    }));
test('cached formulas can preview but cannot silently become verified export data', () =>
    fixture(async (root, module) => {
        await createWorkbook(root, source, config, [
            ['id', 'value'],
            ['int', 'int'],
            [null, null],
            ['编号', '值'],
            [1, { formula: 'A5*2', result: 2 }],
        ]);
        const fingerprint = await formulaFingerprint(root, source);
        await assert.rejects(compileTables(root, [module], runtime, new Map()), /未验证|陈旧/);
        const preview = await compileTables(root, [module], runtime, new Map(), { preview: true });
        assert.equal(preview.previewOnly, true);
        assert.equal(
            JSON.parse(preview.output['assets/game/modules/inventory/bundles/default/dynamic/config/items.json'])
                .rows[0].value,
            2,
        );
        const current = await readWorkbook(root, source);
        await writeWorkbookConfig(root, source, { ...current.config, enabled: false }, current.hash);
        assert.notEqual(await formulaFingerprint(root, source), fingerprint);
    }));
test('catalog excludes static resources, preserves UUID identity after moves, and refuses tombstone reuse', () =>
    fixture(async (root, module) => {
        const metadata = new Map([
            [
                'sprite-a',
                {
                    source: resolve(module.directory, 'bundles/default/dynamic/icons/Coin.png'),
                    importer: 'sprite-frame',
                    suffix: '/spriteFrame',
                },
            ],
            [
                'static-b',
                {
                    source: resolve(module.directory, 'bundles/default/static/Backdrop.png'),
                    importer: 'sprite-frame',
                    suffix: '/spriteFrame',
                },
            ],
        ]);
        const one = await scanCatalog(root, [module], metadata, { tables: [] });
        assert.equal(Object.keys(module.assets).length, 1);
        assert.equal(one.entries['sprite-a'].id, 'inventory/default/sprite/icons/coin');
        await mkdir(resolve(root, 'project-settings/generated'), { recursive: true });
        await writeFile(resolve(root, identityFile), JSON.stringify(one));
        metadata.get('sprite-a').source = resolve(module.directory, 'bundles/default/dynamic/currency/Gold.png');
        const two = await scanCatalog(root, [module], metadata, { tables: [] });
        assert.equal(two.entries['sprite-a'].id, one.entries['sprite-a'].id);
        metadata.delete('sprite-a');
        metadata.set('sprite-new', {
            source: resolve(module.directory, 'bundles/default/dynamic/icons/Coin.png'),
            importer: 'sprite-frame',
        });
        await assert.rejects(scanCatalog(root, [module], metadata, { tables: [] }), /旧资源 UUID/);
    }));
test('value imports cannot pull private code into the main program; type-only imports are erased', () =>
    fixture(async (root, module) => {
        module.code = { mode: 'bundled', root: 'code', bundle: 'code-inventory', entryPath: 'entry' };
        await mkdir(resolve(module.directory, 'code'), { recursive: true });
        await mkdir(resolve(root, 'assets/game/boot'), { recursive: true });
        await writeFile(
            resolve(root, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { moduleResolution: 'node' } }),
        );
        await writeFile(resolve(module.directory, 'code/Service.ts'), 'export class Service {}');
        const boot = resolve(root, 'assets/game/boot/Test.ts');
        await writeFile(
            boot,
            "import { Service } from '../modules/inventory/code/Service'; export const value = Service;",
        );
        await assert.rejects(codeBoundaryCheck(root, [module]), /私有模块实现/);
        await writeFile(
            boot,
            "import type { Service } from '../modules/inventory/code/Service'; export type Value = Service;",
        );
        await codeBoundaryCheck(root, [module]);
    }));

test('cyclic nested prefab references retain every required code module regardless of scan order', () =>
    fixture(async (root, module) => {
        const other = { ...module, id: 'shared', directory: resolve(root, 'assets/game/modules/shared') };
        for (const item of [module, other]) {
            await mkdir(resolve(item.directory, 'code'), { recursive: true });
            await writeFile(
                resolve(item.directory, 'code/Part.ts'),
                "@ccclass('" + item.id + ".Part') export class Part {}",
            );
        }
        const a = resolve(root, 'a.prefab'),
            b = resolve(root, 'b.prefab');
        // Synthetic serialization is a disposable unit fixture, never an editor asset.
        await writeFile(a, JSON.stringify([{ __type__: 'inventory.Part' }, { __uuid__: 'b' }]));
        await writeFile(b, JSON.stringify([{ __type__: 'shared.Part' }, { __uuid__: 'a' }]));
        const inspect = await scriptDependencies(
            [module, other],
            new Map([
                ['a', { source: a }],
                ['b', { source: b }],
            ]),
        );
        assert.deepEqual(await inspect('a'), ['inventory', 'shared']);
        assert.deepEqual(await inspect('b'), ['inventory', 'shared']);
    }));

test('separate frames inside one atlas receive distinct automatic logical names', () =>
    fixture(async (root, module) => {
        const source = resolve(module.directory, 'bundles/default/dynamic/icons/items.plist');
        const metadata = new Map([
            ['atlas', { source, importer: 'sprite-atlas' }],
            ['atlas@one', { source, importer: 'sprite-frame', suffix: '/Coin' }],
            ['atlas@two', { source, importer: 'sprite-frame', suffix: '/Gem' }],
        ]);
        const ledger = await scanCatalog(root, [module], metadata, { tables: [] });
        assert.equal(ledger.entries['atlas@one'].id, 'inventory/default/sprite/icons/items/coin');
        assert.equal(ledger.entries['atlas@two'].id, 'inventory/default/sprite/icons/items/gem');
    }));

test('malformed XLSX is visible to the panel while formal generation remains strict', () =>
    fixture(async (root) => {
        await createWorkbook(root, source, config);
        await writeFile(resolve(root, 'config-source/broken.xlsx'), 'broken zip');
        const state = await workbookSources(root, { tolerant: true });
        assert.equal(state.workbooks.length, 1);
        assert.equal(state.diagnostics.length, 1);
        await assert.rejects(workbookSources(root));
    }));

test('concurrent workbook settings writes cannot silently replace one another', () =>
    fixture(async (root) => {
        await createWorkbook(root, source, config);
        const current = await readWorkbook(root, source);
        const results = await Promise.allSettled(
            ['one', 'two'].map((bundle) =>
                writeWorkbookConfig(root, source, { ...current.config, bundle }, current.hash),
            ),
        );
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
        assert.ok(['one', 'two'].includes((await readWorkbook(root, source)).config.bundle));
    }));
