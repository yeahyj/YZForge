import {
    _decorator,
    BlockInputEvents,
    Button,
    Camera,
    Canvas,
    Color,
    Component,
    Graphics,
    isValid,
    Label,
    Mask,
    Node,
    UITransform,
    Vec3,
    Widget,
} from 'cc';
import type { GuideTarget } from '../../../guide/guide-targets';
import type { Lifetime } from '../../../core/scope';
import { FrameworkError, invariant, OperationCancelled } from '../../../core/errors';
import {
    focusFrame,
    focusGeometry,
    insideFocus,
    intersectFocusRect,
    type FocusFrame,
    type FocusGeometry,
    type FocusRect,
    type FocusShape,
} from './guide-focus';
const { ccclass, property, requireComponent } = _decorator;

/** 单步聚焦配置；跨步复用同一个 GuideFocusSession，镂空不会重新从全屏开始。 */
export interface GuideFocusOptions {
    /** 引导提示文本；长文案应由业务分步展示。 */ readonly message: string;
    /** 动画秒数，默认 0.55，0 表示立即聚焦。 */ readonly duration?: number;
    /** 镂空形状，默认圆角矩形。圆形使用目标可见矩形的外接圆。 */ readonly shape?: FocusShape;
    /** 高亮框向外扩展的 UI 单位，默认 8。 */ readonly padding?: number;
    /** 圆角矩形的圆角半径，默认 12；其他形状忽略。 */ readonly radius?: number;
}
/** 一次完整引导的视觉使用期，通常在 GuideHandle.result 的 finally 中关闭。 */
export interface GuideFocusSession {
    /**
     * 平滑聚焦并等待目标 Button 的真实 CLICK，不重新派发业务点击。
     * owner 必须是当前步骤的 Scope；取消或目标复用会移除本步监听并拒绝 Promise。
     * 完成后保留上一帧遮罩，锁住底层输入，直至下一步调用或 close。
     * 点击不等于异步业务成功，步骤仍须等待业务自己的完成条件。
     */
    waitForClick(target: GuideTarget<Node>, options: GuideFocusOptions, owner: Lifetime): Promise<void>;
    /** 幂等关闭：隐藏整套视觉、解除输入代理、取消当前等待并移除全部监听。 */
    close(): void;
}
interface FocusStep {
    target: GuideTarget<Node>;
    options: GuideFocusOptions;
    from?: FocusFrame;
    elapsed: number;
    focused: boolean;
    finish: (error?: unknown) => void;
}
interface FocusSessionState {
    step?: FocusStep;
    frame?: FocusFrame;
    close: (error?: unknown) => void;
}
/**
 * 连续聚焦遮罩：首次灰色渐入并收拢，后续从当前镂空平移、缩放和变形，不插入白屏或空帧。
 * 在业务预制体中配置反向 Graphics Mask、灰色子 Graphics、描边、输入层、提示与跳过按钮。
 * visual、mask、shade、outline 的本地变换须为恒等变换；输入层是 visual 的直接子节点。
 * 与目标须处于同一正交 Canvas；旋转目标、非矩形祖先 Mask、其他页面覆盖由业务避免。
 */
@ccclass('yzforge.GuideFocusOverlay')
@requireComponent(UITransform)
@requireComponent(Widget)
export class GuideFocusOverlay extends Component {
    /** 整套视觉子树，组件空闲时隐藏，须是本节点的直接子节点。 */
    @property(Node) visual: Node | null = null;
    /** 反向 GRAPHICS_STENCIL Mask；使用其自带 Graphics 绘制镂空。 */
    @property(Mask) holeMask: Mask | null = null;
    /** Mask 的子节点上的 Graphics，覆盖真实相机视口。 */
    @property(Graphics) shade: Graphics | null = null;
    /** 全屏透明输入层，带 UITransform 和 BlockInputEvents，位于 Mask 与描边之后。 */
    @property(Node) inputShield: Node | null = null;
    /** 仅绘制白色轮廓，不填充白色，不带触摸监听。 */
    @property(Graphics) outline: Graphics | null = null;
    /** 显示本步骤的中文提示。 */
    @property(Label) messageLabel: Label | null = null;
    /** 可选跳过按钮，层级位于输入层之后。 */
    @property(Button) skipButton: Button | null = null;
    private alignedWidth = -1;
    private alignedHeight = -1;
    private session?: FocusSessionState;

