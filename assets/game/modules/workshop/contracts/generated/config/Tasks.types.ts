// 由 XLSX 自动生成，请修改源工作簿中的字段类型与说明。
import type { AssetKey } from '../../../../../../framework/assets/asset-types';
import type { Quality as workshop_Quality } from '../enums/Quality';
/** workshop.tasks 的主键类型，对应字段 id；查询时不隐式转换字符串和数字。 */
export type TasksId = number;
/** workshop.tasks 的单行结构。config.load 后的数据递归只读，不用于保存可变玩家状态。 */
export interface TasksRow {
    /** 任务编号；不可为空，加载后只读。 */
    readonly id: number;
    /** 显示名称；不可为空，加载后只读。 */
    readonly name: string;
    /** 所需训练次数；不可为空，加载后只读。 */
    readonly goal: number;
    /** 可领取金币；不可为空，加载后只读。 */
    readonly reward: number;
    /** 任务品质；不可为空，加载后只读。 */
    readonly quality: workshop_Quality;
    /** 公共奖励配置引用；不可为空，加载后只读。 */
    readonly economy: number;
}
/** workshop.tasks 声明的索引及查询值类型，供 ConfigTable.by 推导参数。 */
export interface TasksIndexes {
    /** quality 字段的分组索引；table.by('quality', value) 始终返回只读行数组。 */
    readonly quality: workshop_Quality;
}
