// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Label, Sprite, Button } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { DashboardParams, DashboardResult } from '../Dashboard.types';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('lobby.DashboardBinding')
export class DashboardBinding extends UIView<DashboardParams, DashboardResult> {
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblTime: Label | null = null;
    /**
     * 自动绑定节点 lbl_time 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblTime(): Label {
        return this.requireBinding(this._bindLblTime, 'lbl_time');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblPeriod: Label | null = null;
    /**
     * 自动绑定节点 lbl_period 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblPeriod(): Label {
        return this.requireBinding(this._bindLblPeriod, 'lbl_period');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblItems: Label | null = null;
    /**
     * 自动绑定节点 lbl_items 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblItems(): Label {
        return this.requireBinding(this._bindLblItems, 'lbl_items');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Sprite, visible: false })
    private _bindSprIcon: Sprite | null = null;
    /**
     * 自动绑定节点 spr_icon 的 Sprite；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get sprIcon(): Sprite {
        return this.requireBinding(this._bindSprIcon, 'spr_icon');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnReward: Button | null = null;
    /**
     * 自动绑定节点 btn_reward 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnReward(): Button {
        return this.requireBinding(this._bindBtnReward, 'btn_reward');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnAudio: Button | null = null;
    /**
     * 自动绑定节点 btn_audio 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnAudio(): Button {
        return this.requireBinding(this._bindBtnAudio, 'btn_audio');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnReload: Button | null = null;
    /**
     * 自动绑定节点 btn_reload 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnReload(): Button {
        return this.requireBinding(this._bindBtnReload, 'btn_reload');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblResult: Label | null = null;
    /**
     * 自动绑定节点 lbl_result 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblResult(): Label {
        return this.requireBinding(this._bindLblResult, 'lbl_result');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblStatus: Label | null = null;
    /**
     * 自动绑定节点 lbl_status 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblStatus(): Label {
        return this.requireBinding(this._bindLblStatus, 'lbl_status');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.lblTime;
        void this.lblPeriod;
        void this.lblItems;
        void this.sprIcon;
        void this.btnReward;
        void this.btnAudio;
        void this.btnReload;
        void this.lblResult;
        void this.lblStatus;
    }
}
