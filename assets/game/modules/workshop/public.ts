import type { ModuleRef } from '../../../framework/modules/module-manager';
/** 模块公开 API 合同；跨模块调用依赖此合同，不直接导入 code 中的私有实现。 */
export interface WorkshopApi {
    /** 当前模块的稳定 ID。 */
    readonly moduleId: string;
}
/** 轻量模块引用；await app.modules.use(此引用, owner) 后通过 handle.api 使用业务能力。 */
export const WorkshopModule: ModuleRef<WorkshopApi> = { id: 'workshop' };
