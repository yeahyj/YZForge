import { _decorator, Button } from 'cc';
import type { ActivationContext } from '../../../../../framework/core/game-component';
import { ComponentTabPartBinding } from './generated/ComponentTabPartBinding';
const { ccclass } = _decorator;
/** 页签中的业务 Part；创建和绑定留在 showcase，离开页签后计数及监听随实例释放。 */
@ccclass('showcase.ComponentTabPart')
export class ComponentTabPart extends ComponentTabPartBinding {
    /** 父页面在激活前设置业务标题。 */
    render(title: string): void {
        this.lblTitle.string = title;
        this.lblCount.string = '点击 0 次';
    }
    /** 点击监听只属于本次激活，切换页签立即移除。 */
    protected onActivate(activation: ActivationContext): void {
        let count = 0;
        const click = () =>
            activation.commit(() => {
                this.lblCount.string = `点击 ${++count} 次`;
            });
        this.btnIncrement.node.on(Button.EventType.CLICK, click);
        activation.signal.onAbort(() => this.btnIncrement.node.off(Button.EventType.CLICK, click));
    }
}
