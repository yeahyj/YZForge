// 自动生成的配置表引用集合，不包含 JSON 数据行。
import { TasksTable } from '../../../contracts/generated/config/Tasks.table';
/** workshop 模块的表合同集合；可传给 config.loadMany，实际 JSON 按需加载。 */
export const WorkshopTables = {
    /** workshop.tasks 的加载合同；用 config.load 或 loadMany 取得可查询的数据。 */
    tasks: TasksTable,
} as const;
