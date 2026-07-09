import { sys } from 'cc';
import type { AppBootProfile } from './boot';
import { YZForgeError } from './errors';

export type AppStoragePartitionName = 'save' | 'settings' | 'cache';

export interface AppStorageAdapter {
    readonly length?: number;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key?(index: number): string | null;
}

export interface AppStoragePartitionSnapshot {
    readonly name: AppStoragePartitionName;
    readonly keyCount: number;
    readonly byteSize: number;
}

export interface AppStorageSnapshot {
    readonly namespace: string;
    readonly save: AppStoragePartitionSnapshot;
    readonly settings: AppStoragePartitionSnapshot;
    readonly cache: AppStoragePartitionSnapshot;
}

export interface AppStorageOptions {
    readonly appId?: string;
    readonly boot?: AppBootProfile;
    readonly adapter?: AppStorageAdapter;
}

export type AppStorageUserOptions = Omit<AppStorageOptions, 'boot'>;

export class AppStorage {
    public readonly save: AppStoragePartition;
    public readonly settings: AppStoragePartition;
    public readonly cache: AppStoragePartition;
    public readonly namespace: string;

    public constructor(options: AppStorageOptions = {}) {
        const appId = normalizeSegment(options.appId ?? 'app', 'appId');
        const channel = normalizeSegment(options.boot?.channel ?? 'default', 'channel');
        const profile = normalizeSegment(options.boot?.profile ?? 'debug', 'profile');
        const adapter = options.adapter ?? createDefaultStorageAdapter();
        this.namespace = ['yzforge', appId, channel, profile].join(':');
        this.save = new AppStoragePartition(adapter, this.namespace, 'save');
        this.settings = new AppStoragePartition(adapter, this.namespace, 'settings');
        this.cache = new AppStoragePartition(adapter, this.namespace, 'cache');
    }

    public partition(name: AppStoragePartitionName): AppStoragePartition {
        if (name === 'save') {
            return this.save;
        }
        if (name === 'settings') {
            return this.settings;
        }
        return this.cache;
    }

    public clearCache(): void {
        this.cache.clear();
    }

    public resetSave(): void {
        this.save.clear();
    }

    public resetSettings(): void {
        this.settings.clear();
    }

    public clearAll(): void {
        this.save.clear();
        this.settings.clear();
        this.cache.clear();
    }

    public snapshot(): AppStorageSnapshot {
        return {
            namespace: this.namespace,
            save: this.save.snapshot(),
            settings: this.settings.snapshot(),
            cache: this.cache.snapshot(),
        };
    }
}

export class AppStoragePartition {
    private readonly prefix: string;
    private readonly indexKey: string;
    private readonly keyPrefix: string;

    public constructor(
        private readonly adapter: AppStorageAdapter,
        private readonly namespace: string,
        public readonly name: AppStoragePartitionName,
        private readonly scope = '',
    ) {
        this.prefix = [namespace, name].join(':');
        this.indexKey = `${this.prefix}:__index`;
        this.keyPrefix = `${this.prefix}:`;
    }

    public child(scope: string): AppStoragePartition {
        const normalized = normalizeStorageKey(scope);
        return new AppStoragePartition(this.adapter, this.namespace, this.name, this.qualifyKey(normalized));
    }

    public has(key: string): boolean {
        return this.getRaw(key) !== undefined;
    }

    public getString(key: string, fallback?: string): string | undefined {
        const value = this.getRaw(key);
        return value ?? fallback;
    }

    public setString(key: string, value: string): void {
        if (typeof value !== 'string') {
            throw new YZForgeError('Storage string value must be a string.', 'storage.value_invalid', {
                partition: this.name,
                key,
            });
        }
        this.setRaw(key, value);
    }

