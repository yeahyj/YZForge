import {
    _decorator,
    BitMask,
    Camera,
    Canvas,
    Component,
    Enum,
    game,
    Game,
    isValid,
    Node,
    screen,
    sys,
    UITransform,
    Vec3,
    view,
    Widget,
} from 'cc';
import { PREVIEW } from 'cc/env';
import { invariant, reportError } from '../../../core/errors';
import {
    SafeEdge,
    SafeSymmetry,
    safeWidgetOffsets,
    symmetricSafeRect,
    type SafeInsets,
    type SafeRect,
} from './safe-widget-layout';
const { ccclass, property, requireComponent, disallowMultiple, executionOrder, menu } = _decorator;
const EdgeMask = BitMask({ 上: SafeEdge.Top, 下: SafeEdge.Bottom, 左: SafeEdge.Left, 右: SafeEdge.Right });
const SymmetryOptions = Enum({
    真实边距: SafeSymmetry.None,
    横屏左右对称: SafeSymmetry.LandscapeSides,
    上下左右对称: SafeSymmetry.BothAxes,
});
const sides = ['top', 'bottom', 'left', 'right'] as const;

/**
 * 按边避让的 Widget 增强：保留基础边距，支持百分比、缩放及嵌套安全区，不重复加全屏边距。
 * 限同一正交 Canvas 下的轴对齐固定布局；动画放在子节点。启用期间使用 setBaseOffsets 修改边距。
 * 不与同节点的 SafeArea/其他边距驱动器叠用；全屏背景不应挂本组件。
 */
@ccclass('yzforge.SafeWidget')
@menu('YZForge/UI/安全区布局')
@requireComponent([Widget, UITransform])
@executionOrder(120)
@disallowMultiple
export class SafeWidget extends Component {
    /** 要处理的对齐边，只有 Widget 同时启用该边时才补偿。 */
    @property({ type: EdgeMask, displayName: '避让边' }) edges: number = SafeEdge.All;
    /** 默认不对称，保留设备真实上/下/左/右安全距离。 */
    @property({ type: SymmetryOptions, displayName: '对称策略' }) symmetry = SafeSymmetry.None;
    /** 仅 Creator 预览使用的显式模拟开关，正式构建忽略。 */
    @property({ displayName: '预览模拟安全区' }) simulate = false;
    /** 模拟上边距，单位为视图设计坐标。 */ @property({ min: 0, displayName: '模拟上边距' }) previewTop = 0;
    /** 模拟下边距，单位同上。 */ @property({ min: 0, displayName: '模拟下边距' }) previewBottom = 0;
    /** 模拟左边距，单位同上。 */ @property({ min: 0, displayName: '模拟左边距' }) previewLeft = 0;
    /** 模拟右边距，单位同上。 */ @property({ min: 0, displayName: '模拟右边距' }) previewRight = 0;
    private base?: SafeInsets;
    private dirty = true;
    private readonly globalOff: (() => void)[] = [];
    private readonly referenceOff: (() => void)[] = [];
    private readonly mark = () => {
        this.dirty = true;
    };

