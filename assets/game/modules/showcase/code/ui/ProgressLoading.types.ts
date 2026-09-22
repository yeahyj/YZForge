/** 界面只接收显示数据；调用者持有业务服务。 */
export interface ProgressLoadingParams {
    readonly title: string;
    readonly detail: string;
}
/** 用户确认时返回 true，取消由 UIManager 的 cancelled 分支表示。 */
export type ProgressLoadingResult = boolean;
