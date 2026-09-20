import { invariant } from '../core/errors';
import { Scope } from '../core/scope';
import { DeepReadonly, freeze, TableDefinition, validateRow } from './schema';
export interface TableEnvelope {
    readonly formatVersion: 1;
    readonly tableId: string;
    readonly schemaHash: string;
    readonly dataRevision: string;
    readonly rows: readonly unknown[];
}
export interface TableData {
    readonly id: string;
    readonly revision: string;
    readonly rows: readonly unknown[];
    readonly primary: ReadonlyMap<unknown, unknown>;
    readonly indices: ReadonlyMap<string, ReadonlyMap<unknown, readonly unknown[]>>;
}
export function parseTable(input: unknown, definition: TableDefinition, revision: string): TableData {
    const data = input as TableEnvelope;
    invariant(
        data?.formatVersion === 1 &&
            data.tableId === definition.id &&
            data.schemaHash === definition.schemaHash &&
            data.dataRevision === revision &&
            Array.isArray(data.rows),
        'CONFIG_CONTRACT_MISMATCH',
        `Incompatible table or release revision: ${definition.id}`,
    );
    const primary = new Map<unknown, unknown>();
    const indices = new Map<string, Map<unknown, unknown[]>>();
    const pk = definition.fields[definition.primaryKey];
    invariant(pk && !pk.nullable && ['int', 'string'].includes(pk.kind), 'CONFIG_PRIMARY_KEY_INVALID', definition.id);
    for (const [name, index] of Object.entries(definition.indexes)) {
        const field = definition.fields[index.field];
        invariant(
            field && !field.nullable && ['int', 'float', 'bool', 'string', 'enum', 'ref'].includes(field.kind),
            'CONFIG_INDEX_INVALID',
            `${definition.id}.${name}`,
        );
        indices.set(name, new Map());
    }
    data.rows.forEach((row, position) => {
        validateRow(row, definition, position);
        const record = row as Record<string, unknown>;
        const id = record[definition.primaryKey];
        invariant(
            !primary.has(id) && id !== '',
            'CONFIG_DUPLICATE_KEY',
            `${definition.id}: duplicate or empty primary key ${id}`,
        );
        primary.set(id, row);
        for (const [name, index] of Object.entries(definition.indexes)) {
            const map = indices.get(name)!;
            const value = record[index.field];
            const group = map.get(value) ?? [];
            invariant(
                !index.unique || !group.length,
                'CONFIG_DUPLICATE_INDEX',
                `${definition.id}.${name}: duplicate ${value}`,
            );
            group.push(row);
            map.set(value, group);
        }
    });
    // Clone plain JSON so freezing does not mutate a shared engine JsonAsset.
    const rows = JSON.parse(JSON.stringify(data.rows)) as unknown[];
    const originalToFrozen = new Map<unknown, unknown>();
    rows.forEach((row, index) => originalToFrozen.set(data.rows[index], freeze(row)));
    for (const [key, value] of primary) primary.set(key, originalToFrozen.get(value));
    for (const map of indices.values())
        for (const [key, group] of map)
            map.set(key, Object.freeze(group.map((row) => originalToFrozen.get(row))) as unknown[]);
    return { id: definition.id, revision, rows: Object.freeze(rows), primary, indices };
}
export class ConfigTable<Row, Key extends string | number = number, Indexes extends object = object> {
    constructor(
        private readonly data: TableData,
        private readonly owner: Scope,
    ) {}
    get id(): string {
        return this.data.id;
    }
    get dataRevision(): string {
        return this.data.revision;
    }
    get size(): number {
        this.owner.signal.throwIfAborted();
        return this.data.rows.length;
    }
    has(id: Key): boolean {
        this.owner.signal.throwIfAborted();
        return this.data.primary.has(id);
    }
    get(id: Key): DeepReadonly<Row> | undefined {
        this.owner.signal.throwIfAborted();
        return this.data.primary.get(id) as DeepReadonly<Row> | undefined;
    }
    require(id: Key): DeepReadonly<Row> {
        const row = this.get(id);
        invariant(row !== undefined, 'CONFIG_ROW_NOT_FOUND', `${this.id}: missing ${id}`);
        return row;
    }
    all(): readonly DeepReadonly<Row>[] {
        this.owner.signal.throwIfAborted();
        return this.data.rows as readonly DeepReadonly<Row>[];
    }
    by<Name extends keyof Indexes & string>(name: Name, value: Indexes[Name]): readonly DeepReadonly<Row>[] {
        this.owner.signal.throwIfAborted();
        const index = this.data.indices.get(name);
        invariant(index, 'CONFIG_INDEX_MISSING', `${this.id}: undeclared index ${name}`);
        return (index.get(value) ?? Object.freeze([])) as readonly DeepReadonly<Row>[];
    }
}
