/**
 * 演示页的打开参数合同，由 ViewKey 约束调用方；普通对象在打开时被复制并冻结。
 */
export interface DashboardParams {
    /**
     * 可选页面标题，演示调用方传入的扩展数据。
     */
    readonly title?: string;
}
/**
 * 该页面不返回业务数据；界面仍会提供 completed/cancelled/failed 状态。
 */
export type DashboardResult = void;
