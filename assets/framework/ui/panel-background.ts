import { _decorator, Color, Component, Graphics, UITransform } from 'cc';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;
/**
 * 框架提供的简单面板背景渲染适配器，在编辑器及运行时根据节点尺寸重画圆角矩形。
 * Graphics 绘制命令不序列化，因此需要此引擎适配组件；普通业务逻辑仍使用 GameComponent/UIView。
 */
@ccclass('yzforge.PanelBackground')
@executeInEditMode(true)
@requireComponent(Graphics)
export class PanelBackground extends Component {
    /**
     * 背景填充色，RGBA 每通道 0～255；在 Creator 属性检查器配置。
     */
    @property(Color) color = new Color(26, 41, 64, 255);
    /**
     * 圆角半径，单位为节点 UI 坐标；默认 20，绘制时限制在 0 到短边的一半。
     */
    @property radius = 20;
    /**
     * @internal
     * 引擎启用适配入口：监听尺寸变化并绘制一次，业务不重写。
     */
    onEnable(): void {
        this.node.on(NodeSizeChanged, this.draw, this);
        this.draw();
    }
    /**
     * @internal
     * 引擎停用适配入口：解除尺寸监听，业务不重写。
     */
    onDisable(): void {
        this.node.off(NodeSizeChanged, this.draw, this);
    }
    /**
     * @internal
     * 编辑器恢复序列化属性后重画背景。
     */
    protected onRestore(): void {
        this.draw();
    }
    private draw(): void {
        const transform = this.getComponent(UITransform),
            graphics = this.getComponent(Graphics);
        if (!transform || !graphics) return;
        const { width, height } = transform.contentSize;
        graphics.clear();
        graphics.fillColor = this.color;
        graphics.roundRect(
            -width * transform.anchorX,
            -height * transform.anchorY,
            width,
            height,
            Math.max(0, Math.min(this.radius, width / 2, height / 2)),
        );
        graphics.fill();
    }
}
const NodeSizeChanged = 'size-changed';
