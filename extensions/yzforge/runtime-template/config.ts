import { JsonAsset } from 'cc';
import type { AssetScope } from './assets';
import { YZForgeError } from './errors';
import { assetRef, type ContentPackConfigRef } from './refs';

export type ConfigPayload = ArrayBuffer | string | unknown;

export interface ConfigCodec {
    readonly name: string;
    readonly version: number;
    decode(data: ConfigPayload): unknown;
}

export interface ConfigTable<TRow, TKey extends keyof TRow = keyof TRow> {
    readonly name?: string;
    readonly primaryKey?: TKey;
    get(id: TRow[TKey]): TRow | undefined;
    require(id: TRow[TKey]): TRow;
    all(): readonly TRow[];
}

export interface ConfigTableRef<TRow, TKey extends keyof TRow = keyof TRow> {
    readonly kind: 'config-table';
    readonly name: string;
    readonly primaryKey: TKey;
    readonly codec: string;
}

export interface ConfigDefinition<TTables = Record<string, unknown>> {
    readonly tables: TTables;
}

export interface ConfigScope<TTables = Record<string, unknown>> {
    readonly tables: TTables;
}

export class JsonConfigCodec implements ConfigCodec {
    public readonly name = 'yzforge-json';
    public readonly version = 1;

    public decode(data: ConfigPayload): unknown {
        if (typeof data === 'string') {
            return JSON.parse(data);
        }
        if (data instanceof ArrayBuffer) {
            return JSON.parse(new TextDecoder().decode(data));
        }
        return data;
    }
}

export class ConfigCodecRegistry {
    private readonly codecs = new Map<string, ConfigCodec>();

    public constructor() {
        this.register(new JsonConfigCodec());
    }

    public register(codec: ConfigCodec): void {
        this.codecs.set(codec.name, codec);
    }

    public get(name: string): ConfigCodec | undefined {
        return this.codecs.get(name);
    }

    public require(name: string): ConfigCodec {
        const codec = this.get(name);
        if (!codec) {
            throw new YZForgeError(`Config codec not found: ${name}`, 'config.codec_missing');
        }
        return codec;
    }

    public decode(name: string, data: ConfigPayload): unknown {
        return this.require(name).decode(data);
    }
}

export const configCodecs = new ConfigCodecRegistry();

export class ConfigManager {
    public async loadScope<TTables = Record<string, unknown>>(
        definition: ConfigDefinition<TTables> | ConfigScope<TTables> | Record<string, unknown>,
        assets: AssetScope,
    ): Promise<ConfigScope<Record<string, ConfigTable<Record<string, unknown>> | unknown>>> {
        const sourceTables = tableSource(definition);
        const tables: Record<string, ConfigTable<Record<string, unknown>> | unknown> = {};
        for (const key of Object.keys(sourceTables)) {
            const value = sourceTables[key];
            tables[key] = isConfigTableRef(value)
                ? await this.loadTable(value, assets)
                : value;
        }
        return createConfigScope(tables);
    }

    public async loadContentPackScope(
        refs: unknown,
        assets: AssetScope,
    ): Promise<ConfigScope<Record<string, ConfigTable<Record<string, unknown>>>>> {
        const tables: Record<string, ConfigTable<Record<string, unknown>>> = {};
        if (!refs || typeof refs !== 'object') {
            return createConfigScope(tables);
        }
        const values = refs as Record<string, unknown>;
        for (const key of Object.keys(values)) {
            const ref = values[key] as Partial<ContentPackConfigRef> | undefined;
            if (ref?.kind !== 'content-pack-config' || !ref.table) {
                continue;
            }
            tables[key] = await this.loadTable(tableRef({
                name: ref.table,
                primaryKey: (ref.primaryKey ?? 'id') as never,
                codec: ref.codec,
            }), assets);
        }
        return createConfigScope(tables);
    }

    public async loadTable<TRow extends Record<string, unknown>, TKey extends keyof TRow = 'id'>(
        ref: ConfigTableRef<TRow, TKey>,
        assets: AssetScope,
    ): Promise<ConfigTable<TRow, TKey>> {
        const json = await assets.load(assetRef(JsonAsset, ref.name));
        const payload = json && typeof json === 'object' && 'json' in json
            ? (json as JsonAsset).json
            : json;
        const decoded = configCodecs.decode(ref.codec, payload);
        const rows = normalizeConfigRows<TRow>(decoded, ref.name);
        return createConfigTable(ref.name, rows, ref.primaryKey);
    }
}

export function createConfigScope<TTables = Record<string, unknown>>(tables: TTables): ConfigScope<TTables> {
    return { tables };
}

export function defineConfig<TTables extends Record<string, unknown>>(
    config: ConfigDefinition<TTables>,
): ConfigDefinition<TTables> {
    return config;
}

export function tableRef<TRow extends Record<string, unknown>, TKey extends keyof TRow = 'id'>(
    options: { readonly name: string; readonly primaryKey?: TKey; readonly codec?: string },
): ConfigTableRef<TRow, TKey> {
    return {
        kind: 'config-table',
        name: options.name,
        primaryKey: options.primaryKey ?? 'id' as TKey,
        codec: options.codec ?? 'yzforge-json',
    };
}

export function createConfigTable<TRow extends Record<string, unknown>, TKey extends keyof TRow = 'id'>(
    name: string,
    rows: readonly TRow[],
    primaryKey: TKey = 'id' as TKey,
): ConfigTable<TRow, TKey> {
    const map = new Map<TRow[TKey], TRow>();
    for (const row of rows) {
        const key = row[primaryKey];
        if (map.has(key)) {
            throw new YZForgeError(`Duplicate config primary key: ${String(key)}`, 'config.duplicate_key', {
                table: name,
                primaryKey,
                key,
            });
        }
        map.set(row[primaryKey], row);
    }
    return {
        name,
        primaryKey,
        get(id) {
            return map.get(id);
        },
        require(id) {
            const row = map.get(id);
            if (!row) {
                throw new YZForgeError(`Config row not found: ${String(id)}`, 'config.row_missing', {
                    table: name,
                    primaryKey,
                    id,
                });
            }
            return row;
        },
        all() {
            return rows;
        },
    };
}

export function isConfigTableRef(value: unknown): value is ConfigTableRef<Record<string, unknown>, string> {
    return Boolean(value)
        && typeof value === 'object'
        && (value as ConfigTableRef<Record<string, unknown>, string>).kind === 'config-table';
}

function tableSource(definition: unknown): Record<string, unknown> {
    if (!definition || typeof definition !== 'object') {
        return {};
    }
    const tables = (definition as { tables?: unknown }).tables;
    return tables && typeof tables === 'object' ? tables as Record<string, unknown> : {};
}

function normalizeConfigRows<TRow extends Record<string, unknown>>(value: unknown, tableName: string): readonly TRow[] {
    if (Array.isArray(value)) {
        return value as readonly TRow[];
    }
    if (value && typeof value === 'object') {
        const record = value as { rows?: unknown; data?: unknown };
        if (Array.isArray(record.rows)) {
            return record.rows as readonly TRow[];
        }
        if (Array.isArray(record.data)) {
            return record.data as readonly TRow[];
        }
    }
    throw new YZForgeError(`Config table payload must be an array or contain rows[]: ${tableName}`, 'config.payload_invalid');
}
