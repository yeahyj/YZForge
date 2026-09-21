import { AssetKind } from '../assets/asset-types';
import { logicalKey } from '../assets/catalog';
import { invariant } from '../core/errors';
import { parseISO } from '../time/calendar';
export type DeepReadonly<T> = T extends readonly (infer E)[]
    ? readonly DeepReadonly<E>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;
export interface FieldSchema {
    readonly kind: 'int' | 'float' | 'bool' | 'string' | 'enum' | 'ref' | 'asset' | 'vec2' | 'vec3' | 'color' | 'array';
    readonly nullable?: boolean;
    readonly element?: FieldSchema;
    readonly values?: readonly (string | number)[];
    readonly enumId?: string;
    readonly target?: string;
    readonly keyKind?: 'int' | 'string';
    readonly assetType?: AssetKind;
    readonly min?: number;
    readonly max?: number;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly format?: 'date' | 'date-time';
}
export interface TableDefinition {
    readonly id: string;
    readonly schemaHash: string;
    readonly primaryKey: string;
    readonly fields: Readonly<Record<string, FieldSchema>>;
    readonly indexes: Readonly<Record<string, { readonly field: string; readonly unique: boolean }>>;
}
export interface TableKey<
    Row,
    Key extends string | number = number,
    Indexes extends object = object,
> extends TableDefinition {
    readonly __row?: Row;
    readonly __key?: Key;
    readonly __indexes?: Indexes;
}
export function defineTable<R, K extends string | number, I extends object>(
    definition: TableDefinition,
): TableKey<R, K, I> {
    return freeze(definition);
}
export function freeze<T>(value: T): DeepReadonly<T> {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value as object)) freeze(child);
        Object.freeze(value);
    }
    return value as DeepReadonly<T>;
}
export function validateValue(value: unknown, schema: FieldSchema, location: string): void {
    const fail = (valid: unknown, expected: string) =>
        invariant(valid, 'CONFIG_VALUE_INVALID', `${location}: expected ${expected}`);
    if (value === null) {
        fail(schema.nullable, 'a non-null value');
        return;
    }
    switch (schema.kind) {
        case 'int':
            fail(typeof value === 'number' && Number.isSafeInteger(value), 'a safe integer');
            break;
        case 'float':
            fail(typeof value === 'number' && Number.isFinite(value), 'a finite number');
            break;
        case 'bool':
            fail(typeof value === 'boolean', 'a boolean');
            break;
        case 'string':
            fail(typeof value === 'string', 'a string');
            break;
        case 'enum':
            fail(
                (typeof value === 'string' || typeof value === 'number') && schema.values?.includes(value),
                `one of ${schema.values}`,
            );
            break;
        case 'ref':
            validateValue(value, { kind: schema.keyKind ?? 'int' }, location);
            break;
        case 'asset': {
            const key = value as { id: string; type: AssetKind };
            fail(
                key && typeof key.id === 'string' && key.type === schema.assetType && Object.keys(key).length === 2,
                `AssetKey<${schema.assetType}>`,
            );
            logicalKey(key.id, key.type);
            break;
        }
        case 'vec2':
        case 'vec3':
        case 'color': {
            fail(value && typeof value === 'object' && !Array.isArray(value), schema.kind);
            const record = value as Record<string, unknown>;
            const fields =
                schema.kind === 'color' ? ['r', 'g', 'b', 'a'] : schema.kind === 'vec2' ? ['x', 'y'] : ['x', 'y', 'z'];
            fail(
                Object.keys(record).length === fields.length &&
                    fields.every(
                        (field) =>
                            typeof record[field] === 'number' &&
                            Number.isFinite(record[field]) &&
                            (schema.kind !== 'color' ||
                                (Number.isInteger(record[field]) &&
                                    Number(record[field]) >= 0 &&
                                    Number(record[field]) <= 255)),
                    ),
                schema.kind,
            );
            break;
        }
        case 'array': {
            fail(Array.isArray(value) && schema.element, 'an array');
            (value as unknown[]).forEach((element, index) =>
                validateValue(element, schema.element!, `${location}[${index}]`),
            );
            break;
        }
        default:
            fail(false, 'a supported field kind');
    }
    if (typeof value === 'number')
        fail(value >= (schema.min ?? -Infinity) && value <= (schema.max ?? Infinity), 'a value in the allowed range');
    if (typeof value === 'string' || Array.isArray(value))
        fail(
            value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity),
            'an allowed length',
        );
    if (schema.format === 'date-time') {
        fail(typeof value === 'string', 'ISO date-time text');
        parseISO(value as string);
    }
    if (schema.format === 'date') {
        fail(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'YYYY-MM-DD');
        parseISO(`${value}T00:00:00Z`);
    }
}
export function validateRow(row: unknown, definition: TableDefinition, index: number): void {
    invariant(
        row && typeof row === 'object' && !Array.isArray(row),
        'CONFIG_ROW_INVALID',
        `${definition.id}[${index}] is not a row`,
    );
    const record = row as Record<string, unknown>;
    invariant(
        Object.keys(record).length === Object.keys(definition.fields).length,
        'CONFIG_ROW_INVALID',
        `${definition.id}[${index}] has missing or extra fields`,
    );
    for (const [name, schema] of Object.entries(definition.fields))
        validateValue(record[name], schema, `${definition.id}[${index}].${name}`);
}
