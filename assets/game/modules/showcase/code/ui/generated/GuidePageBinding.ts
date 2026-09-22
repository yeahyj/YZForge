// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Button, Node, Label, Sprite } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { GuidePageParams, GuidePageResult } from '../GuidePage.types';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('showcase.GuidePageBinding')
export class GuidePageBinding extends UIView<GuidePageParams, GuidePageResult> {
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
    @property({ type: Node, visible: false })
    private _bindNodeContent: Node | null = null;
    /**
     * 自动绑定节点 node_content 的 Node；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get nodeContent(): Node {
        return this.requireBinding(this._bindNodeContent, 'node_content');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnStructure: Button | null = null;
    /**
     * 自动绑定节点 btn_structure 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnStructure(): Button {
        return this.requireBinding(this._bindBtnStructure, 'btn_structure');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnConfig: Button | null = null;
    /**
     * 自动绑定节点 btn_config 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnConfig(): Button {
        return this.requireBinding(this._bindBtnConfig, 'btn_config');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnService: Button | null = null;
    /**
     * 自动绑定节点 btn_service 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnService(): Button {
        return this.requireBinding(this._bindBtnService, 'btn_service');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnPresenter: Button | null = null;
    /**
     * 自动绑定节点 btn_presenter 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnPresenter(): Button {
        return this.requireBinding(this._bindBtnPresenter, 'btn_presenter');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnView: Button | null = null;
    /**
     * 自动绑定节点 btn_view 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnView(): Button {
        return this.requireBinding(this._bindBtnView, 'btn_view');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnBinding: Button | null = null;
    /**
     * 自动绑定节点 btn_binding 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnBinding(): Button {
        return this.requireBinding(this._bindBtnBinding, 'btn_binding');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnVerify: Button | null = null;
    /**
     * 自动绑定节点 btn_verify 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnVerify(): Button {
        return this.requireBinding(this._bindBtnVerify, 'btn_verify');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnWorkflow: Button | null = null;
    /**
     * 自动绑定节点 btn_workflow 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnWorkflow(): Button {
        return this.requireBinding(this._bindBtnWorkflow, 'btn_workflow');
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
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Node, visible: false })
    private _bindNodePreview: Node | null = null;
    /**
     * 自动绑定节点 node_preview 的 Node；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get nodePreview(): Node {
        return this.requireBinding(this._bindNodePreview, 'node_preview');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Sprite, visible: false })
    private _bindSprPreview: Sprite | null = null;
    /**
     * 自动绑定节点 spr_preview 的 Sprite；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get sprPreview(): Sprite {
        return this.requireBinding(this._bindSprPreview, 'spr_preview');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.btnBack;
        void this.nodeContent;
        void this.btnStructure;
        void this.btnConfig;
        void this.btnService;
        void this.btnPresenter;
        void this.btnView;
        void this.btnBinding;
        void this.btnVerify;
        void this.btnWorkflow;
        void this.lblOutput;
        void this.nodePreview;
        void this.sprPreview;
    }
}
