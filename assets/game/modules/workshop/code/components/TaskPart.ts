import { _decorator, Button, UIOpacity } from 'cc';
import type { ActivationContext } from '../../../../../framework/core/game-component';
import type { TaskCardModel } from '../../contracts/workflow';
import { TaskPartBinding } from './generated/TaskPartBinding';
const { ccclass } = _decorator;
/** 通用任务卡片：只显示模型和回传输入；业务规则与存档不进入 Part。 */
@ccclass('workshop.TaskPart')
export class TaskPart extends TaskPartBinding {
    private model?: TaskCardModel;
    private claim?: (id: number) => Promise<void>;
    /** 可在激活前赋值，也可在业务事件到达后局部刷新。 */
    render(model: TaskCardModel, claim?: (id: number) => Promise<void>): void {
        this.model = model;
        if (claim) this.claim = claim;
        this.lblTitle.string = model.title;
        this.lblDetail.string = model.detail;
        this.lblState.string = { locked: '未完成', ready: '可领取', claimed: '已领取' }[model.state];
        this.btnClaim.interactable = model.state === 'ready';
        const opacity = this.btnClaim.getComponent(UIOpacity);
        if (opacity) opacity.opacity = model.state === 'ready' ? 255 : 110;
    }
    /** 自定义激活钩子绑定输入；禁用或销毁时自动解绑。 */
    protected onActivate(activation: ActivationContext): void {
        const button = this.btnClaim.node;
        const clicked = () => {
            const id = this.model?.id;
            if (id === undefined || !this.claim) return;
            void activation
                .run(() => this.claim!(id))
                .catch((error: unknown) => {
                    if (!activation.signal.aborted)
                        activation.commit(() => {
                            this.lblState.string = String(error);
                        });
                });
        };
        button.on(Button.EventType.CLICK, clicked);
        activation.scope.defer(() => button.off(Button.EventType.CLICK, clicked));
    }
}
