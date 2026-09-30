import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { fieldType, convert, compileTables } from '../tools/yzforge/generators/config.mjs';
import { configRows } from '../tools/yzforge/project/workbooks.mjs';
import { validateModules, lifecycleCheck } from '../tools/yzforge/validation/checks.mjs';
import { within, writeBatch } from '../tools/yzforge/project/project.mjs';
import settingsTools from '../tools/yzforge/project/settings.cjs';
import { logicalKey } from '../assets/framework/assets/catalog.ts';
import { validateValue } from '../assets/framework/config/schema.ts';
import { parseTable } from '../assets/framework/config/config-table.ts';
const runtime = { logicalKey, validateValue, parseTable };
async function fixture(callback) {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-config-'));
    // Verify the absolute test-only path before registering recursive cleanup.
    if (!resolve(root).startsWith(resolve(tmpdir()) + '\\') && !resolve(root).startsWith(resolve(tmpdir()) + '/'))
        throw Error('Unsafe temporary test cleanup path');
    try {
        await mkdir(join(root, 'config-source/lobby'), { recursive: true });
        const module = {
            id: 'lobby',
            layoutVersion: 3,
            directory: join(root, 'assets/game/modules/lobby'),
            dependencies: {},
            bundles: {
                default: { id: 'm-lobby', root: 'bundles/default' },
                forest: { id: 'lobby-forest', root: 'bundles/forest' },
                desert: { id: 'lobby-desert', root: 'bundles/desert' },
            },
            assets: {},
            views: {},
        };
        await callback(root, module);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
async function workbook(root, name, rows, options = {}) {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('__config').addRows(
        configRows({ module: 'lobby', tables: [{ id: name, sheet: 'Data', ...options }] }),
    );
    book.addWorksheet('Data').addRows(rows);
    await book.xlsx.writeFile(join(root, `config-source/lobby/${name}.xlsx`));
    return book;
}
test('table type grammar and conversion preserve false/zero/text IDs and reject implicit coercion', () => {
    assert.deepEqual(fieldType('asset<SpriteFrame>[]?'), {
        kind: 'array',
        element: { kind: 'asset', assetType: 'SpriteFrame' },
        nullable: true,
    });
    assert.throws(() => fieldType('int[][]'));
    assert.throws(() => fieldType('any'));
    assert.throws(() => fieldType('enum<Missing>', { module: 'lobby', enums: new Map() }), /Unknown.*enum/);
    assert.equal(convert('001', { kind: 'string' }, {}), '001');
    assert.equal(convert('false', { kind: 'bool' }, {}), false);
    assert.equal(convert('0', { kind: 'int' }, {}), 0);
    assert.throws(() => convert('yes', { kind: 'bool' }, {}));
    assert.throws(() => convert('0x10', { kind: 'int' }, {}));
});
test('configuration generation shards rows and emits type contracts without embedding data', async () =>
    fixture(async (root, module) => {
        await workbook(
            root,
            'levels',
            [
                ['id', 'chapter', 'name', 'enabled'],
                ['int', 'string', 'string', 'bool'],
                [null, null, null, true],
                ['编号', '章节', '名称', '启用'],
                [1, 'forest', '森林', false],
                [2, 'desert', '沙漠', true],
            ],
            { shards: { field: 'chapter', targets: { forest: 'forest', desert: 'desert' } } },
        );
        const compiled = await compileTables(root, [module], runtime, new Map());
        const forest = JSON.parse(
            compiled.output['assets/game/modules/lobby/bundles/forest/dynamic/config/levels.json'],
        );
        const desert = JSON.parse(
            compiled.output['assets/game/modules/lobby/bundles/desert/dynamic/config/levels.json'],
        );
        assert.deepEqual(forest.rows, [{ id: 1, chapter: 'forest', name: '森林', enabled: false }]);
        assert.deepEqual(desert.rows, [{ id: 2, chapter: 'desert', name: '沙漠', enabled: true }]);
        assert.ok(!compiled.output['assets/game/modules/lobby/code/generated/config/Levels.table.ts'].includes('森林'));
    }));
test('blank values use defaults then nullable, without treating false and zero as empty', async () =>
    fixture(async (root, module) => {
        await workbook(root, 'items', [
            ['id', 'value', 'enabled', 'note'],
            ['int', 'int', 'bool', 'string?'],
            [null, 9, true, null],
            ['编号', '数量', '启用', '备注'],
            [1, 0, false, null],
            [2, null, null, null],
        ]);
        const compiled = await compileTables(root, [module], runtime, new Map()),
            data = JSON.parse(compiled.output['assets/game/modules/lobby/bundles/default/dynamic/config/items.json']);
        assert.deepEqual(data.rows, [
            { id: 1, value: 0, enabled: false, note: null },
            { id: 2, value: 9, enabled: true, note: null },
        ]);
    }));
test('misspelled and incompatible configuration constraints cannot silently pass', async () =>
    fixture(async (root, module) => {
        const rows = [['id', 'name'], ['int', 'string'], [], ['编号', '名称'], [1, 'Example']];
        await workbook(root, 'entries', rows, { constraints: { missing: { min: 0 } } });
        await assert.rejects(compileTables(root, [module], runtime, new Map()), /undeclared field/);
        await workbook(root, 'entries', rows, { constraints: { name: { min: 0 } } });
        await assert.rejects(compileTables(root, [module], runtime, new Map()), /not supported for string/);
    }));
test('duplicate primary keys are rejected across shards before writing output', async () =>
    fixture(async (root, module) => {
        await workbook(
            root,
            'levels',
            [['id', 'chapter'], ['int', 'string'], [], ['编号', '章节'], [1, 'forest'], [1, 'desert']],
            { shards: { field: 'chapter', targets: { forest: 'forest', desert: 'desert' } } },
        );
        await assert.rejects(compileTables(root, [module], runtime, new Map()), /duplicate primary key across shards/);
    }));
test('foreign keys validate declared references rather than guessing from field names', async () =>
    fixture(async (root, module) => {
        await workbook(root, 'items', [['id', 'name'], ['int', 'string'], [], ['编号', '名称'], [1, 'Coin']]);
        const rows = [
            ['id', 'itemId', 'skillIds'],
            ['int', 'ref<items>', 'int[]'],
            [null, null, '[]'],
            ['编号', '道具', '技能'],
            [1, 2, '[999]'],
        ];
        await workbook(root, 'levels', rows);
        await assert.rejects(compileTables(root, [module], runtime, new Map()), /missing foreign key/);
        rows[4][1] = 1;
        await workbook(root, 'levels', rows);
        const compiled = await compileTables(root, [module], runtime, new Map());
        assert.equal(compiled.reports.length, 2);
    }));
test('XLSX import preserves typed cells and rejects formulas in declaration rows with cell positions', async () =>
    fixture(async (root, module) => {
        const book = await workbook(root, 'items', [
            ['id', 'name', 'enabled'],
            ['int', 'string', 'bool'],
            [null, null, true],
            ['编号', '名称', '启用'],
            [1, '001', false],
        ]);
        const compiled = await compileTables(root, [module], runtime, new Map());
        assert.equal(
            JSON.parse(compiled.output['assets/game/modules/lobby/bundles/default/dynamic/config/items.json']).rows[0]
                .name,
            '001',
        );
        book.getWorksheet('Data').getCell('A2').value = { formula: '"int"', result: 'int' };
        await book.xlsx.writeFile(join(root, 'config-source/lobby/items.xlsx'));
        await assert.rejects(compileTables(root, [module], runtime, new Map()), /Data!A2/);
    }));
test('dynamic asset fields produce typed logical keys without loading engine assets', async () =>
    fixture(async (root, module) => {
        await workbook(root, 'items', [
            ['id', 'icon'],
            ['int', 'asset<SpriteFrame>'],
            [],
            ['编号', '图标'],
            [1, 'coin'],
        ]);
        const registry = new Map([['lobby/default/sprite/coin', { type: 'SpriteFrame' }]]);
        const result = await compileTables(root, [module], runtime, registry);
        assert.deepEqual(
            JSON.parse(result.output['assets/game/modules/lobby/bundles/default/dynamic/config/items.json']).rows[0]
                .icon,
            {
                id: 'lobby/default/sprite/coin',
                type: 'SpriteFrame',
            },
        );
    }));

test('module validation rejects cycles and duplicate physical bundle names', () => {
    const make = (id, dependencies = [], bundle = id) => ({
        id,
        dependencies: Object.fromEntries(dependencies.map((id) => [id, id])),
        bundles: { default: { id: bundle, root: 'res' } },
        assets: {},
        views: {},
    });
    assert.throws(() => validateModules([make('a', ['b']), make('b', ['a'])]), /cyclic/);
    assert.throws(() => validateModules([make('a', [], 'same'), make('b', [], 'same')]), /duplicate bundle/);
});
test('code-only modules do not require a resource bundle or a particular business name', () => {
    assert.doesNotThrow(() =>
        validateModules([{ id: 'metrics', dependencies: {}, bundles: {}, assets: {}, views: {} }]),
    );
});
test('resource-only modules have no runtime dependencies and invalid delivery modes fail early', () => {
    const data = { id: 'data', dependencies: {}, code: { mode: 'none' }, bundles: {}, views: {} };
    const consumer = { id: 'consumer', dependencies: { data: 'data' }, bundles: {}, views: {} };
    assert.doesNotThrow(() => validateModules([data]));
    assert.throws(() => validateModules([data, consumer]), /no business runtime/);
    assert.throws(
        () => validateModules([{ ...data, factory: { file: 'factory.ts', export: 'factory' } }]),
        /resource-only/,
    );
    assert.throws(() => validateModules([{ ...data, code: { mode: 'typo' } }]), /code.mode/);
});
test('project settings isolate applications and allow arbitrary audio groups and calendar rules', () => {
    const settings = {
        formatVersion: 1,
        appId: 'com.example.puzzle',
        cleanupTimeoutMs: 5000,
        maxAudioVoices: 8,
        bindingPrefixes: { txt: 'Label' },
        audioChannels: { ambient: 0.5 },
        calendar: { offsetMinutes: -300, weekStartsOn: 0, resetMinute: 90 },
    };
    const options = settingsTools.runtimeOptions(settings);
    assert.equal(options.appId, 'com.example.puzzle');
    assert.equal(options.audioChannels.ambient, 0.5);
    assert.deepEqual(options.time.calendar, { offsetMinutes: -300, weekStartsOn: 0, resetMinute: 90 });
    assert.throws(() => settingsTools.runtimeOptions({ ...settings, appId: '' }), /appId/);
    assert.throws(
        () => settingsTools.runtimeOptions({ ...settings, calendar: { resetMinute: 1440 } }),
        /Invalid calendar/,
    );
    assert.throws(() => settingsTools.runtimeOptions({ ...settings, audioChannels: { ambient: 2 } }), /audio channel/);
});
test('generation refuses paths outside project and serialized engine asset writes', async () =>
    fixture(async (root) => {
        assert.throws(() => within(root, '../outside.ts'), /escapes project/);
        await assert.rejects(writeBatch(root, { 'assets/test.prefab': '[]' }), /through the editor/);
    }));
test('source checks detect inherited engine hooks, iterable spread and framework-to-game imports', async () =>
    fixture(async (root) => {
        await mkdir(join(root, 'assets/framework'), { recursive: true });
        await mkdir(join(root, 'assets/game'), { recursive: true });
        await writeFile(
            join(root, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', strict: true } }),
        );
        await writeFile(
            join(root, 'assets/framework/base.ts'),
            'export class Component {} export class GameComponent extends Component {}',
        );
        await writeFile(
            join(root, 'assets/game/example.ts'),
            "import { GameComponent as Base } from '../framework/base'; class Middle extends Base {} export class Example extends Middle { ['onLoad']() {} } const wrong=[...new Set([1])];",
        );
        await writeFile(
            join(root, 'assets/framework/wrong.ts'),
            "import {Example} from '../game/example'; export const wrong=Example;",
        );
        const issues = await lifecycleCheck(root);
        assert.ok(issues.some((text) => text.includes('Reserved engine hook onLoad')));
        assert.ok(issues.some((text) => text.includes('Array.from')));
        assert.ok(issues.some((text) => text.includes('cannot import project')));
    }));
