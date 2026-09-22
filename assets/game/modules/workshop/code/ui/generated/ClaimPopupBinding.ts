// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Label, Button } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { ClaimPopupParams, ClaimPopupResult } from '../ClaimPopup.types';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('workshop.ClaimPopupBinding')
export class ClaimPopupBinding extends UIView<ClaimPopupParams, ClaimPopupResult> {
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblTitle: Label | null = null;
    /**
     * 自动绑定节点 lbl_title 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblTitle(): Label {
        return this.requireBinding(this._bindLblTitle, 'lbl_title');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblDetail: Label | null = null;
    /**
     * 自动绑定节点 lbl_detail 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblDetail(): Label {
        return this.requireBinding(this._bindLblDetail, 'lbl_detail');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnConfirm: Button | null = null;
    /**
     * 自动绑定节点 btn_confirm 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnConfirm(): Button {
        return this.requireBinding(this._bindBtnConfirm, 'btn_confirm');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnCancel: Button | null = null;
    /**
     * 自动绑定节点 btn_cancel 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnCancel(): Button {
        return this.requireBinding(this._bindBtnCancel, 'btn_cancel');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.lblTitle;
        void this.lblDetail;
        void this.btnConfirm;
        void this.btnCancel;
    }
}
