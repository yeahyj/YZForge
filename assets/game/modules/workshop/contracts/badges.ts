import { badgeKey } from '../../../../framework/badges/badge-store';
/** 任务入口数量；具体领取条件由 TaskService 计算。 */
export const TaskBadges = badgeKey('workshop/tasks');
/** 每项任务的稳定标识，不使用 UI 排序索引。 */
export const taskBadge = (id: number) => badgeKey(`workshop/tasks/${id}`);
