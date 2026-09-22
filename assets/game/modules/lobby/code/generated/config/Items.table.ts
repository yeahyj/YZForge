// 自动生成的配置合同，JSON 数据行留在资源 Bundle。
import { defineTable } from '../../../../../../framework/config/schema';
import type { ItemsRow, ItemsId, ItemsIndexes } from './Items.types';
/**
 * lobby.items 的轻量加载合同，import 本常量不会加载数据。
 * 页面使用 show.config.load(ItemsTable)；模块服务使用 ctx.config.load；多分片通过选项选择 bundle。
 * 表句柄跟随所选 Scope；公开合同可跨模块导入，读取数据不启动所属模块业务工厂。
 * @example
 * const table = await show.config.load(ItemsTable);
 * const rows = table.all(); // 按主键排序的只读数据行
 */
export const ItemsTable = defineTable<ItemsRow, ItemsId, ItemsIndexes>({
    id: 'lobby.items',
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
        enabled: {
            kind: 'bool',
        },
    },
    indexes: {},
    schemaHash: 'sha256:96f3a38807b52e2248aebad7faee03d807b52e76274a0a281deb35d7491fdba7',
});
