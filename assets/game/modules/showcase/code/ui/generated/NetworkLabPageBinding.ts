// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Button, EditBox, Label } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { NetworkLabPageParams, NetworkLabPageResult } from '../NetworkLabPage.types';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('showcase.NetworkLabPageBinding')
export class NetworkLabPageBinding extends UIView<NetworkLabPageParams, NetworkLabPageResult> {
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnBack: Button | null = null;
    /**
     * 自动绑定节点 btn_back 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnBack(): Button {
        return this.requireBinding(this._bindBtnBack, 'btn_back');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: EditBox, visible: false })
    private _bindEditUrl: EditBox | null = null;
    /**
     * 自动绑定节点 edit_url 的 EditBox；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get editUrl(): EditBox {
        return this.requireBinding(this._bindEditUrl, 'edit_url');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnSuccess: Button | null = null;
    /**
     * 自动绑定节点 btn_success 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnSuccess(): Button {
        return this.requireBinding(this._bindBtnSuccess, 'btn_success');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnFailure: Button | null = null;
    /**
     * 自动绑定节点 btn_failure 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnFailure(): Button {
        return this.requireBinding(this._bindBtnFailure, 'btn_failure');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnTimeout: Button | null = null;
    /**
     * 自动绑定节点 btn_timeout 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnTimeout(): Button {
        return this.requireBinding(this._bindBtnTimeout, 'btn_timeout');
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
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnReal: Button | null = null;
    /**
     * 自动绑定节点 btn_real 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnReal(): Button {
        return this.requireBinding(this._bindBtnReal, 'btn_real');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblOutput: Label | null = null;
    /**
     * 自动绑定节点 lbl_output 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblOutput(): Label {
        return this.requireBinding(this._bindLblOutput, 'lbl_output');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.btnBack;
        void this.editUrl;
        void this.btnSuccess;
        void this.btnFailure;
        void this.btnTimeout;
        void this.btnCancel;
        void this.btnReal;
        void this.lblOutput;
    }
}
