import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { RewardPopupParams, RewardPopupResult } from './RewardPopup.types';
import { RewardPopupBinding } from './generated/RewardPopupBinding';
const { ccclass } = _decorator;
/**
 * 参数与结果通信示例：调用方传入标题和数量，弹窗通过 show.finish 返回选择结果。
 */
@ccclass('lobby.RewardPopup')
export class RewardPopup extends RewardPopupBinding {
    /**
     * 读取本次参数并注册两个按钮；监听随展示结束自动解除，不需要在 onHide 手动 off。
     * @param show - 本次展示上下文，参数从 show.params 读取；finish 发起关闭但不等待自身清理。
     */
    protected onShow(show: ViewShowContext<RewardPopupParams, RewardPopupResult>): void {
        this.lblTitle.string = show.params.title;
        this.lblAmount.string = `金币 × ${show.params.amount}`;
        show.listen(this.btnConfirm.node, Button.EventType.CLICK, () => {
            show.finish({ claimed: true, amount: show.params.amount });
        });
        show.listen(this.btnCancel.node, Button.EventType.CLICK, () => {
            show.finish({ claimed: false, amount: 0 });
        });
    }
}
