import test from 'node:test';
import assert from 'node:assert/strict';
import { defineTable, validateValue } from '../assets/framework/config/schema';
import { parseTable, ConfigTable } from '../assets/framework/config/config-table';
import { Scope } from '../assets/framework/core/scope';
import { ConfigManager } from '../assets/framework/config/config-manager';
import { deferred, flush } from './fake-clock';
const key = defineTable({
    id: 'lobby.items',
    schemaHash: 'schema',
    primaryKey: 'id',
    fields: {
        id: { kind: 'int' },
        name: { kind: 'string' },
        rank: { kind: 'enum', values: ['a', 'b'] },
        value: { kind: 'array', element: { kind: 'int' } },
    },
    indexes: { rank: { field: 'rank', unique: false } },
});
const data = () => ({
    formatVersion: 1,
    tableId: key.id,
    schemaHash: key.schemaHash,
    dataRevision: 'data',
    rows: [
        { id: 1, name: '001', rank: 'a', value: [0, 2] },
        { id: 2, name: 'two', rank: 'a', value: [] },
    ],
});
test('table validates contract and exposes immutable indexed rows with strict keys', async () => {
    const scope = new Scope('table');
    const table = new ConfigTable(parseTable(data(), key, 'data'), scope);
    assert.equal(table.size, 2);
    assert.equal(table.has('1'), false);
    assert.equal(table.by('rank', 'a').length, 2);
    assert.throws(() => {
        table.require(1).value.push(9);
    });
    assert.throws(() => table.require(9), { code: 'CONFIG_ROW_NOT_FOUND' });
    assert.throws(() => table.by('missing', 'a'), { code: 'CONFIG_INDEX_MISSING' });
    await scope.close();
    assert.throws(() => table.get(1), { code: 'OPERATION_CANCELLED' });
});
test('table refuses incompatible revisions, duplicates and invalid values', () => {
    assert.throws(() => parseTable(data(), key, 'new-data'), { code: 'CONFIG_CONTRACT_MISMATCH' });
    const duplicate = data();
    duplicate.rows.push(duplicate.rows[0]);
    assert.throws(() => parseTable(duplicate, key, 'data'), { code: 'CONFIG_DUPLICATE_KEY' });
    for (const value of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'])
        assert.throws(() => validateValue(value, { kind: 'int' }, 'test.id'));
    validateValue(null, { kind: 'string', nullable: true }, 'optional');
    validateValue(false, { kind: 'bool' }, 'bool');
    assert.throws(() => validateValue('2026-02-30', { kind: 'string', format: 'date' }, 'date'));
});

test('public cross-module tables load by route without starting business modules and share independent leases', async () => {
    let loads = 0,
        released = 0;
    const assets = {
        release: {
            tables: { [key.id]: [{ bundle: 'battle-data', path: 'dynamic/config/items', dataRevision: 'data' }] },
        },
        async loadPath(bundle: string, path: string, type: string, owner: Scope) {
            assert.equal(path, 'dynamic/config/items');
            assert.equal(bundle, 'battle-data');
            assert.equal(type, 'JsonAsset');
            loads++;
            owner.defer(() => {
                released++;
            });
            return { json: data() };
        },
    };
    const manager = new ConfigManager(assets as any),
        lobby = new Scope('lobby'),
        battle = new Scope('battle');
    const [a, b] = await Promise.all([manager.in(lobby).load(key), manager.in(battle).load(key)]);
    assert.equal(loads, 1);
    await lobby.close();
    assert.throws(() => a.require(1), { code: 'OPERATION_CANCELLED' });
    assert.equal(b.require(1).name, '001');
    assert.equal(released, 0);
    await battle.close();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(released, 1);
});

test('sharded tables require a selected bundle and scoped options preserve its route', async () => {
    const routes = ['battle-a', 'battle-b'].map((bundle) => ({ bundle, path: 'items', dataRevision: 'data' }));
    const selected: string[] = [];
    const manager = new ConfigManager({
        release: { tables: { [key.id]: routes } },
        async loadPath(bundle: string) {
            selected.push(bundle);
            return { json: data() };
        },
    } as any);
    const owner = new Scope('lobby'),
        config = manager.in(owner);
    await assert.rejects(config.load(key), { code: 'CONFIG_TARGET_REQUIRED' });
    await assert.rejects(config.load(key, { bundle: 'wrong' }), { code: 'CONFIG_TARGET_MISMATCH' });
    await config.load(key, { bundle: 'battle-b' });
    await config.loadMany({ items: key }, { bundle: 'battle-a' });
    assert.deepEqual(selected, ['battle-b', 'battle-a']);
    await owner.close();
});

test('a batch failure cancels its pending wait while another owner keeps the shared table', async () => {
    const gate = deferred(),
        batchOwner = new Scope('batch'),
        other = new Scope('other');
    const missing = defineTable({ ...key, id: 'missing' });
    let released = false,
        loads = 0;
    const manager = new ConfigManager({
        release: { tables: { [key.id]: [{ bundle: 'data', path: 'items', dataRevision: 'data' }] } },
        async loadPath(_bundle: string, _path: string, _type: string, owner: Scope) {
            loads++;
            owner.defer(() => {
                released = true;
            });
            await gate.promise;
            return { json: data() };
        },
    } as any);
    const shared = manager.load(key, other);
    await flush();
    await assert.rejects(manager.loadMany({ items: key, missing }, batchOwner), { code: 'CONFIG_ROUTE_MISSING' });
    assert.equal(released, false);
    assert.equal(loads, 1);
    gate.resolve();
    assert.equal((await shared).size, 2);
    await batchOwner.close();
    await other.close();
    await flush();
    assert.equal(released, true);
});
