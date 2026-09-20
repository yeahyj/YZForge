import type { Assets } from '../assets/asset-manager';
import { BundleRef, bundleId } from '../assets/asset-types';
import { LeaseCache } from '../assets/lease-cache';
import { invariant } from '../core/errors';
import { Scope } from '../core/scope';
import { ConfigTable, parseTable, TableData } from './config-table';
import { TableDefinition, TableKey } from './schema';
export interface ConfigLoadOptions { readonly bundle?: BundleRef; }
type AnyTableKey = TableKey<unknown, string | number, object>;
export type LoadedTable<T> = T extends TableKey<infer R, infer K, infer I> ? ConfigTable<R, K, I> : never;
export class ConfigManager {
  private readonly cache: LeaseCache<{ data: TableData; scope: Scope }>;
  private readonly requests = new Map<string, { definition: TableDefinition; bundle: string; path: string; revision: string }>();
  constructor(private readonly assets: Assets) {
    this.cache = new LeaseCache(async id => {
      const request = this.requests.get(id)!;
      const scope = new Scope(`table:${id}`);
      try {
        const json = await assets.loadPath(request.bundle, request.path, 'JsonAsset', scope);
        return { data: parseTable(json.json, request.definition, request.revision), scope };
      } catch (error) { await scope.close(); throw error; }
    }, () => {}, value => { void value.scope.close().catch(console.error); });
  }
  async load<R, K extends string | number, I extends object>(key: TableKey<R, K, I>, scope: Scope, input: ConfigLoadOptions = {}): Promise<ConfigTable<R, K, I>> {
    scope.signal.throwIfAborted();
    const routes = this.assets.release.tables[key.id];
    invariant(routes?.length, 'CONFIG_ROUTE_MISSING', `No published route for ${key.id}`);
    invariant(input.bundle || routes.length === 1, 'CONFIG_TARGET_REQUIRED', `Select a bundle for sharded table ${key.id}`);
    const route = input.bundle ? routes.find(item => item.bundle === bundleId(input.bundle!)) : routes[0];
    invariant(route, 'CONFIG_TARGET_MISMATCH', `${key.id} is not in the requested bundle`);
    const id = `${key.id}:${route.bundle}:${key.schemaHash}:${route.dataRevision}`;
    this.requests.set(id, { definition: key, bundle: route.bundle, path: route.path, revision: route.dataRevision });
    const loaded = await this.cache.acquire(id, scope);
    scope.signal.throwIfAborted();
    return new ConfigTable<R, K, I>(loaded.data, scope);
  }
  async loadMany<T extends Record<string, AnyTableKey>>(keys: T, owner: Scope, input?: ConfigLoadOptions): Promise<{ readonly [K in keyof T]: LoadedTable<T[K]> }> {
    const scope = owner.child('tables');
    const result: Record<string, unknown> = {};
    try {
      const pending = Object.entries(keys).map(async ([name, key]) => { result[name] = await this.load(key, scope, input); });
      const outcomes = await Promise.allSettled(pending);
      const failed = outcomes.find(value => value.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed) throw failed.reason;
      scope.signal.throwIfAborted();
      return Object.freeze(result) as { readonly [K in keyof T]: LoadedTable<T[K]> };
    } catch (error) { await scope.close(); throw error; }
  }
  in(scope: Scope, bundle?: BundleRef): ScopedConfig { return new ScopedConfig(this, scope, bundle); }
}
export class ScopedConfig {
  constructor(private readonly manager: ConfigManager, readonly scope: Scope, private readonly bundle?: BundleRef) {}
  load<R, K extends string | number, I extends object>(key: TableKey<R, K, I>, owner = this.scope, input: ConfigLoadOptions = {}): Promise<ConfigTable<R, K, I>> {
    return this.manager.load(key, owner, { bundle: this.bundle, ...input });
  }
  loadMany<T extends Record<string, AnyTableKey>>(keys: T, owner = this.scope, input: ConfigLoadOptions = {}) { return this.manager.loadMany(keys, owner, { bundle: this.bundle, ...input }); }
}
