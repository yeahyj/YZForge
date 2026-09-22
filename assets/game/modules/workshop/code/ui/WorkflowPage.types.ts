/** 工作流示例只接收需要的诊断能力，不依赖其他业务模块的页面或导航实现。 */
export interface WorkflowPageParams {
    readonly inspect: () => {
        readonly pages: readonly string[];
        readonly configCount: number;
        readonly resourceCount: number;
        readonly workshopCodeReady: boolean;
        readonly workshopBusinessReady: boolean;
    };
}
export type WorkflowPageResult = void;