    public getNumber(key: string, fallback?: number): number | undefined {
        const value = this.getRaw(key);
        if (value === undefined) {
            return fallback;
        }
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) {
            throw new YZForgeError(`Storage value is not a finite number: ${key}`, 'storage.number_invalid', {
                partition: this.name,
                key,
                value,
            });
        }
        return numberValue;
    }

    public setNumber(key: string, value: number): void {
        if (!Number.isFinite(value)) {
            throw new YZForgeError('Storage number value must be finite.', 'storage.value_invalid', {
                partition: this.name,
                key,
                value,
            });
        }
        this.setRaw(key, String(value));
    }

    public getBoolean(key: string, fallback?: boolean): boolean | undefined {
        const value = this.getRaw(key);
        if (value === undefined) {
            return fallback;
        }
        if (value === 'true') {
            return true;
        }
        if (value === 'false') {
            return false;
        }
        throw new YZForgeError(`Storage value is not a boolean: ${key}`, 'storage.boolean_invalid', {
            partition: this.name,
            key,
            value,
        });
    }

    public setBoolean(key: string, value: boolean): void {
        if (typeof value !== 'boolean') {
            throw new YZForgeError('Storage boolean value must be a boolean.', 'storage.value_invalid', {
                partition: this.name,
                key,
                value,
            });
        }
        this.setRaw(key, value ? 'true' : 'false');
    }

    public getJson<TValue>(key: string, fallback?: TValue): TValue | undefined {
        const value = this.getRaw(key);
        if (value === undefined) {
            return fallback;
        }
        try {
            return JSON.parse(value) as TValue;
        } catch (error) {
            throw new YZForgeError(`Storage JSON parse failed: ${key}`, 'storage.json_parse_failed', {
                partition: this.name,
                key,
                error,
            });
        }
    }

    public setJson<TValue>(key: string, value: TValue): void {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) {
            throw new YZForgeError('Storage JSON value cannot be undefined.', 'storage.value_invalid', {
                partition: this.name,
                key,
            });
        }
        this.setRaw(key, encoded);
    }

    public remove(key: string): void {
        const normalized = this.qualifyKey(normalizeStorageKey(key));
        const fullKey = this.fullKey(normalized);
        try {
            this.adapter.removeItem(fullKey);
            this.removeIndexedKey(normalized);
        } catch (error) {
            throw new YZForgeError(`Storage remove failed: ${key}`, 'storage.remove_failed', {
                partition: this.name,
                key,
                error,
            });
        }
    }

    public clear(): void {
        const keys = this.keys();
        for (const key of keys) {
            this.adapter.removeItem(this.fullKey(key));
        }
        this.adapter.removeItem(this.indexKey);
    }

    public keys(): string[] {
        const fromIndex = this.readIndex();
        const fromAdapter = this.scanKeys();
        return Array.from(new Set(fromIndex.concat(fromAdapter))).sort();
    }

    public snapshot(): AppStoragePartitionSnapshot {
        const keys = this.keys();
        let byteSize = 0;
        for (const key of keys) {
            byteSize += this.adapter.getItem(this.fullKey(key))?.length ?? 0;
        }
        return {
            name: this.name,
            keyCount: keys.length,
            byteSize,
        };
    }

    private getRaw(key: string): string | undefined {
        const normalized = this.qualifyKey(normalizeStorageKey(key));
        try {
            const value = this.adapter.getItem(this.fullKey(normalized));
            return value === null ? undefined : value;
        } catch (error) {
            throw new YZForgeError(`Storage read failed: ${key}`, 'storage.read_failed', {
                partition: this.name,
                key,
                error,
            });
        }
    }

    private setRaw(key: string, value: string): void {
        const normalized = this.qualifyKey(normalizeStorageKey(key));
        try {
            this.adapter.setItem(this.fullKey(normalized), value);
            this.addIndexedKey(normalized);
        } catch (error) {
            throw new YZForgeError(`Storage write failed: ${key}`, 'storage.write_failed', {
                partition: this.name,
                key,
                error,
            });
        }
    }

    private qualifyKey(key: string): string {
        return this.scope ? `${this.scope}/${key}` : key;
    }

    private fullKey(key: string): string {
        return `${this.keyPrefix}${key}`;
    }

    private readIndex(): string[] {
        const raw = this.adapter.getItem(this.indexKey);
        if (!raw) {
            return [];
        }
        try {
            const value = JSON.parse(raw);
            if (!Array.isArray(value)) {
                return [];
            }
            return value.filter((item): item is string => typeof item === 'string');
        } catch {
            return [];
        }
    }

    private writeIndex(keys: readonly string[]): void {
        if (keys.length === 0) {
            this.adapter.removeItem(this.indexKey);
            return;
        }
        this.adapter.setItem(this.indexKey, JSON.stringify(Array.from(new Set(keys)).sort()));
    }

    private addIndexedKey(key: string): void {
        const keys = this.readIndex();
        if (keys.indexOf(key) >= 0) {
            return;
        }
        keys.push(key);
        this.writeIndex(keys);
    }

    private removeIndexedKey(key: string): void {
        const keys = this.readIndex().filter((item) => item !== key);
        this.writeIndex(keys);
    }

    private scanKeys(): string[] {
        if (typeof this.adapter.key !== 'function' || typeof this.adapter.length !== 'number') {
            return [];
        }
        const keys: string[] = [];
        for (let index = 0; index < this.adapter.length; index += 1) {
            const fullKey = this.adapter.key(index);
            if (!fullKey || fullKey === this.indexKey || !fullKey.startsWith(this.keyPrefix)) {
                continue;
            }
            keys.push(fullKey.slice(this.keyPrefix.length));
        }
        return keys;
    }
}

export class MemoryStorageAdapter implements AppStorageAdapter {
    private readonly values = new Map<string, string>();

    public get length(): number {
        return this.values.size;
    }

    public getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    public removeItem(key: string): void {
        this.values.delete(key);
    }

    public key(index: number): string | null {
        return Array.from(this.values.keys())[index] ?? null;
    }
}

function createDefaultStorageAdapter(): AppStorageAdapter {
    const localStorage = sys.localStorage as unknown as AppStorageAdapter | undefined;
    if (
        localStorage
        && typeof localStorage.getItem === 'function'
        && typeof localStorage.setItem === 'function'
        && typeof localStorage.removeItem === 'function'
    ) {
        return localStorage;
    }
    return new MemoryStorageAdapter();
}

function normalizeSegment(value: string, label: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new YZForgeError(`Storage ${label} cannot be empty.`, 'storage.namespace_invalid', {
            label,
            value,
        });
    }
    return encodeURIComponent(trimmed);
}

function normalizeStorageKey(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('..') || trimmed.includes(':')) {
        throw new YZForgeError(`Storage key is invalid: ${value}`, 'storage.key_invalid', {
            key: value,
        });
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
        throw new YZForgeError(`Storage key must use letters, numbers, dot, underscore, dash or slash: ${value}`, 'storage.key_invalid', {
            key: value,
        });
    }
    const normalized = trimmed.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    if (!normalized) {
        throw new YZForgeError(`Storage key is invalid: ${value}`, 'storage.key_invalid', {
            key: value,
        });
    }
    return normalized;
}
