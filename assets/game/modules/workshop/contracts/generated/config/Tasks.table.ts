// 自动生成的配置合同，JSON 数据行留在资源 Bundle。
import { defineTable } from '../../../../../../framework/config/schema';
import type { TasksRow, TasksId, TasksIndexes } from './Tasks.types';
/**
 * workshop.tasks 的轻量加载合同，import 本常量不会加载数据。
 * 页面使用 show.config.load(TasksTable)；模块服务使用 ctx.config.load；多分片通过选项选择 bundle。
 * 表句柄跟随所选 Scope；公开合同可跨模块导入，读取数据不启动所属模块业务工厂。
 * @example
 * const table = await show.config.load(TasksTable);
 * const rows = table.all(); // 按主键排序的只读数据行
 */
export const TasksTable = defineTable<TasksRow, TasksId, TasksIndexes>({
    id: 'workshop.tasks',
    primaryKey: 'id',
    fields: {
        id: {
            kind: 'int',
        },
        name: {
            kind: 'string',
        },
        goal: {
            kind: 'int',
            min: 1,
        },
        reward: {
            kind: 'int',
            min: 1,
        },
        quality: {
            kind: 'enum',
            values: ['normal', 'rare'],
            enumId: 'workshop.Quality',
        },
        economy: {
            kind: 'ref',
            target: 'common.economy',
            keyKind: 'int',
        },
    },
    indexes: {
        quality: {
            field: 'quality',
            unique: false,
        },
    },
    schemaHash: 'sha256:407b4de2eca1982f5fa7935a6a65e0fe8deadf5456ada20df6c2de378f6b4730',
});
