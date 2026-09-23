// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Button, Node, Label, Sprite } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { ShowcasePageParams, ShowcasePageResult } from '../ShowcasePage.types';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('showcase.ShowcasePageBinding')
export class ShowcasePageBinding extends UIView<ShowcasePageParams, ShowcasePageResult> {
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
    private _bindBtnWorkflow: Button | null = null;
    /**
     * 自动绑定节点 btn_workflow 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnWorkflow(): Button {
        return this.requireBinding(this._bindBtnWorkflow, 'btn_workflow');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Node, visible: false })
    private _bindNodeBadge: Node | null = null;
    /**
     * 自动绑定节点 node_badge 的 Node；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get nodeBadge(): Node {
        return this.requireBinding(this._bindNodeBadge, 'node_badge');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnUi: Button | null = null;
    /**
     * 自动绑定节点 btn_ui 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnUi(): Button {
        return this.requireBinding(this._bindBtnUi, 'btn_ui');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnData: Button | null = null;
    /**
     * 自动绑定节点 btn_data 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnData(): Button {
        return this.requireBinding(this._bindBtnData, 'btn_data');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnTime: Button | null = null;
    /**
     * 自动绑定节点 btn_time 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnTime(): Button {
        return this.requireBinding(this._bindBtnTime, 'btn_time');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnAsync: Button | null = null;
    /**
     * 自动绑定节点 btn_async 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnAsync(): Button {
        return this.requireBinding(this._bindBtnAsync, 'btn_async');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnStorage: Button | null = null;
    /**
     * 自动绑定节点 btn_storage 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnStorage(): Button {
        return this.requireBinding(this._bindBtnStorage, 'btn_storage');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnGuide: Button | null = null;
    /**
     * 自动绑定节点 btn_guide 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnGuide(): Button {
        return this.requireBinding(this._bindBtnGuide, 'btn_guide');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnLegacy: Button | null = null;
    /**
     * 自动绑定节点 btn_legacy 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnLegacy(): Button {
        return this.requireBinding(this._bindBtnLegacy, 'btn_legacy');
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
        void this.btnWorkflow;
        void this.nodeBadge;
        void this.btnUi;
        void this.btnData;
        void this.btnTime;
        void this.btnAsync;
        void this.btnStorage;
        void this.btnGuide;
        void this.btnLegacy;
        void this.lblOutput;
        void this.nodePreview;
        void this.sprPreview;
    }
}
