// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Label, Button, Node, Sprite } from 'cc';
import { UIView } from '../../../../../../../framework/ui/ui-view';
import type { LocalizationLabPageParams, LocalizationLabPageResult } from '../LocalizationLabPage.types';

const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('showcase.LocalizationLabPageBinding')
export class LocalizationLabPageBinding extends UIView<LocalizationLabPageParams, LocalizationLabPageResult> {
    /** @internal 编辑器核对本次生成是否已编译，不用于业务逻辑。 */
    static readonly __yzforgeBindingSignature: string =
        'a2fd8aa6cf78943539547824dcb32e7577663c78e86be92bf433a5e6d36652ba';
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblTitle: Label | null = null;
    /**
     * 自动绑定节点 lbl_title 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblTitle(): Label {
        return this.requireBinding(this._bindLblTitle, 'lbl_title');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblSubtitle: Label | null = null;
    /**
     * 自动绑定节点 lbl_subtitle 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblSubtitle(): Label {
        return this.requireBinding(this._bindLblSubtitle, 'lbl_subtitle');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnBack: Button | null = null;
    /**
     * 自动绑定节点 btn_back 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnBack(): Button {
        return this.requireBinding(this._bindBtnBack, 'btn_back');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Node, visible: false })
    private _bindNodeContent: Node | null = null;
    /**
     * 自动绑定节点 node_content 的 Node；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get nodeContent(): Node {
        return this.requireBinding(this._bindNodeContent, 'node_content');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnLanguage: Button | null = null;
    /**
     * 自动绑定节点 btn_language 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnLanguage(): Button {
        return this.requireBinding(this._bindBtnLanguage, 'btn_language');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblDynamic: Label | null = null;
    /**
     * 自动绑定节点 lbl_dynamic 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblDynamic(): Label {
        return this.requireBinding(this._bindLblDynamic, 'lbl_dynamic');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnIncrement: Button | null = null;
    /**
     * 自动绑定节点 btn_increment 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnIncrement(): Button {
        return this.requireBinding(this._bindBtnIncrement, 'btn_increment');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Sprite, visible: false })
    private _bindSprDynamic: Sprite | null = null;
    /**
     * 自动绑定节点 spr_dynamic 的 Sprite；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get sprDynamic(): Sprite {
        return this.requireBinding(this._bindSprDynamic, 'spr_dynamic');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnLoad: Button | null = null;
    /**
     * 自动绑定节点 btn_load 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnLoad(): Button {
        return this.requireBinding(this._bindBtnLoad, 'btn_load');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblStatus: Label | null = null;
    /**
     * 自动绑定节点 lbl_status 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblStatus(): Label {
        return this.requireBinding(this._bindLblStatus, 'lbl_status');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.lblTitle;
        void this.lblSubtitle;
        void this.btnBack;
        void this.nodeContent;
        void this.btnLanguage;
        void this.lblDynamic;
        void this.btnIncrement;
        void this.sprDynamic;
        void this.btnLoad;
        void this.lblStatus;
    }
}
