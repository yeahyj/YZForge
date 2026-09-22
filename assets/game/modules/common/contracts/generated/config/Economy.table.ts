// 自动生成的配置合同，JSON 数据行留在资源 Bundle。
import { defineTable } from '../../../../../../framework/config/schema';
import type { EconomyRow, EconomyId, EconomyIndexes } from './Economy.types';
/**
 * common.economy 的轻量加载合同，import 本常量不会加载数据。
 * 页面使用 show.config.load(EconomyTable)；模块服务使用 ctx.config.load；多分片通过选项选择 bundle。
 * 表句柄跟随所选 Scope；公开合同可跨模块导入，读取数据不启动所属模块业务工厂。
 * @example
 * const table = await show.config.load(EconomyTable);
 * const rows = table.all(); // 按主键排序的只读数据行
 */
export const EconomyTable = defineTable<EconomyRow, EconomyId, EconomyIndexes>({
    id: 'common.economy',
    primaryKey: 'id',
    fields: {
        id: {
            kind: 'int',
        },
        name: {
            kind: 'string',
        },
        amount: {
            kind: 'int',
        },
    },
    indexes: {},
    schemaHash: 'sha256:6adb2a8f2307dbd39ac436cf728bce9f29527a0cc2ed6ab5f37bb758bbccaade',
});
