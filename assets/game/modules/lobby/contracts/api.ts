/**
 * 演示模块的公开业务 API；跨模块只依赖此合同，不直接导入内部 UI 或 Service。
 */
export interface LobbyApi {
    /**
     * 当前业务模块的稳定 ID。
     */
    readonly moduleId: string;
}
