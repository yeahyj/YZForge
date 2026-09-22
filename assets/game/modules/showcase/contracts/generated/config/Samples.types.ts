// 由 XLSX 自动生成，请修改源工作簿中的字段类型与说明。
import type { AssetKey } from '../../../../../../framework/assets/asset-types';
import type { Quality as showcase_Quality } from '../enums/Quality';
/** showcase.samples 的主键类型，对应字段 id；查询时不隐式转换字符串和数字。 */
export type SamplesId = number;
/** showcase.samples 的单行结构。config.load 后的数据递归只读，不用于保存可变玩家状态。 */
export interface SamplesRow {
    /** 主键；不可为空，加载后只读。 */
    readonly id: number;
    /** 名称；不可为空，加载后只读。 */
    readonly name: string;
    /** 分片路由；不可为空，加载后只读。 */
    readonly pack: string;
    /** 启用；不可为空，加载后只读。 */
    readonly enabled: boolean;
    /** 权重；不可为空，加载后只读。 */
    readonly weight: number;
    /** 命名枚举；不可为空，加载后只读。 */
    readonly quality: showcase_Quality;
    /** 标签数组；不可为空，加载后只读。 */
    readonly tags: readonly string[];
    /** 坐标；不可为空，加载后只读。 */
    readonly position: { readonly x: number; readonly y: number };
    /** 颜色；不可为空，加载后只读。 */
    readonly tint: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
    /** 动态资源键；不可为空，加载后只读。 */
    readonly icon: AssetKey<'SpriteFrame'>;
    /** 公共表外键；不可为空，加载后只读。 */
    readonly economy: number;
    /** 可空备注；允许 null，加载后只读。 */
    readonly note: string | null;
    /** 带偏移的日期时间；不可为空，加载后只读。 */
    readonly releasedAt: string;
}
/** showcase.samples 声明的索引及查询值类型，供 ConfigTable.by 推导参数。 */
export interface SamplesIndexes {
    /** quality 字段的分组索引；table.by('quality', value) 始终返回只读行数组。 */
    readonly quality: showcase_Quality;
}