    /**
     * 创建跨步骤的聚焦使用期；第一次 waitForClick 才显示，不会让已完成的引导闪现。
     * 同一组件只允许一个 session。owner 取消时同步关闭；提前结束时须手动 close。
     * @param owner 整次引导或页面的 Scope，不能使用单个步骤的 Scope。
     * @param onSkip 可选跳过回调，通常调用 GuideHandle.skip；省略时隐藏跳过按钮。
     */
    begin(owner: Lifetime, onSkip?: () => void): GuideFocusSession {
        owner.signal.throwIfAborted();
        invariant(!this.session, 'GUIDE_FOCUS_BUSY', '聚焦遮罩正在使用');
        invariant(
            this.enabledInHierarchy &&
                this.visual?.parent === this.node &&
                this.holeMask?.node.parent === this.visual &&
                this.shade?.node.parent === this.holeMask.node &&
                this.holeMask.type === Mask.Type.GRAPHICS_STENCIL &&
                this.holeMask.inverted &&
                this.outline?.node.parent === this.visual &&
                this.messageLabel &&
                this.inputShield?.parent === this.visual &&
                this.inputShield.getComponent(BlockInputEvents),
            'GUIDE_FOCUS_SETUP',
            '请配置反向 Graphics Mask、灰色填充、描边、输入层和提示',
        );
        const shield = this.inputShield!.getComponent(UITransform)!;
        invariant(shield, 'GUIDE_FOCUS_SETUP', '输入层缺少 UITransform');
        const unbind: (() => void)[] = [];
        const session: FocusSessionState = {
            close: (error = new OperationCancelled('聚焦使用期已结束')) => {
                if (this.session !== session) return;
                session.step?.finish(error);
                this.session = undefined;
                for (const off of unbind) off();
                if (isValid(this.visual, true)) this.visual!.active = false;
            },
        };
        this.session = session;
        const originalHitTest = shield.hitTest;
        // Cocos 的事件分发使用 UITransform.hitTest；只放行真实目标与镂空的交集，圆角外和留白都拦截。
        shield.hitTest = (point, windowId = 0) => {
            if (!originalHitTest.call(shield, point, windowId)) return false;
            const step = session.step;
            if (!step?.focused || !session.frame || !step.target.isCurrent()) return true;
            const local = this.node
                .getComponent(UITransform)!
                .convertToNodeSpaceAR(this.camera().screenToWorld(new Vec3(point.x, point.y, 0)));
            return !(
                insideFocus(session.frame.hole, local.x, local.y) &&
                step.target.value.getComponent(UITransform)!.hitTest(point, windowId)
            );
        };
        unbind.push(() => {
            if (isValid(shield, true)) shield.hitTest = originalHitTest;
        });
        const shieldWidget = this.inputShield!.getComponent(Widget);
        if (shieldWidget) {
            const enabled = shieldWidget.enabled;
            shieldWidget.enabled = false;
            unbind.push(() => {
                if (isValid(shieldWidget, true)) shieldWidget.enabled = enabled;
            });
        }
        if (this.skipButton) {
            this.skipButton.node.active = !!onSkip;
            const skipped = () => {
                try {
                    onSkip?.();
                } catch (error) {
                    session.close(error);
                }
            };
            this.skipButton.node.on(Button.EventType.CLICK, skipped);
            unbind.push(() => {
                if (isValid(this.skipButton, true)) this.skipButton!.node.off(Button.EventType.CLICK, skipped);
            });
        }
        unbind.push(owner.signal.onAbort((reason) => session.close(reason)));
        return {
            waitForClick: (target, options, stepOwner) => this.waitForClick(session, target, options, stepOwner),
            close: () => session.close(),
        };
    }
    /** @internal 使用 UI 帧时长更新形状，不创建跨步骤遗留的 Tween。 */
    update(dt: number): void {
        const step = this.session?.step;
        if (step) step.elapsed += Math.max(0, dt);
        this.draw();
    }
    /** @internal 禁用同步关闭，恢复节点的输入检测方法。 */
    onDisable(): void {
        this.session?.close(new OperationCancelled('聚焦遮罩已禁用'));
    }
    /** @internal 销毁时执行同一清理路径。 */
    onDestroy(): void {
        this.session?.close(new OperationCancelled('聚焦遮罩已销毁'));
    }

