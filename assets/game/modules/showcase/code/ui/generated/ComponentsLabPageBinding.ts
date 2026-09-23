// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Component, Button, Label, ScrollView, Sprite, Node } from 'cc';
import { UIView } from '../../../../../../framework/ui/ui-view';
import type { ComponentsLabPageParams, ComponentsLabPageResult } from '../ComponentsLabPage.types';
import type { SafeWidget } from '../../../../../../framework/ui/components/safe-widget/safe-widget';
import type { AsyncButton } from '../../../../../../framework/ui/components/async-button/async-button';
import type { AsyncSprite } from '../../../../../../framework/ui/components/async-sprite/async-sprite';
import type { Switch } from '../../../../../../framework/ui/components/switch/switch';
import type { CountdownLabel } from '../../../../../../framework/ui/components/countdown/countdown-label';
import type { MarqueeLabel } from '../../../../../../framework/ui/components/marquee/marquee-label';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('showcase.ComponentsLabPageBinding')
export class ComponentsLabPageBinding extends UIView<ComponentsLabPageParams, ComponentsLabPageResult> {
    /** @internal 编辑器核对本次生成是否已编译，不用于业务逻辑。 */
    static readonly __yzforgeBindingSignature: string =
        '99423365e0b86ef198eb63d8657a5419fff82f43fcdda86059392c635853d904';
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Component, visible: false })
    private _bindCompSafe: SafeWidget | null = null;
    /**
     * 自动绑定节点 comp_safe 的 SafeWidget；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get compSafe(): SafeWidget {
        return this.requireBinding(this._bindCompSafe, 'comp_safe');
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
    @property({ type: Label, visible: false })
    private _bindLblSafe: Label | null = null;
    /**
     * 自动绑定节点 lbl_safe 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblSafe(): Label {
        return this.requireBinding(this._bindLblSafe, 'lbl_safe');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnSafe: Button | null = null;
    /**
     * 自动绑定节点 btn_safe 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnSafe(): Button {
        return this.requireBinding(this._bindBtnSafe, 'btn_safe');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: ScrollView, visible: false })
    private _bindScrollExamples: ScrollView | null = null;
    /**
     * 自动绑定节点 scroll_examples 的 ScrollView；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get scrollExamples(): ScrollView {
        return this.requireBinding(this._bindScrollExamples, 'scroll_examples');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnSubmit: AsyncButton | null = null;
    /**
     * 自动绑定节点 btn_submit 的 AsyncButton；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnSubmit(): AsyncButton {
        return this.requireBinding(this._bindBtnSubmit, 'btn_submit');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblSubmit: Label | null = null;
    /**
     * 自动绑定节点 lbl_submit 的 Label；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblSubmit(): Label {
        return this.requireBinding(this._bindLblSubmit, 'lbl_submit');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Sprite, visible: false })
    private _bindSprPreview: AsyncSprite | null = null;
    /**
     * 自动绑定节点 spr_preview 的 AsyncSprite；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get sprPreview(): AsyncSprite {
        return this.requireBinding(this._bindSprPreview, 'spr_preview');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnAlpha: Button | null = null;
    /**
     * 自动绑定节点 btn_alpha 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnAlpha(): Button {
        return this.requireBinding(this._bindBtnAlpha, 'btn_alpha');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnBeta: Button | null = null;
    /**
     * 自动绑定节点 btn_beta 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnBeta(): Button {
        return this.requireBinding(this._bindBtnBeta, 'btn_beta');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Component, visible: false })
    private _bindCompState: Switch | null = null;
    /**
     * 自动绑定节点 comp_state 的 Switch；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get compState(): Switch {
        return this.requireBinding(this._bindCompState, 'comp_state');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnLoading: Button | null = null;
    /**
     * 自动绑定节点 btn_loading 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnLoading(): Button {
        return this.requireBinding(this._bindBtnLoading, 'btn_loading');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnContent: Button | null = null;
    /**
     * 自动绑定节点 btn_content 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnContent(): Button {
        return this.requireBinding(this._bindBtnContent, 'btn_content');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnReload: Button | null = null;
    /**
     * 自动绑定节点 btn_reload 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnReload(): Button {
        return this.requireBinding(this._bindBtnReload, 'btn_reload');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnError: Button | null = null;
    /**
     * 自动绑定节点 btn_error 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnError(): Button {
        return this.requireBinding(this._bindBtnError, 'btn_error');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblCountdown: CountdownLabel | null = null;
    /**
     * 自动绑定节点 lbl_countdown 的 CountdownLabel；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get lblCountdown(): CountdownLabel {
        return this.requireBinding(this._bindLblCountdown, 'lbl_countdown');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnRestart: Button | null = null;
    /**
     * 自动绑定节点 btn_restart 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnRestart(): Button {
        return this.requireBinding(this._bindBtnRestart, 'btn_restart');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Node, visible: false })
    private _bindNodeTextControls: Node | null = null;
    /**
     * 自动绑定节点 node_text_controls 的 Node；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get nodeTextControls(): Node {
        return this.requireBinding(this._bindNodeTextControls, 'node_text_controls');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnLongText: Button | null = null;
    /**
     * 自动绑定节点 btn_long_text 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnLongText(): Button {
        return this.requireBinding(this._bindBtnLongText, 'btn_long_text');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnShortText: Button | null = null;
    /**
     * 自动绑定节点 btn_short_text 的 Button；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get btnShortText(): Button {
        return this.requireBinding(this._bindBtnShortText, 'btn_short_text');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Component, visible: false })
    private _bindCompMarquee: MarqueeLabel | null = null;
    /**
     * 自动绑定节点 comp_marquee 的 MarqueeLabel；节点改名、替换组件后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
     */
    protected get compMarquee(): MarqueeLabel {
        return this.requireBinding(this._bindCompMarquee, 'comp_marquee');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.compSafe;
        void this.btnBack;
        void this.lblSafe;
        void this.btnSafe;
        void this.scrollExamples;
        void this.btnSubmit;
        void this.lblSubmit;
        void this.sprPreview;
        void this.btnAlpha;
        void this.btnBeta;
        void this.compState;
        void this.btnLoading;
        void this.btnContent;
        void this.btnReload;
        void this.btnError;
        void this.lblCountdown;
        void this.btnRestart;
        void this.nodeTextControls;
        void this.btnLongText;
        void this.btnShortText;
        void this.compMarquee;
    }
}
