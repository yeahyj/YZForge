import { _decorator, Color, Component, Graphics, UITransform } from 'cc';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;
/** Small renderer adapter: Graphics drawing commands are not serialized by Creator. */
@ccclass('yzforge.PanelBackground')
@executeInEditMode(true)
@requireComponent(Graphics)
export class PanelBackground extends Component {
  @property(Color) color = new Color(26, 41, 64, 255);
  @property radius = 20;
  onEnable(): void { this.node.on(NodeSizeChanged, this.draw, this); this.draw(); }
  onDisable(): void { this.node.off(NodeSizeChanged, this.draw, this); }
  protected onRestore(): void { this.draw(); }
  private draw(): void {
    const transform = this.getComponent(UITransform), graphics = this.getComponent(Graphics);
    if (!transform || !graphics) return;
    const { width, height } = transform.contentSize;
    graphics.clear(); graphics.fillColor = this.color;
    graphics.roundRect(-width * transform.anchorX, -height * transform.anchorY, width, height, Math.max(0, Math.min(this.radius, width / 2, height / 2)));
    graphics.fill();
  }
}
const NodeSizeChanged = 'size-changed';
