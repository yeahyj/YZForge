// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Label, Button, Node, Sprite } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { ResourceLabPageParams, ResourceLabPageResult } from '../ResourceLabPage.types';

const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('showcase.ResourceLabPageBinding')
export class ResourceLabPageBinding extends UIView<ResourceLabPageParams, ResourceLabPageResult> {
    /** @internal 编辑器核对本次生成是否已编译，不用于业务逻辑。 */
    static readonly __yzforgeBindingSignature: string =
        'ea7fcdf478904949d8e6cd1ab319c0a8ed2caa5fe20923f29e8a5fd32c62a99f';
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
    @property({ type: Label, visible: false })
    private _bindLblInfo: Label | null = null;
    /**
     * 自动绑定节点 lbl_info 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblInfo(): Label {
        return this.requireBinding(this._bindLblInfo, 'lbl_info');
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
    @property({ type: Button, visible: false })
    private _bindBtnCancel: Button | null = null;
    /**
     * 自动绑定节点 btn_cancel 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnCancel(): Button {
        return this.requireBinding(this._bindBtnCancel, 'btn_cancel');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnWarm: Button | null = null;
    /**
     * 自动绑定节点 btn_warm 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnWarm(): Button {
        return this.requireBinding(this._bindBtnWarm, 'btn_warm');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnSpawn: Button | null = null;
    /**
     * 自动绑定节点 btn_spawn 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnSpawn(): Button {
        return this.requireBinding(this._bindBtnSpawn, 'btn_spawn');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnRelease: Button | null = null;
    /**
     * 自动绑定节点 btn_release 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnRelease(): Button {
        return this.requireBinding(this._bindBtnRelease, 'btn_release');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblPool: Label | null = null;
    /**
     * 自动绑定节点 lbl_pool 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblPool(): Label {
        return this.requireBinding(this._bindLblPool, 'lbl_pool');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Node, visible: false })
    private _bindNodePool: Node | null = null;
    /**
     * 自动绑定节点 node_pool 的 Node；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get nodePool(): Node {
        return this.requireBinding(this._bindNodePool, 'node_pool');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblOutput: Label | null = null;
    /**
     * 自动绑定节点 lbl_output 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblOutput(): Label {
        return this.requireBinding(this._bindLblOutput, 'lbl_output');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Sprite, visible: false })
    private _bindSprLogo: Sprite | null = null;
    /**
     * 自动绑定节点 spr_logo 的 Sprite；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get sprLogo(): Sprite {
        return this.requireBinding(this._bindSprLogo, 'spr_logo');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.lblTitle;
        void this.lblSubtitle;
        void this.btnBack;
        void this.nodeContent;
        void this.lblInfo;
        void this.btnLanguage;
        void this.btnLoad;
        void this.btnCancel;
        void this.btnWarm;
        void this.btnSpawn;
        void this.btnRelease;
        void this.lblPool;
        void this.nodePool;
        void this.lblOutput;
        void this.sprLogo;
    }
}
