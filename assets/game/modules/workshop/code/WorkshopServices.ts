import { moduleServices } from '../../../../framework/modules/module-manager';
import type { TaskService } from './services/TaskService';

/** 模块工厂显式提供的内部服务集合；界面通过 ctx.services 获取。 */
export const WorkshopServices = moduleServices<{ tasks: TaskService }>('workshop');
