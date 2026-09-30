/** 通知文字，不携带 Service 或节点引用。 */
export interface NoticeToastParams {
    readonly title: string;
    readonly detail: string;
}
/** 通知显示完毕自动结束。 */
export type NoticeToastResult = void;
