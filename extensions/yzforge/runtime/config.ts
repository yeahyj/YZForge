import { YZForgeError } from './errors';

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

export function createConfigScope<TTables = Record<string, unknown>>(tables: TTables): ConfigScope<TTables> {
    return { tables };
}

export function defineConfig<TConfig extends ConfigScope | Record<string, unknown>>(config: TConfig): TConfig {
    return config;
}

export function tableRef<TRow extends Record<string, unknown>, TKey extends keyof TRow = 'id'>(
    options: { readonly name: string; readonly primaryKey?: TKey },
): ConfigTableRef<TRow, TKey> {
    return {
        kind: 'config-table',
        name: options.name,
        primaryKey: options.primaryKey ?? 'id' as TKey,
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
