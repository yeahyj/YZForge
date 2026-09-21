/**
 * 奖励弹窗的打开参数，通过 ui.open 传入，在 show.params 读取。
 */
export interface RewardPopupParams {
    /**
     * 弹窗显示标题。
     */
    readonly title: string;
    /**
     * 演示奖励数量；这里只是展示数据，真实奖励应由业务服务校验及结算。
     */
    readonly amount: number;
}
/**
 * 弹窗提交给调用方的业务结果，通过 show.finish 提交，handle.result 的 completed 分支读取。
 */
export interface RewardPopupResult {
    /**
     * 玩家是否点击领取；演示取消按钮也主动返回 completed，claimed 为 false。
     * 外部关闭或所有者结束则产生 cancelled 状态，没有此业务结果。
     */
    readonly claimed: boolean;
    /**
     * 本次演示选择的数量；未领取时为 0。
     */
    readonly amount: number;
}
