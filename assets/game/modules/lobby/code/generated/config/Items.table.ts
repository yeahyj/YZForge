// 自动生成的配置合同，JSON 数据行留在资源 Bundle。
import { defineTable } from '../../../../../../framework/config/schema';
import type { ItemsRow, ItemsId, ItemsIndexes } from './Items.types';
/**
 * lobby.items 的轻量加载合同，import 本常量不会加载数据。
 * 使用 ctx.config.load(ItemsTable, owner) 按需取得只读表；多分片时用选项选择 bundle。
 * owner 决定表句柄使用期限，界面临时数据传 show.scope。
 * @example
 * const table = await this.ctx.config.load(ItemsTable, show.scope);
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
