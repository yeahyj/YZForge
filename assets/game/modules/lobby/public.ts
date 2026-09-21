import type { ModuleRef } from '../../../framework/modules/module-manager';
/**
 * 演示模块的公开业务 API；跨模块只依赖此合同，不直接导入内部 UI 或 Service。
 */
export interface LobbyApi {
    /**
     * 当前业务模块的稳定 ID。
     */
    readonly moduleId: string;
}
/**
 * 轻量模块引用；await app.modules.use(LobbyModule, owner) 后使用 handle.api。
 * import 此常量本身不初始化模块业务。
 */
export const LobbyModule: ModuleRef<LobbyApi> = { id: 'lobby' };
