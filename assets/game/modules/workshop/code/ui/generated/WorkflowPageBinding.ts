// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Button, Node, Label, Sprite } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { WorkflowPageParams, WorkflowPageResult } from '../WorkflowPage.types';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('workshop.WorkflowPageBinding')
export class WorkflowPageBinding extends UIView<WorkflowPageParams, WorkflowPageResult> {
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
    @property({ type: Node, visible: false })
    private _bindNodeItems: Node | null = null;
    /**
     * 自动绑定节点 node_items 的 Node；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get nodeItems(): Node {
        return this.requireBinding(this._bindNodeItems, 'node_items');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnTrain: Button | null = null;
    /**
     * 自动绑定节点 btn_train 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnTrain(): Button {
        return this.requireBinding(this._bindBtnTrain, 'btn_train');
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
    private _bindBtnReload: Button | null = null;
    /**
     * 自动绑定节点 btn_reload 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnReload(): Button {
        return this.requireBinding(this._bindBtnReload, 'btn_reload');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnInspect: Button | null = null;
    /**
     * 自动绑定节点 btn_inspect 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnInspect(): Button {
        return this.requireBinding(this._bindBtnInspect, 'btn_inspect');
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
        void this.nodeItems;
        void this.btnTrain;
        void this.btnFailure;
        void this.btnReload;
        void this.btnInspect;
        void this.nodeBadge;
        void this.lblOutput;
        void this.nodePreview;
        void this.sprPreview;
    }
}
