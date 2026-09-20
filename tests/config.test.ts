import test from 'node:test';
import assert from 'node:assert/strict';
import { defineTable, validateValue } from '../assets/framework/config/schema';
import { parseTable, ConfigTable } from '../assets/framework/config/config-table';
import { Scope } from '../assets/framework/core/scope';
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
