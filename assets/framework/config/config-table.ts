import { invariant } from '../core/errors';
import { Scope } from '../core/scope';
import { DeepReadonly, freeze, TableDefinition, validateRow } from './schema';
/**
 * 配置数据 JSON 的文件结构，由 XLSX 导出器生成；运行时校验版本头之后才接收数据行。
 */
export interface TableEnvelope {
    /**
     * 配置 JSON 格式版本，目前固定为 1。
     */
    readonly formatVersion: 1;
    /**
     * 这份数据对应的配置表 ID，必须与 TableKey.id 一致。
     */
    readonly tableId: string;
    /**
     * 导出时的结构哈希，必须与公开 TS 合同一致。
     */
    readonly schemaHash: string;
    /**
     * 这份数据的版本，必须与发布清单指定的路由版本一致。
     */
    readonly dataRevision: string;
    /**
     * 原始 JSON 数据行，当前导出器按主键排序；加载后会复制、校验并递归冻结。
     */
    readonly rows: readonly unknown[];
}
/**
 * @internal
 * 配置加载器共享的已解析数据；业务通过 ConfigTable 查询，不直接持有或改写内部 Map。
 */
export interface TableData {
    /**
     * @internal
     * 配置表 ID。
     */
    readonly id: string;
    /**
     * @internal
     * 当前数据版本。
     */
    readonly revision: string;
    /**
     * @internal
     * 按导出顺序排列的冻结数据行。
     */
    readonly rows: readonly unknown[];
    /**
     * @internal
     * 主键到冻结数据行的只读映射。
     */
    readonly primary: ReadonlyMap<unknown, unknown>;
    /**
     * @internal
     * 索引名 → 索引值 → 冻结数据行数组；唯一索引也使用数组。
     */
    readonly indices: ReadonlyMap<string, ReadonlyMap<unknown, readonly unknown[]>>;
}
/**
 * @internal
 * 校验 JSON 的表 ID、结构版本、数据版本、字段及索引，然后复制并冻结行数据。
 * @param input - JsonAsset.json 中读取的数据。
 * @param definition - 对应生成的表合同。
 * @param revision - 发布清单要求的数据版本。
 * @returns 可被多个所有者共享的解析结果；不会冻结或修改引擎共享 JsonAsset 的原对象。
 * @throws FrameworkError 合同不匹配、行非法、主键或唯一索引重复。
 */
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
/**
 * 已加载且绑定所有者的只读配置表，提供主键查询、遍历和索引查询。
 * 数据行共享且递归冻结；owner 取消后，size 和所有数据查询都会抛 OperationCancelled。
 * 需要长期使用就用对应生命周期的 Scope 重新加载，避免把临时表句柄存入全局。
 * @typeParam Row - 生成的行类型。
 * @typeParam Key - 主键类型，字符串与数值不会互相转换。
 * @typeParam Indexes - 生成的索引名与索引值类型。
 */
export class ConfigTable<Row, Key extends string | number = number, Indexes extends object = object> {
    /**
     * @internal
     * 由 ConfigManager.load 创建，将共享解析数据绑定到本次加载所有者。
     */
    constructor(
        private readonly data: TableData,
        private readonly owner: Scope,
    ) {}
    /**
     * 配置表的稳定 ID；诊断元信息，所有者取消后仍可读取。
     */
    get id(): string {
        return this.data.id;
    }
    /**
     * 本次加载的数据版本；诊断元信息，所有者取消后仍可读取。
     */
    get dataRevision(): string {
        return this.data.revision;
    }
    /**
     * 当前数据分片的行数，不代表其他 Bundle 中同表分片的总行数。
     * @throws OperationCancelled 所有者已取消。
     */
    get size(): number {
        this.owner.signal.throwIfAborted();
        return this.data.rows.length;
    }
    /**
     * 检查主键是否存在。
     * @param id - 与生成主键类型一致的值；1 与 "1" 是不同键。
     * @returns 存在为 true，否则为 false。
     * @throws OperationCancelled 所有者已取消。
     */
    has(id: Key): boolean {
        this.owner.signal.throwIfAborted();
        return this.data.primary.has(id);
    }
    /**
     * 按主键查找，可用于允许数据不存在的场景。
     * @param id - 主键值。
     * @returns 递归只读的数据行；不存在时为 undefined。
     * @throws OperationCancelled 所有者已取消。
     */
    get(id: Key): DeepReadonly<Row> | undefined {
        this.owner.signal.throwIfAborted();
        return this.data.primary.get(id) as DeepReadonly<Row> | undefined;
    }
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
    require(id: Key): DeepReadonly<Row> {
        const row = this.get(id);
        invariant(row !== undefined, 'CONFIG_ROW_NOT_FOUND', `${this.id}: missing ${id}`);
        return row;
    }
    /**
     * 按导出 JSON 的行序读取当前分片所有行；当前导出器按主键排序，不保证 XLSX 的原始行序。
     * @returns 只读数组及递归只读行；需要排序或修改时先复制业务所需数据。
     * @throws OperationCancelled 所有者已取消。
     */
    all(): readonly DeepReadonly<Row>[] {
        this.owner.signal.throwIfAborted();
        return this.data.rows as readonly DeepReadonly<Row>[];
    }
    /**
     * 按表中声明的索引查询，避免每次遍历全表。
     * @param name - 生成的索引名，必须在 XLSX 配置中声明。
     * @param value - 该索引字段的值，类型由 name 推导。
     * @returns 只读行数组；未匹配返回空数组，唯一索引也返回数组。
     * @throws FrameworkError 索引不存在，错误码 CONFIG_INDEX_MISSING。
     * @throws OperationCancelled 所有者已取消。
     */
    by<Name extends keyof Indexes & string>(name: Name, value: Indexes[Name]): readonly DeepReadonly<Row>[] {
        this.owner.signal.throwIfAborted();
        const index = this.data.indices.get(name);
        invariant(index, 'CONFIG_INDEX_MISSING', `${this.id}: undeclared index ${name}`);
        return (index.get(value) ?? Object.freeze([])) as readonly DeepReadonly<Row>[];
    }
}
