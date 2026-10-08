import type { Lifetime } from '../core/scope';
import type { BundleRef } from '../assets/asset-types';
import type { TableKey, DeepReadonly } from './schema';
type AnyTableKey = TableKey<unknown, string | number, object>;

/**
 * 配置加载选项，用于选择同表在不同资源包中的数据分片。
 */
export interface ConfigLoadOptions {
    /**
     * 指定承载数据的 Bundle 引用；表只有一条路由时可省略，多条路由时必须指定。
     * 不会自动合并多个包的数据；BundleAccess.tables 已默认绑定其包。
     */
    readonly bundle?: BundleRef;
}

/**
 * 从生成的 TableKey 推导 TableAccess 的行、主键和索引类型，供 loadMany 保留每张表的类型提示。
 */
export type LoadedTable<T> = T extends TableKey<infer R, infer K, infer I> ? TableAccess<R, K, I> : never;
/** 只读表查询；每次查询检查当前所有者是否仍有效。 */
export interface TableAccess<Row, Key extends string | number = number, Indexes extends object = object> {
    /**
     * 配置表的稳定 ID；诊断元信息，所有者取消后仍可读取。
     */
    readonly id: string;

    /**
     * 本次加载的数据版本；诊断元信息，所有者取消后仍可读取。
     */
    readonly dataRevision: string;

    /**
     * 当前数据分片的行数，不代表其他 Bundle 中同表分片的总行数。
     * @throws OperationCancelled 所有者已取消。
     */
    readonly size: number;

    /**
     * 检查主键是否存在。
     * @param id - 与生成主键类型一致的值；1 与 "1" 是不同键。
     * @returns 存在为 true，否则为 false。
     * @throws OperationCancelled 所有者已取消。
     */
    has(id: Key): boolean;

    /**
     * 按主键查找，可用于允许数据不存在的场景。
     * @param id - 主键值。
     * @returns 递归只读的数据行；不存在时为 undefined。
     * @throws OperationCancelled 所有者已取消。
     */
    get(id: Key): DeepReadonly<Row> | undefined;

    /**
     * 按主键取必需存在的数据行；适合缺配置就应明确报错的场景。
     * @param id - 主键值。
     * @returns 递归只读的数据行。
     * @throws FrameworkError 主键不存在，错误码 CONFIG_ROW_NOT_FOUND。
     * @throws OperationCancelled 所有者已取消。
     * @example
     * const items = await this.ctx.config.load(ItemsTable, show.scope);
     * const item = items.require(1);
     * show.commit(() => { this.lblTitle.string = item.name; });
     */
    require(id: Key): DeepReadonly<Row>;

    /**
     * 按导出 JSON 的行序读取当前分片所有行；当前导出器按主键排序，不保证 XLSX 的原始行序。
     * @returns 只读数组及递归只读行；需要排序或修改时先复制业务所需数据。
     * @throws OperationCancelled 所有者已取消。
     */
    all(): readonly DeepReadonly<Row>[];

    /**
     * 按表中声明的索引查询，避免每次遍历全表。
     * @param name - 生成的索引名，必须在 XLSX 配置中声明。
     * @param value - 该索引字段的值，类型由 name 推导。
     * @returns 只读行数组；未匹配返回空数组，唯一索引也返回数组。
     * @throws FrameworkError 索引不存在，错误码 CONFIG_INDEX_MISSING。
     * @throws OperationCancelled 所有者已取消。
     */
    by<Name extends keyof Indexes & string>(name: Name, value: Indexes[Name]): readonly DeepReadonly<Row>[];
}

/** 当前使用期的配置加载入口，保留完整的行、主键和索引推导。 */
export interface ConfigAccess {
    /**
     * 默认配置所有者；ctx.config 通常是模块 Scope，不能代替短期展示 Scope。
     */
    readonly scope: Lifetime;

    /** 切换表的默认使用期限，保留当前默认数据包；不加载资源。 */
    in(scope: Lifetime): ConfigAccess;

    /**
     * 加载生成合同对应的配置表，并选择表句柄的生命周期。
     * @param key - 生成的表常量，例如 ItemsTable。
     * @param input - 可选 bundle，显式设置时覆盖该入口默认包；多分片表必须有确定的包。
     * @returns 类型完整的只读 TableAccess；当前入口的 scope 取消后不能继续查询。
     * @throws FrameworkError 路由、版本或数据不合法；取消时抛 OperationCancelled。
     * @example
     * const items = await show.config.load(ItemsTable);
     * show.commit(() => { this.lblTitle.string = items.require(1).name; });
     */
    load<R, K extends string | number, I extends object>(
        key: TableKey<R, K, I>,
        input?: ConfigLoadOptions,
    ): Promise<TableAccess<R, K, I>>;

    /**
     * 并行加载一组表，全部成功才返回；失败清理本批持有。
     * @param keys - 属性名到生成表常量的映射，结果保留这些属性名和各表类型。
     * @param input - 所有表共用的加载选项，显式 bundle 覆盖入口默认包。
     * @returns 命名的只读表集合，不自动跨包合并数据。
     */
    loadMany<T extends Record<string, AnyTableKey>>(
        keys: T,
        input?: ConfigLoadOptions,
    ): Promise<{
        readonly [K in keyof T]: LoadedTable<T[K]>;
    }>;
}
