// 由 XLSX 自动生成，请修改源工作簿中的字段类型与说明。
import type { AssetKey } from '../../../../../../framework/assets/asset-types';

/** common.economy 的主键类型，对应字段 id；查询时不隐式转换字符串和数字。 */
export type EconomyId = number;
/** common.economy 的单行结构。config.load 后的数据递归只读，不用于保存可变玩家状态。 */
export interface EconomyRow {
    /** 编号；不可为空，加载后只读。 */
    readonly id: number;
    /** 用途；不可为空，加载后只读。 */
    readonly name: string;
    /** 奖励数量；不可为空，加载后只读。 */
    readonly amount: number;
}
/** common.economy 声明的索引及查询值类型，供 ConfigTable.by 推导参数。 */
export interface EconomyIndexes {}
