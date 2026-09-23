/** 引导遮罩使用的本地坐标矩形。 */
export interface FocusRect {
    /** 左边界。 */ readonly left: number;
    /** 下边界。 */ readonly bottom: number;
    /** 右边界。 */ readonly right: number;
    /** 上边界。 */ readonly top: number;
}
/** 镂空形状：圆形、直角矩形或圆角矩形。 */
export type FocusShape = 'circle' | 'rect' | 'rounded-rect';
/** 用同一种圆角矩形表达三种形状，使位置、大小和曲率可以连续插值。 */
export interface FocusGeometry {
    /** 镂空的包围矩形。 */ readonly rect: FocusRect;
    /** 圆角半径；正方形的半边长表示圆，0 表示直角。 */ readonly radius: number;
}
/** 一帧的镂空形状和遮罩渐入比例。 */
export interface FocusFrame {
    /** 当前镂空几何。 */ readonly hole: FocusGeometry;
    /** 灰色遮罩和描边的不透明度比例，范围 0～1。 */ readonly shade: number;
}
/** 求两个轴对齐矩形的交集；不可见时返回 undefined。 */
export function intersectFocusRect(a: FocusRect, b: FocusRect): FocusRect | undefined {
    const value = {
        left: Math.max(a.left, b.left),
        bottom: Math.max(a.bottom, b.bottom),
        right: Math.min(a.right, b.right),
        top: Math.min(a.top, b.top),
    };
    return value.right > value.left && value.top > value.bottom ? value : undefined;
}
/**
 * 从目标的可见矩形生成镂空。圆形使用外接圆，包含目标四角；padding 是向外增加的半径或边距。
 * @param radius 仅用于 rounded-rect，自动限制在最短边的一半以内。
 */
export function focusGeometry(target: FocusRect, shape: FocusShape, padding = 8, radius = 12): FocusGeometry {
    if (shape === 'circle') {
        const r = Math.hypot(target.right - target.left, target.top - target.bottom) / 2 + padding;
        const x = (target.left + target.right) / 2,
            y = (target.bottom + target.top) / 2;
        return { rect: { left: x - r, right: x + r, bottom: y - r, top: y + r }, radius: r };
    }
    const rect = {
        left: target.left - padding,
        bottom: target.bottom - padding,
        right: target.right + padding,
        top: target.top + padding,
    };
    return {
        rect,
        radius: shape === 'rect' ? 0 : Math.min(radius, (rect.right - rect.left) / 2, (rect.top - rect.bottom) / 2),
    };
}
/**
 * 使用 cubic ease-in-out 连续插值位置、尺寸、圆角及遮罩透明度；进度钳制到 0～1。
 * 首次从 { hole: 全屏矩形, shade: 0 } 开始；后续步骤从上一帧开始，shade 保持 1。
 * 本函数不产生白色填充，也不会在切换步骤时重置透明度。
 */
export function focusFrame(from: FocusFrame, target: FocusGeometry, progress: number): FocusFrame {
    const t = Math.min(1, Math.max(0, progress));
    const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    const lerp = (a: number, b: number) => a + (b - a) * ease;
    return {
        hole: {
            rect: {
                left: lerp(from.hole.rect.left, target.rect.left),
                bottom: lerp(from.hole.rect.bottom, target.rect.bottom),
                right: lerp(from.hole.rect.right, target.rect.right),
                top: lerp(from.hole.rect.top, target.rect.top),
            },
            radius: lerp(from.hole.radius, target.radius),
        },
        shade: lerp(from.shade, 1),
    };
}
/** 点是否位于真实镂空内部（含边界）；圆形和圆角的包围盒角落不会放行输入。 */
export function insideFocus(hole: FocusGeometry, x: number, y: number): boolean {
    const { rect, radius } = hole;
    if (x < rect.left || x > rect.right || y < rect.bottom || y > rect.top) return false;
    const dx = x - Math.max(rect.left + radius, Math.min(rect.right - radius, x));
    const dy = y - Math.max(rect.bottom + radius, Math.min(rect.top - radius, y));
    return dx * dx + dy * dy <= radius * radius;
}
