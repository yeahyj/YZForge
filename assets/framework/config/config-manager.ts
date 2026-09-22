import type { Assets } from '../assets/asset-manager';
import { BundleRef, bundleId } from '../assets/asset-types';
import { LeaseCache } from '../assets/lease-cache';
import { invariant } from '../core/errors';
import { Scope } from '../core/scope';
import { ConfigTable, parseTable, TableData } from './config-table';
import { TableDefinition, TableKey } from './schema';
/**
 * 配置加载选项，用于选择同表在不同资源包中的数据分片。
 */
export interface ConfigLoadOptions {
    /**
     * 指定承载数据的 Bundle 引用；表只有一条路由时可省略，多条路由时必须指定。
     * 不会自动合并多个包的数据；BundleHandle.tables 已默认绑定其包。
     */
    readonly bundle?: BundleRef;
}
type AnyTableKey = TableKey<unknown, string | number, object>;
/**
 * 从生成的 TableKey 推导 ConfigTable 的行、主键和索引类型，供 loadMany 保留每张表的类型提示。
 */
export type LoadedTable<T> = T extends TableKey<infer R, infer K, infer I> ? ConfigTable<R, K, I> : never;
/**
 * 集成于 App 的配置管理器：按合同找路由、按需加载 JSON、校验版本和数据、构建索引并共享只读数据。
 * 导出 XLSX 是编辑器和构建工具的职责；运行时 API 负责加载和查询已经导出的数据。
 */
export class ConfigManager {
    /** 读取配置共享数据及其页面/模块持有者，便于定位哪一个使用期限阻止表数据释放。 */
    inspect() {
        return this.cache.inspect();
    }
    private readonly cache: LeaseCache<{ data: TableData; scope: Scope }>;
    private readonly requests = new Map<
        string,
        { definition: TableDefinition; bundle: string; path: string; revision: string }
    >();
    /**
     * @internal
     * 由 App 创建配置服务，使用同一个 Assets 管理 Bundle 和 JSON 资源引用。
     */
    constructor(private readonly assets: Assets) {
        this.cache = new LeaseCache(
            async (id) => {
                const request = this.requests.get(id)!;
                const scope = new Scope(`table:${id}`);
                try {
                    const json = await assets.loadPath(request.bundle, request.path, 'JsonAsset', scope);
                    return { data: parseTable(json.json, request.definition, request.revision), scope };
                } catch (error) {
                    await scope.close();
                    throw error;
                }
            },
            () => {},
            (value) => {
                void value.scope.close().catch(console.error);
            },
        );
    }
    /**
     * 按生成的 TS 合同加载一份配置数据，结果的使用期由 scope 决定。
     * @param key - 生成的表常量，例如 ItemsTable；import 它本身不会加载数据。
     * @param scope - 表句柄所有者，例如 show.scope；取消后该句柄不能继续查询。
     * @param input - 可选 bundle；同表有多份分包数据时必须选择一份。
     * @returns 保留行、主键和索引类型的 ConfigTable。多次加载可共享底层数据，各自拥有生命周期。
     * @throws FrameworkError 路由不存在、分片选择缺失或不匹配、版本不一致、数据校验失败。
     * @throws OperationCancelled scope 已取消或等待期间取消。
     * @example
     * const items = await app.config.load(ItemsTable, owner);
     * const item = items.require(1);
     */
    async load<R, K extends string | number, I extends object>(
        key: TableKey<R, K, I>,
        scope: Scope,
        input: ConfigLoadOptions = {},
    ): Promise<ConfigTable<R, K, I>> {
        scope.signal.throwIfAborted();
        const routes = this.assets.release.tables[key.id];
        invariant(routes?.length, 'CONFIG_ROUTE_MISSING', `No published route for ${key.id}`);
        invariant(
            input.bundle || routes.length === 1,
            'CONFIG_TARGET_REQUIRED',
            `Select a bundle for sharded table ${key.id}`,
        );
        const route = input.bundle ? routes.find((item) => item.bundle === bundleId(input.bundle!)) : routes[0];
        invariant(route, 'CONFIG_TARGET_MISMATCH', `${key.id} is not in the requested bundle`);
        const id = `${key.id}:${route.bundle}:${key.schemaHash}:${route.dataRevision}`;
        this.requests.set(id, {
            definition: key,
            bundle: route.bundle,
            path: route.path,
            revision: route.dataRevision,
        });
        const loaded = await this.cache.acquire(id, scope);
        scope.signal.throwIfAborted();
        return new ConfigTable<R, K, I>(loaded.data, scope);
    }
    /**
     * 并行加载命名的一组表；任何一张失败都会清理本次批量加载持有，全部成功才返回。
     * @param keys - 自定义属性名到生成表常量的对象，例如 { items: ItemsTable, prices: PricesTable }。
     * @param owner - 这组表共同的所有者；内部创建一个子 Scope。
     * @param input - 共同的加载选项；不同表要选不同 Bundle 时分别调用 load。
     * @returns 与 keys 同名且保留各表类型的只读对象，不合并表中的数据行。
     * @throws 单表加载错误或 OperationCancelled；本批新增持有会回收。
     */
    async loadMany<T extends Record<string, AnyTableKey>>(
        keys: T,
        owner: Scope,
        input?: ConfigLoadOptions,
    ): Promise<{ readonly [K in keyof T]: LoadedTable<T[K]> }> {
        const scope = owner.child('tables');
        const result: Record<string, unknown> = {};
        try {
            const pending = Object.entries(keys).map(async ([name, key]) => {
                result[name] = await this.load(key, scope, input);
            });
            const outcomes = await Promise.allSettled(pending);
            const failed = outcomes.find((value) => value.status === 'rejected') as PromiseRejectedResult | undefined;
            if (failed) throw failed.reason;
            scope.signal.throwIfAborted();
            return Object.freeze(result) as { readonly [K in keyof T]: LoadedTable<T[K]> };
        } catch (error) {
            await scope.close();
            throw error;
        }
    }
    /**
     * 创建绑定默认所有者和可选 Bundle 的便捷配置入口，不加载任何表。
     * @param scope - 后续加载的默认所有者。
     * @param bundle - 可选默认数据包，适用于一组分包配置。
     * @returns ScopedConfig。
     */
    in(scope: Scope, bundle?: BundleRef): ScopedConfig {
        return new ScopedConfig(this, scope, bundle);
    }
}
/**
 * 带默认所有者的配置入口，通常从 show.config、ctx.config 或 BundleHandle.tables 获得。
 * ctx.config 默认跟随模块，show.config 默认跟随本次展示；跨模块公开表使用相同入口。
 */
