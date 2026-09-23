import { invariant } from '../../../core/errors';
/** 按位选择要避让的边；可用 | 组合。 */
export enum SafeEdge {
    Top = 1,
    Bottom = 2,
    Left = 4,
    Right = 8,
    All = 15,
}
/** 对称策略；默认保留设备真实边距，横屏左右对称是显式选项。 */
export enum SafeSymmetry {
    None = 0,
    LandscapeSides = 1,
    BothAxes = 2,
}
/** 同一坐标系中的轴对齐矩形。 */
export interface SafeRect {
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly top: number;
}
/** 四边数值；Widget 原始边距沿用各边的绝对/百分比单位。 */
export interface SafeInsets {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
}
const edges = ['top', 'bottom', 'left', 'right'] as const;
function validRect(rect: SafeRect): void {
    invariant(
        Object.values(rect).every(Number.isFinite) && rect.right > rect.left && rect.top > rect.bottom,
        'SAFE_WIDGET_RECT',
        '安全区和参考矩形须有正尺寸',
    );
}
/** 按显式对称策略处理安全矩形；不扩大设备实际可用范围。 */
export function symmetricSafeRect(viewport: SafeRect, safe: SafeRect, mode: SafeSymmetry): SafeRect {
    validRect(viewport);
    validRect(safe);
    invariant(
        [SafeSymmetry.None, SafeSymmetry.LandscapeSides, SafeSymmetry.BothAxes].includes(mode),
        'SAFE_WIDGET_SYMMETRY',
        '未知对称模式',
    );
    let left = Math.max(0, safe.left - viewport.left),
        right = Math.max(0, viewport.right - safe.right);
    let bottom = Math.max(0, safe.bottom - viewport.bottom),
        top = Math.max(0, viewport.top - safe.top);
    if (
        mode === SafeSymmetry.BothAxes ||
        (mode === SafeSymmetry.LandscapeSides && viewport.right - viewport.left > viewport.top - viewport.bottom)
    )
        left = right = Math.max(left, right);
    if (mode === SafeSymmetry.BothAxes) top = bottom = Math.max(top, bottom);
    const result = {
        left: viewport.left + left,
        right: viewport.right - right,
        bottom: viewport.bottom + bottom,
        top: viewport.top - top,
    };
    validRect(result);
    return result;
}
/**
 * 根据参考区域计算额外避让，已在安全区内的参考节点得到零补偿。
 * absolute 为 false 的边按参考尺寸转换成百分比；每次基于 base 计算，不累计上次结果。
 */
export function safeWidgetOffsets(
    reference: SafeRect,
    safe: SafeRect,
    base: SafeInsets,
    absolute: Readonly<Record<keyof SafeInsets, boolean>>,
    mask: number,
): SafeInsets {
    validRect(reference);
    validRect(safe);
    invariant(
        Number.isInteger(mask) &&
            mask >= 0 &&
            mask <= SafeEdge.All &&
            edges.every((edge) => Number.isFinite(base[edge])),
        'SAFE_WIDGET_OFFSETS',
        '边选择或基础边距无效',
    );
    const width = reference.right - reference.left,
        height = reference.top - reference.bottom;
    const gaps = {
        top: Math.max(0, reference.top - safe.top),
        bottom: Math.max(0, safe.bottom - reference.bottom),
        left: Math.max(0, safe.left - reference.left),
        right: Math.max(0, reference.right - safe.right),
    };
    invariant(
        gaps.left + gaps.right < width && gaps.top + gaps.bottom < height,
        'SAFE_WIDGET_OUTSIDE',
        '参考节点不在安全区内',
    );
    const result = { ...base };
    edges.forEach((edge, index) => {
        if (mask & (1 << index)) result[edge] += gaps[edge] / (absolute[edge] ? 1 : index < 2 ? height : width);
    });
    return result;
}
