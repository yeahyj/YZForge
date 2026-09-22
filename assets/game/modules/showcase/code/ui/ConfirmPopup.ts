import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { ConfirmPopupParams } from './ConfirmPopup.types';
import { ConfirmPopupBinding } from './generated/ConfirmPopupBinding';
const { ccclass } = _decorator;
/** 类型化 UI 参数与结果；本界面只处理交互，调用方收到 completed 后执行业务命令。 */
@ccclass('showcase.ConfirmPopup')
export class ConfirmPopup extends ConfirmPopupBinding {
    private opens = 0;
    protected onShow(show: ViewShowContext<ConfirmPopupParams, boolean>): void {
        this.opens++;
        this.lblTitle.string = show.params.title;
        this.lblDetail.string = show.params.detail + '\n' + `实例展示次数 ${this.opens} · showId ${show.showId}`;
        show.listen(this.btnConfirm.node, Button.EventType.CLICK, () => show.finish(true));
        show.listen(this.btnCancel.node, Button.EventType.CLICK, () => show.dismiss());
    }
}
