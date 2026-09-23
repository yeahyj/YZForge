import { _decorator, Color, Component, Font, isValid, Label, Mask, Node, UITransform } from 'cc';
import { EDITOR } from 'cc/env';
import { marqueeOffset } from './marquee-motion';
const { ccclass, property, menu, requireComponent, disallowMultiple, executeInEditMode } = _decorator;

/**
 * 固定宽度的单行滚动文本。挂在空 UI 节点上，UITransform 的宽高就是可见区域。
 * 自动维护 Mask 与文本子节点；短文字静止，超宽文字首尾停留并往返滚动。
 * Mask 与 Label 不能在同一节点渲染，因此此组件采用容器组合，倒计时则直接继承 Label。
 */
@ccclass('yzforge.MarqueeLabel')
@menu('YZForge/UI/超宽滚动文本')
@requireComponent([UITransform, Mask])
@disallowMultiple
@executeInEditMode
export class MarqueeLabel extends Component {
    /** 显示内容，换行按空格处理；直接赋值后下一帧重算宽度并从开头滚动。 */
    @property({ multiline: true, displayName: '文本' }) string = '';
    /** 使用的字体，留空使用系统字体。 */
    @property({ type: Font, displayName: '字体' }) font: Font | null = null;
    /** 系统字体名称，仅未指定字体资源时使用。 */
    @property({ displayName: '系统字体' }) fontFamily = 'Arial';
    /** 文字字号，单位为设计像素。 */
    @property({ displayName: '字号', min: 1 }) fontSize = 24;
    /** 文本行高，应不超过容器可见高度。 */
    @property({ displayName: '行高', min: 1 }) lineHeight = 32;
    /** 文字颜色与透明度。 */
    @property({ displayName: '颜色' }) color = new Color(255, 255, 255, 255);
    /** 是否加粗。 */
    @property({ displayName: '粗体' }) isBold = false;
    /** 每秒滚动的设计像素；0 表示固定在开头。 */
    @property({ displayName: '滚动速度', min: 0 }) speed = 40;
    /** 开头和末尾各停留的秒数。 */
    @property({ displayName: '首尾停留（秒）', min: 0 }) pauseDuration = 1;
    /** 启用时是否自动播放；编辑器只显示开头，不播放动画。 */
    @property({ displayName: '自动播放' }) autoPlay = true;
    @property({ type: Label, visible: false }) private textLabel: Label | null = null;
    private elapsed = 0;
    private playing = false;
    private distance = 0;
    private viewportWidth = -1;
    private textWidth = -1;

    /** 当前是否正在播放超宽文字；首尾停留期间也返回 true。 */
    get isScrolling(): boolean {
        return this.playing && this.enabledInHierarchy && this.distance > 0 && this.speed > 0;
    }
    /** 继续播放；短文字不会产生位移。 */
    play(): void {
        this.playing = true;
    }
    /** Inspector 按钮事件入口，自定义事件数据就是新文本。 */
    setTextFromEvent(_event: unknown, text: string): void {
        this.string = text;
        this.restart();
    }
    /** 停在当前位置。重新 play 从当前位置继续。 */
    pause(): void {
        this.playing = false;
    }
    /** 回到开头并重新播放，保留文本和布局配置。 */
    restart(): void {
        this.elapsed = 0;
        this.playing = true;
        this.refresh();
    }

    /**
     * 同步应用内容与样式并测量宽度；通常赋值后自动在下一帧更新即可。
     * 不改变根节点的位置、宽高和 Widget，不干扰外部布局。
     */
    refresh(): void {
        const label = this.ensureLabel();
        const text = this.string.replace(/[\r\n]+/g, ' ');
        let changed =
            label.string !== text ||
            label.font !== this.font ||
            label.fontFamily !== this.fontFamily ||
            label.fontSize !== this.fontSize ||
            label.lineHeight !== this.lineHeight ||
            label.isBold !== this.isBold;
        label.string = text;
        if (label.font !== this.font) label.font = this.font;
        if (label.useSystemFont !== !this.font) label.useSystemFont = !this.font;
        label.fontFamily = this.fontFamily;
        label.fontSize = this.fontSize;
        label.lineHeight = this.lineHeight;
        label.isBold = this.isBold;
        if (!label.color.equals(this.color)) label.color = this.color;
        if (changed || this.textWidth < 0) label.updateRenderData(true);
        const view = this.getComponent(UITransform)!,
            content = label.getComponent(UITransform)!;
        changed ||= this.viewportWidth !== view.width || this.textWidth !== content.width;
        this.viewportWidth = view.width;
        this.textWidth = content.width;
        this.distance = Math.max(0, content.width - Math.max(0, view.width));
        if (changed) this.elapsed = 0;
        label.node.layer = this.node.layer;
        label.node.setPosition(
            -view.anchorX * view.width + marqueeOffset(this.elapsed, this.distance, this.speed, this.pauseDuration),
            (0.5 - view.anchorY) * view.height,
            0,
        );
    }

    private ensureLabel(): Label {
        if (!isValid(this.textLabel, true)) {
            const text = new Node('MarqueeText');
            text.layer = this.node.layer;
            const transform = text.addComponent(UITransform);
            transform.setAnchorPoint(0, 0.5);
            this.node.addChild(text);
            this.textLabel = text.addComponent(Label);
            this.textLabel.overflow = Label.Overflow.NONE;
            this.textLabel.enableWrapText = false;
            this.textLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.textLabel.verticalAlign = Label.VerticalAlign.CENTER;
        }
        return this.textLabel!;
    }

    /** @internal 不启动定时器，禁用后引擎自然停止帧更新。 */
    protected onEnable(): void {
        this.playing = this.autoPlay;
        this.elapsed = 0;
        this.ensureLabel().node.active = true;
        this.refresh();
    }
    /** @internal 编辑器只更新内容和布局；运行时按帧推进。 */
    protected update(dt: number): void {
        if (!EDITOR && this.playing && this.distance > 0) this.elapsed += dt;
        this.refresh();
    }
    /** @internal 单独禁用组件也隐藏其拥有的文字。 */
    protected onDisable(): void {
        if (isValid(this.textLabel, true)) this.textLabel!.node.active = false;
    }
    /** @internal 移除组件时清理自己创建的文字，不删除外部节点。 */
    protected onDestroy(): void {
        if (isValid(this.textLabel, true)) this.textLabel!.node.destroy();
        this.textLabel = null;
    }
}
