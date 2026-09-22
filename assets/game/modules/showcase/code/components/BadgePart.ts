import { _decorator } from 'cc';
import { BadgePartBinding } from './generated/BadgePartBinding';
const { ccclass } = _decorator;
/** 最小动态 Part：调用方决定放置位置和文本，Part 不进入 UI 页面栈。 */
@ccclass('showcase.BadgePart')
export class BadgePart extends BadgePartBinding {
    /** 渲染父对象传入的展示数据。 */
    render(text: string): void {
        this.lblTitle.string = text;
    }
}
