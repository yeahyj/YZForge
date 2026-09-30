/** 模块公开 API 合同；跨模块调用依赖此合同，不直接导入 code 中的私有实现。 */
export interface WorkshopApi {
    /** 当前模块的稳定 ID。 */
    readonly moduleId: string;
}