    /** @internal 记录原始边距，并监听窗口、方向、设计分辨率和前台恢复。 */
    onEnable(): void {
        const widget = this.getComponent(Widget)!;
        this.base = { top: widget.top, bottom: widget.bottom, left: widget.left, right: widget.right };
        const listen = (target: typeof view | typeof game, event: string) => {
            target.on(event, this.mark, this);
            this.globalOff.push(() => target.off(event, this.mark, this));
        };
        listen(view, 'design-resolution-changed');
        listen(view, 'canvas-resize');
        screen.on('window-resize', this.mark, this);
        screen.on('orientation-change', this.mark, this);
        this.globalOff.push(
            () => screen.off('window-resize', this.mark, this),
            () => screen.off('orientation-change', this.mark, this),
        );
        listen(game, Game.EVENT_SHOW);
        this.node.on(Node.EventType.PARENT_CHANGED, this.mark, this);
        this.globalOff.push(() => this.node.off(Node.EventType.PARENT_CHANGED, this.mark, this));
        this.tryRefresh();
    }
    /** 修改基础边距并立即重算；数值单位跟随 Widget 各边的绝对/百分比选项。 */
    setBaseOffsets(values: Partial<SafeInsets>): void {
        invariant(this.base && this.enabledInHierarchy, 'SAFE_WIDGET_DISABLED', '须先启用安全区组件');
        const candidate = { ...this.base, ...values };
        invariant(
            sides.every((side) => Number.isFinite(candidate[side])),
            'SAFE_WIDGET_OFFSETS',
            '基础边距须为有限数值',
        );
        this.base = candidate;
        this.refresh();
    }
    /**
     * 立即重新读取安全区及坐标；重复调用不累加。更改边选择、对称策略或预览参数后调用。
     * 不支持旋转/透视相机、跨 Canvas target 或处于安全区之外的参考节点，明确抛 SAFE_WIDGET_*。
     */
    refresh(): void {
        invariant(this.base && this.enabledInHierarchy, 'SAFE_WIDGET_DISABLED', '须先启用安全区组件');
        invariant(
            Number.isInteger(this.edges) && this.edges >= 0 && this.edges <= SafeEdge.All,
            'SAFE_WIDGET_OFFSETS',
            '边选择须为 SafeEdge 的组合',
        );
        const widget = this.getComponent(Widget)!,
            reference = widget.target ?? this.node.parent;
        invariant(
            widget.enabled &&
                reference &&
                reference !== this.node &&
                this.node.isChildOf(reference) &&
                !this.getComponent('cc.SafeArea'),
            'SAFE_WIDGET_SETUP',
            '需要已启用的 Widget、祖先参考节点，且同节点不能有 SafeArea',
        );
        const transform = reference.getComponent(UITransform);
        let canvas: Canvas | null = null;
        for (let node: Node | null = this.node; node && !canvas; node = node.parent) canvas = node.getComponent(Canvas);
        const camera = canvas?.cameraComponent;
        invariant(
            transform &&
                canvas &&
                camera?.camera &&
                camera.projection === Camera.ProjectionType.ORTHO &&
                (reference === canvas.node || reference.isChildOf(canvas.node)),
            'SAFE_WIDGET_SETUP',
            '参考节点须处于同一正交 Canvas 内',
        );
        for (const node of [reference, camera.node]) {
            const m = node.worldMatrix;
            invariant(
                m.m00 > 0 &&
                    m.m05 > 0 &&
                    [m.m01, m.m04, m.m02, m.m06, m.m08, m.m09].every((n) => Math.abs(n) < 0.00001),
                'SAFE_WIDGET_TRANSFORM',
                '参考区域和相机须轴对齐且使用正缩放',
            );
        }
        const viewport = view.getViewportRect(),
            scaleX = view.getScaleX(),
            scaleY = view.getScaleY(),
            size = screen.windowSize;
        const full = {
            left: -viewport.x / scaleX,
            bottom: -viewport.y / scaleY,
            right: (size.width - viewport.x) / scaleX,
            top: (size.height - viewport.y) / scaleY,
        };
        const native = sys.getSafeAreaRect(false);
        let safe: SafeRect = {
            left: native.x,
            bottom: native.y,
            right: native.x + native.width,
            top: native.y + native.height,
        };
        if (PREVIEW && this.simulate) {
            invariant(
                [this.previewTop, this.previewBottom, this.previewLeft, this.previewRight].every(
                    (n) => Number.isFinite(n) && n >= 0,
                ),
                'SAFE_WIDGET_PREVIEW',
                '模拟边距须为非负有限数值',
            );
            safe = {
                left: full.left + this.previewLeft,
                right: full.right - this.previewRight,
                bottom: full.bottom + this.previewBottom,
                top: full.top - this.previewTop,
            };
        }
        safe = symmetricSafeRect(full, safe, this.symmetry);
        const convert = (x: number, y: number) =>
            transform.convertToNodeSpaceAR(
                camera.screenToWorld(new Vec3(x * scaleX + viewport.x, y * scaleY + viewport.y, 0)),
            );
        const a = convert(safe.left, safe.bottom),
            b = convert(safe.right, safe.top);
        const localSafe = {
            left: Math.min(a.x, b.x),
            right: Math.max(a.x, b.x),
            bottom: Math.min(a.y, b.y),
            top: Math.max(a.y, b.y),
        };
        const bounds = {
            left: -transform.anchorX * transform.width,
            right: (1 - transform.anchorX) * transform.width,
            bottom: -transform.anchorY * transform.height,
            top: (1 - transform.anchorY) * transform.height,
        };
        const aligned =
            (widget.isAlignTop ? SafeEdge.Top : 0) |
            (widget.isAlignBottom ? SafeEdge.Bottom : 0) |
            (widget.isAlignLeft ? SafeEdge.Left : 0) |
            (widget.isAlignRight ? SafeEdge.Right : 0);
        const offsets = safeWidgetOffsets(
            bounds,
            localSafe,
            this.base,
            {
                top: widget.isAbsoluteTop,
                bottom: widget.isAbsoluteBottom,
                left: widget.isAbsoluteLeft,
                right: widget.isAbsoluteRight,
            },
            this.edges & aligned,
        );
        sides.forEach((side) => {
            widget[side] = offsets[side];
        });
        widget.updateAlignment();
        this.referenceOff.splice(0).forEach((off) => off());
        for (let node: Node | null = reference; node; node = node.parent) {
            const held = node;
            for (const event of [
                Node.EventType.SIZE_CHANGED,
                Node.EventType.ANCHOR_CHANGED,
                Node.EventType.TRANSFORM_CHANGED,
                Node.EventType.PARENT_CHANGED,
            ]) {
                held.on(event, this.mark, this);
                this.referenceOff.push(() => {
                    if (isValid(held)) held.off(event, this.mark, this);
                });
            }
        }
        this.dirty = false;
    }
    private tryRefresh(): void {
        try {
            this.refresh();
        } catch (error) {
            reportError(error);
            this.enabled = false;
        }
    }
    /** @internal 合并一帧内的布局变化，不逐帧查询原生安全区。 */
    lateUpdate(): void {
        if (this.dirty) this.tryRefresh();
    }
    /** @internal 解除监听并恢复基础边距；再次启用重新获取当前布局。 */
    onDisable(): void {
        this.globalOff.splice(0).forEach((off) => off());
        this.referenceOff.splice(0).forEach((off) => off());
        const widget = this.getComponent(Widget);
        if (this.base && isValid(widget, true)) {
            const base = this.base;
            sides.forEach((side) => {
                widget![side] = base[side];
            });
            widget!.updateAlignment();
        }
        this.base = undefined;
    }
    /** @internal 销毁再次确保解绑。 */
    onDestroy(): void {
        this.onDisable();
    }
}
