import { defineModule } from '../../../../framework/modules/module-manager';
import { WorkshopModule } from '../public';
import { dependencies } from './generated/dependencies';
import { WorkshopServices } from './WorkshopServices';
import { TaskService } from './services/TaskService';
/**
 * 显式装配模块服务，返回值在编译期匹配 public.ts 的 API 合同。
 * dependencies 按 module.json 的声明提供完整类型；无需 unknown 强制转换。
 * 需要内部服务时，在 code 中定义 moduleServices 合同，传入 services 选项并返回 services 对象。
 * UI 通过 this.ctx.services(服务合同) 读取；清理登记到 ctx.scope。
 */
export const createWorkshopModule = defineModule(
    WorkshopModule,
    { dependencies, services: WorkshopServices },
    (ctx, dependencies) => {
        return {
            services: { tasks: new TaskService(ctx, dependencies.profile) },
            api: {
                /** 当前模块的稳定 ID。 */ get moduleId() {
                    return ctx.id;
                },
            },
        };
    },
);