    private waitForClick(
        session: FocusSessionState,
        target: GuideTarget<Node>,
        options: GuideFocusOptions,
        owner: Lifetime,
    ): Promise<void> {
        owner.signal.throwIfAborted();
        invariant(this.session === session, 'GUIDE_FOCUS_CLOSED', '聚焦使用期已结束');
        invariant(!session.step, 'GUIDE_FOCUS_BUSY', '前一步仍在等待点击');
        for (const value of [options.duration ?? 0.55, options.padding ?? 8, options.radius ?? 12])
            invariant(
                Number.isFinite(value) && value >= 0,
                'GUIDE_FOCUS_OPTIONS',
                '动画时长、留白和圆角须为非负有限数',
            );
        invariant(
            ['circle', 'rect', 'rounded-rect'].includes(options.shape ?? 'rounded-rect'),
            'GUIDE_FOCUS_OPTIONS',
            '未知的镂空形状',
        );
        invariant(
            target.isCurrent() &&
                isValid(target.value, true) &&
                target.value.getComponent(Button) &&
                !target.value.isChildOf(this.node) &&
                target.value !== this.node,
            'GUIDE_TARGET_INVALID',
            '聚焦目标必须是遮罩外的有效 Button',
        );
        return new Promise<void>((resolve, reject) => {
            const node = target.value;
            const unbind: (() => void)[] = [];
            const step: FocusStep = {
                target,
                options: { ...options },
                from: session.frame,
                elapsed: 0,
                focused: false,
                finish: (error?: unknown) => {
                    if (session.step !== step) return;
                    session.step = undefined;
                    for (const off of unbind) off();
                    // 遮罩和上一帧形状保留到下一步；等待业务或滚动期间输入层仍覆盖全屏。
                    if (error !== undefined) reject(error);
                    else resolve();
                },
            };
            session.step = step;
            const clicked = () => {
                if (step.focused && target.isCurrent()) step.finish();
            };
            node.on(Button.EventType.CLICK, clicked);
            unbind.push(() => {
                if (isValid(node, true)) node.off(Button.EventType.CLICK, clicked);
            });
            unbind.push(owner.signal.onAbort((reason) => step.finish(reason)));
            unbind.push(
                target.scope.signal.onAbort(() =>
                    step.finish(new FrameworkError('GUIDE_TARGET_LOST', `目标已注销：${target.key}`)),
                ),
            );
            this.messageLabel!.string = options.message;
            this.visual!.active = true;
            this.inputShield!.active = true;
            this.draw();
        });
    }
    private rect(node: Node, root: UITransform): FocusRect {
        const transform = node.getComponent(UITransform);
        invariant(transform, 'GUIDE_TARGET_INVALID', '目标缺少 UITransform');
        const points = [
            [-transform.anchorX, -transform.anchorY],
            [1 - transform.anchorX, -transform.anchorY],
            [-transform.anchorX, 1 - transform.anchorY],
            [1 - transform.anchorX, 1 - transform.anchorY],
        ].map(([x, y]) =>
            root.convertToNodeSpaceAR(
                transform.convertToWorldSpaceAR(new Vec3(x * transform.width, y * transform.height, 0)),
            ),
        );
        return {
            left: Math.min(...points.map((p) => p.x)),
            right: Math.max(...points.map((p) => p.x)),
            bottom: Math.min(...points.map((p) => p.y)),
            top: Math.max(...points.map((p) => p.y)),
        };
    }
    private camera(): Camera {
        let canvas: Canvas | null = null;
        for (let node: Node | null = this.node; node && !canvas; node = node.parent) canvas = node.getComponent(Canvas);
        const camera = canvas?.cameraComponent;
        invariant(
            camera?.camera && camera.projection === Camera.ProjectionType.ORTHO,
            'GUIDE_FOCUS_CAMERA',
            '聚焦遮罩需要同一 Canvas 的正交 UI 相机',
        );
        return camera;
    }
    private viewport(root: UITransform): FocusRect {
        const camera = this.camera(),
            window = camera.camera.window,
            viewport = camera.rect;
        const a = root.convertToNodeSpaceAR(
            camera.screenToWorld(new Vec3(viewport.x * window.width, viewport.y * window.height, 0)),
        );
        const b = root.convertToNodeSpaceAR(
            camera.screenToWorld(
                new Vec3(
                    (viewport.x + viewport.width) * window.width,
                    (viewport.y + viewport.height) * window.height,
                    0,
                ),
            ),
        );
        return {
            left: Math.min(a.x, b.x),
            bottom: Math.min(a.y, b.y),
            right: Math.max(a.x, b.x),
            top: Math.max(a.y, b.y),
        };
    }
    private path(graphics: Graphics, hole: FocusGeometry): void {
        const { rect, radius } = hole;
        const width = rect.right - rect.left,
            height = rect.top - rect.bottom;
        if (Math.abs(width - height) < 0.0001 && Math.abs(radius * 2 - width) < 0.0001)
            graphics.circle((rect.left + rect.right) / 2, (rect.bottom + rect.top) / 2, radius);
        else if (radius) graphics.roundRect(rect.left, rect.bottom, width, height, radius);
        else graphics.rect(rect.left, rect.bottom, rect.right - rect.left, rect.top - rect.bottom);
    }
    private draw(): void {
        const session = this.session;
        if (!session || (!session.step && !session.frame)) return;
        try {
            const root = this.node.getComponent(UITransform)!;
            this.node.getComponent(Widget)?.updateAlignment();
            if (root.width !== this.alignedWidth || root.height !== this.alignedHeight) {
                for (const widget of this.visual!.getComponentsInChildren(Widget))
                    if (widget.enabled) widget.updateAlignment();
                this.alignedWidth = root.width;
                this.alignedHeight = root.height;
            }
            // UI 相机可能扩展设计矩形，用真实投影视口覆盖全面屏的上下边缘。
            const bounds = this.viewport(root);
            const shield = this.inputShield!.getComponent(UITransform)!;
            shield.setAnchorPoint(0.5, 0.5);
            shield.setContentSize(bounds.right - bounds.left, bounds.top - bounds.bottom);
            shield.node.setPosition((bounds.left + bounds.right) / 2, (bounds.bottom + bounds.top) / 2);
            const step = session.step;
            if (step) {
                const node = step.target.value,
                    button = node.getComponent(Button);
                invariant(
                    step.target.isCurrent() &&
                        isValid(node, true) &&
                        node.activeInHierarchy &&
                        button?.enabledInHierarchy &&
                        button.interactable,
                    'GUIDE_TARGET_LOST',
                    '目标已失效或不可交互',
                );
                let targetCanvas: Canvas | null = null;
                for (let ancestor: Node | null = node; ancestor && !targetCanvas; ancestor = ancestor.parent)
                    targetCanvas = ancestor.getComponent(Canvas);
                invariant(
                    targetCanvas?.cameraComponent === this.camera(),
                    'GUIDE_FOCUS_CAMERA',
                    '目标与遮罩必须位于同一 Canvas',
                );
                let visible = intersectFocusRect(bounds, this.rect(node, root));
                for (let ancestor = node.parent; ancestor && visible; ancestor = ancestor.parent)
                    if (ancestor.getComponent(Mask)?.enabledInHierarchy)
                        visible = intersectFocusRect(visible, this.rect(ancestor, root));
                invariant(visible, 'GUIDE_TARGET_LOST', '目标不在可见区域，请先滚动定位');
                const target = focusGeometry(
                    visible,
                    step.options.shape ?? 'rounded-rect',
                    step.options.padding ?? 8,
                    step.options.radius ?? 12,
                );
                step.from ??= { hole: { rect: bounds, radius: 0 }, shade: 0 };
                const duration = step.options.duration ?? 0.55,
                    progress = duration ? step.elapsed / duration : 1;
                session.frame = focusFrame(step.from, target, progress);
                step.focused = progress >= 1;
            }
            const frame = session.frame!,
                mask = this.holeMask!.node.getComponent(Graphics)!;
            mask.clear();
            this.path(mask, frame.hole);
            mask.fill();
            const shade = this.shade!;
            shade.clear();
            shade.fillColor = new Color(48, 52, 60, Math.round(205 * frame.shade));
            shade.rect(bounds.left, bounds.bottom, bounds.right - bounds.left, bounds.top - bounds.bottom);
            shade.fill();
            const outline = this.outline!;
            outline.clear();
            outline.strokeColor = new Color(255, 255, 255, Math.round(255 * frame.shade));
            outline.lineWidth = 3;
            outline.lineJoin = Graphics.LineJoin.ROUND;
            this.path(outline, frame.hole);
            outline.stroke();
        } catch (error) {
            session.close(error);
        }
    }
}