export class ScopedConfig {
    /** 切换表的默认使用期限，保留当前默认数据包；不加载资源。 */
    in(scope: Scope): ScopedConfig {
        return this.manager.in(scope, this.bundle);
    }
    /**
     * 创建带默认所有者及数据包的门面，一般使用 config.in。
     * @param manager - 应用配置管理器。
     * @param scope - 默认表所有者。
     * @param bundle - 可选默认数据包。
     */
    constructor(
        private readonly manager: ConfigManager,
        /**
         * 默认配置所有者；ctx.config 通常是模块 Scope，不能代替短期展示 Scope。
         */
        readonly scope: Scope,
        private readonly bundle?: BundleRef,
    ) {}
    /**
     * 加载生成合同对应的配置表，并选择表句柄的生命周期。
     * @param key - 生成的表常量，例如 ItemsTable。
     * @param input - 可选 bundle，显式设置时覆盖该入口默认包；多分片表必须有确定的包。
     * @returns 类型完整的只读 ConfigTable；当前入口的 scope 取消后不能继续查询。
     * @throws FrameworkError 路由、版本或数据不合法；取消时抛 OperationCancelled。
     * @example
     * const items = await show.config.load(ItemsTable);
     * show.commit(() => { this.lblTitle.string = items.require(1).name; });
     */
    load<R, K extends string | number, I extends object>(
        key: TableKey<R, K, I>,
        input?: ConfigLoadOptions,
    ): Promise<ConfigTable<R, K, I>>;
    /** 显式覆盖所有者的兼容入口；常规页面优先 show.config.load(Table, { bundle })。 */
    load<R, K extends string | number, I extends object>(
        key: TableKey<R, K, I>,
        owner: Scope,
        input?: ConfigLoadOptions,
    ): Promise<ConfigTable<R, K, I>>;
    load<R, K extends string | number, I extends object>(
        key: TableKey<R, K, I>,
        ownerOrInput: Scope | ConfigLoadOptions = this.scope,
        input: ConfigLoadOptions = {},
    ): Promise<ConfigTable<R, K, I>> {
        const owner = ownerOrInput instanceof Scope ? ownerOrInput : this.scope;
        const options = ownerOrInput instanceof Scope ? input : ownerOrInput;
        return this.manager.load(key, owner, { bundle: this.bundle, ...options });
    }
    /**
     * 并行加载一组表，全部成功才返回；失败清理本批持有。
     * @param keys - 属性名到生成表常量的映射，结果保留这些属性名和各表类型。
     * @param input - 所有表共用的加载选项，显式 bundle 覆盖入口默认包。
     * @returns 命名的只读表集合，不自动跨包合并数据。
     */
    loadMany<T extends Record<string, AnyTableKey>>(
        keys: T,
        input?: ConfigLoadOptions,
    ): Promise<{ readonly [K in keyof T]: LoadedTable<T[K]> }>;
    /** 显式覆盖一组表的所有者；省略时使用当前 ScopedConfig 的默认期限。 */
    loadMany<T extends Record<string, AnyTableKey>>(
        keys: T,
        owner: Scope,
        input?: ConfigLoadOptions,
    ): Promise<{ readonly [K in keyof T]: LoadedTable<T[K]> }>;
    loadMany<T extends Record<string, AnyTableKey>>(
        keys: T,
        ownerOrInput: Scope | ConfigLoadOptions = this.scope,
        input: ConfigLoadOptions = {},
    ) {
        const owner = ownerOrInput instanceof Scope ? ownerOrInput : this.scope;
        const options = ownerOrInput instanceof Scope ? input : ownerOrInput;
        return this.manager.loadMany(keys, owner, { bundle: this.bundle, ...options });
    }
}
