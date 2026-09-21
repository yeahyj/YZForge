import { AssetKind } from '../assets/asset-types';
import { logicalKey } from '../assets/catalog';
import { invariant } from '../core/errors';
import { parseISO } from '../time/calendar';
/**
 * 把配置行中的对象和数组递归转为只读 TypeScript 类型；这是类型约束，实际冻结由配置加载器完成。
 * 不要把配置表行作为可变玩家状态，需修改时创建自己的业务数据副本。
 */
export type DeepReadonly<T> = T extends readonly (infer E)[]
    ? readonly DeepReadonly<E>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;
/**
 * 配置字段的运行时校验合同，由 XLSX 导出流程生成；业务主要在表格中声明类型和约束。
 */
export interface FieldSchema {
    /**
     * 基础种类：int 安全整数、float 有限数值、bool 布尔、string 文本、enum 枚举值、ref 外键、asset 资源键、vec2/vec3 向量、color RGBA、array 数组。
     * 向量和颜色导出为普通 JSON 对象，不是 Cocos Vec3/Color 实例。
     */
    readonly kind: 'int' | 'float' | 'bool' | 'string' | 'enum' | 'ref' | 'asset' | 'vec2' | 'vec3' | 'color' | 'array';
    /**
     * 是否允许 null，默认 false；可空字段仍必须存在，不表示允许 undefined 或缺失字段。
     */
    readonly nullable?: boolean;
    /**
     * array 的元素合同，数组类型必须提供；可描述嵌套数组或带约束的元素。
     */
    readonly element?: FieldSchema;
    /**
     * enum 允许的字符串或数字值集合，运行时按值严格匹配。
     */
    readonly values?: readonly (string | number)[];
    /**
     * 命名枚举 ID，保留导出类型与表中枚举声明的关联；真正校验取值使用 values。
     */
    readonly enumId?: string;
    /**
     * ref 指向的配置表 ID。跨表存在性由导出检查完成，运行时不会据此自动加载另一张表。
     */
    readonly target?: string;
    /**
     * ref 对应的主键类型 int 或 string，省略时按 int 校验；不把字符串数字自动转成数值。
     */
    readonly keyKind?: 'int' | 'string';
    /**
     * asset 字段要求的 Cocos 种类，例如 SpriteFrame；JSON 值为含 id 和 type 的 AssetKey。
     */
    readonly assetType?: AssetKind;
    /**
     * 数值最小值，包含边界；省略时不设下界。
     */
    readonly min?: number;
    /**
     * 数值最大值，包含边界；省略时不设上界。
     */
    readonly max?: number;
    /**
     * 字符串长度或数组元素数的下界，包含边界；默认 0。
     * 字符串采用 JavaScript length，不等于所有 Unicode 字符的视觉数量。
     */
    readonly minLength?: number;
    /**
     * 字符串长度或数组元素数的上界，包含边界；省略时不设上界。
     */
    readonly maxLength?: number;
    /**
     * 文本格式约束：date 为 YYYY-MM-DD；date-time 为带明确时区的 ISO 日期时间。
     * 导出和加载后仍是字符串，需要时间戳时使用 calendar.parseISO。
     */
    readonly format?: 'date' | 'date-time';
}
/**
 * 配置表的轻量结构合同：字段、主键、索引及结构版本，不包含实际数据行。
 */
export interface TableDefinition {
    /**
     * 稳定的配置表 ID，格式为模块.表名，例如 lobby.items；用于查发布清单中的 JSON 数据路由。
     */
    readonly id: string;
    /**
     * 表结构的哈希，运行时与 JSON 头部核对；字段结构改变后需重新导出合同及数据。
     */
    readonly schemaHash: string;
    /**
     * 主键字段名；必须是非空的 int 或 string，值不得重复，字符串主键不得为空。
     */
    readonly primaryKey: string;
    /**
     * 字段名到校验合同的映射；每行必须完整包含这些字段，不允许额外字段。
     */
    readonly fields: Readonly<Record<string, FieldSchema>>;
    /**
     * 索引名到 { field, unique } 的映射，供 table.by 查询；unique 为 true 时导出及加载都拒绝重复值。
     */
    readonly indexes: Readonly<Record<string, { readonly field: string; readonly unique: boolean }>>;
}
/**
 * 带行、主键和索引类型的公开配置合同，通常使用生成的 ItemsTable 等常量。
 * import 合同只获得类型和结构描述；调用 config.load 才按路由加载实际 JSON 数据。
 * @typeParam Row - 单行数据类型。
 * @typeParam Key - 主键类型，默认为 number。
 * @typeParam Indexes - 索引名到索引值类型的映射。
 */
export interface TableKey<
    Row,
    Key extends string | number = number,
    Indexes extends object = object,
> extends TableDefinition {
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    readonly __row?: Row;
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    readonly __key?: Key;
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    readonly __indexes?: Indexes;
}
/**
 * 为生成代码创建并冻结配置合同；普通业务无需手写，直接导入生成的表常量。
 * @param definition - 表 ID、结构哈希、主键、字段和索引。
 * @returns 可交给 config.load 的 TableKey，不会读取 JSON 或启动 Bundle 加载。
 */
export function defineTable<R, K extends string | number, I extends object>(
    definition: TableDefinition,
): TableKey<R, K, I> {
    return freeze(definition);
}
/**
 * @internal
 * 原地递归冻结普通配置对象及其可枚举子值，不创建副本。
 * @param value - 已由调用方复制的无循环 JSON 数据或生成合同。
 * @returns 同一值的 DeepReadonly 类型视图；不用于 Map、Set 或引擎对象。
 */
export function freeze<T>(value: T): DeepReadonly<T> {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value as object)) freeze(child);
        Object.freeze(value);
    }
    return value as DeepReadonly<T>;
}
/**
 * @internal
 * 依据字段合同检查单个 JSON 值，供配置加载器使用。
 * @param value - 待检查值。
 * @param schema - 字段种类、可空性和约束。
 * @param location - 错误定位文本，例如 lobby.items[0].amount。
 * @throws FrameworkError 值类型、范围、结构或日期格式不符合合同。
 */
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
/**
 * @internal
 * 检查一整行的字段集合和每个字段值，不执行跨表查询。
 * @param row - 待检查的普通 JSON 对象。
 * @param definition - 生成的表合同。
 * @param index - 从 0 开始的数据行位置，用于报错定位。
 * @throws FrameworkError 缺字段、多字段或字段值不合法。
 */
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
