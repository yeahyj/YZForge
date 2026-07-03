import type { Constructor } from './types';

export interface LibraryToken<TMap, TKey extends keyof TMap = keyof TMap> {
    readonly kind: 'library-token';
    readonly libraryName: string;
    readonly key: TKey;
    readonly id: string;
}

export interface ExtensionToken<TValue = unknown> {
    readonly kind: 'extension-token';
    readonly id: string;
    readonly __value?: TValue;
}

export interface ModuleExtensionToken<TValue = unknown> {
    readonly kind: 'module-extension-token';
    readonly id: string;
    readonly __value?: TValue;
}

export interface ClassTokenProvider<TValue> {
    readonly kind: 'class-token';
    readonly type: Constructor<TValue>;
}

export type TokenProvider<TValue = unknown> =
    | TValue
    | (() => TValue)
    | ClassTokenProvider<TValue>;

export function defineLibraryTokens<TMap extends Record<string, unknown>>(
    libraryName: string,
    keys: { readonly [TKey in keyof TMap]: string },
): { readonly [TKey in keyof TMap]: LibraryToken<TMap, TKey> } {
    const tokens: Partial<Record<keyof TMap, LibraryToken<TMap, keyof TMap>>> = {};
    for (const key of Object.keys(keys) as Array<keyof TMap>) {
        tokens[key] = {
            kind: 'library-token',
            libraryName,
            key,
            id: `${libraryName}.${String(keys[key])}`,
        };
    }
    return tokens as { readonly [TKey in keyof TMap]: LibraryToken<TMap, TKey> };
}

export function defineExtensionToken<TValue>(id: string): ExtensionToken<TValue> {
    return {
        kind: 'extension-token',
        id,
    };
}

export function defineModuleExtensionToken<TValue>(id: string): ModuleExtensionToken<TValue> {
    return {
        kind: 'module-extension-token',
        id,
    };
}

export function classToken<TValue>(type: Constructor<TValue>): ClassTokenProvider<TValue> {
    return {
        kind: 'class-token',
        type,
    };
}
