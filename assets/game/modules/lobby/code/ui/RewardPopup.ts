import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { RewardPopupParams, RewardPopupResult } from './RewardPopup.types';
import { RewardPopupBinding } from './generated/RewardPopupBinding';
const { ccclass } = _decorator;
@ccclass('lobby.RewardPopup')
export class RewardPopup extends RewardPopupBinding {
  protected onShow(show: ViewShowContext<RewardPopupParams, RewardPopupResult>): void {
    this.lblTitle.string = show.params.title;
    this.lblAmount.string = `金币 × ${show.params.amount}`;
    show.listen(this.btnConfirm.node, Button.EventType.CLICK, () => { show.finish({ claimed: true, amount: show.params.amount }); });
    show.listen(this.btnCancel.node, Button.EventType.CLICK, () => { show.finish({ claimed: false, amount: 0 }); });
  }
}
