import { _decorator } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { NoticeToastParams } from './NoticeToast.types';
import { NoticeToastBinding } from './generated/NoticeToastBinding';
const { ccclass } = _decorator;
/** Toast 的短时显示属于界面表现，使用帧更新累计，不修改业务日历时钟。 */
@ccclass('showcase.NoticeToast')
export class NoticeToast extends NoticeToastBinding {
    private elapsed = 0;
    protected onShow(show: ViewShowContext<NoticeToastParams, void>): void {
        this.elapsed = 0;
        this.lblTitle.string = show.params.title;
        this.lblDetail.string = show.params.detail;
    }
    protected onTick(dt: number, show: ViewShowContext<NoticeToastParams, void>): void {
        this.elapsed += dt;
        if (this.elapsed >= 1.8) show.finish(undefined);
    }
}
