import { invariant } from '../../../core/errors';

/** 固定尺寸纵向布局；columns 为 1 时是列表，大于 1 时按行优先排列网格。 */
export interface VirtualListLayout {
    /** 条目宽度，单位为 UI 坐标，必须大于 0；不会自动拉伸。 */
    readonly itemWidth: number;
    /** 条目高度，单位为 UI 坐标，必须大于 0。 */
    readonly itemHeight: number;
    /** 固定列数，默认 1；必须为正整数。 */
    readonly columns?: number;
    /** 列间距，默认 0，不能为负。 */
    readonly spacingX?: number;
    /** 行间距，默认 0，不能为负。 */
    readonly spacingY?: number;
    /** 内容左边距，默认 0。 */
    readonly paddingLeft?: number;
    /** 内容右边距，默认 0。 */
    readonly paddingRight?: number;
    /** 内容上边距，默认 0。 */
    readonly paddingTop?: number;
    /** 内容下边距，默认 0。 */
    readonly paddingBottom?: number;
    /** 可见区域上下各预备的行数，默认 1，必须为非负整数。 */
    readonly overscanRows?: number;
}

/** 滚动定位方式：起点、居中、终点，或仅在条目未完整可见时移动最短距离。 */
export type VirtualListAlignment = 'start' | 'center' | 'end' | 'nearest';

/** 左闭右开的条目索引区间；空区间的 start 与 end 都为 0。 */
export interface VirtualListRange {
    /** 第一个需要实例的索引。 */
    readonly start: number;
    /** 最后一个需要实例的索引加一。 */
    readonly end: number;
}

/** @internal 固定布局计算器；不访问引擎，供控制器与边界测试共用。 */
export class FixedVirtualLayout {
    readonly options: Required<VirtualListLayout>;
    constructor(input: VirtualListLayout) {
        this.options = Object.freeze({
            itemWidth: input.itemWidth,
            itemHeight: input.itemHeight,
            columns: input.columns ?? 1,
            spacingX: input.spacingX ?? 0,
            spacingY: input.spacingY ?? 0,
            paddingLeft: input.paddingLeft ?? 0,
            paddingRight: input.paddingRight ?? 0,
            paddingTop: input.paddingTop ?? 0,
            paddingBottom: input.paddingBottom ?? 0,
            overscanRows: input.overscanRows ?? 1,
        });
        for (const [key, value] of Object.entries(this.options)) {
            invariant(Number.isFinite(value) && value >= 0, 'VIRTUAL_LIST_LAYOUT', `${key} 必须为有限非负数`);
        }
        const o = this.options;
        invariant(o.itemWidth > 0 && o.itemHeight > 0, 'VIRTUAL_LIST_LAYOUT', '条目尺寸必须大于 0');
        invariant(Number.isInteger(o.columns) && o.columns > 0, 'VIRTUAL_LIST_LAYOUT', '列数必须为正整数');
        invariant(Number.isInteger(o.overscanRows), 'VIRTUAL_LIST_LAYOUT', '预备行数必须为整数');
    }
    get stride(): number {
        return this.options.itemHeight + this.options.spacingY;
    }
    get width(): number {
        const o = this.options;
        return o.paddingLeft + o.paddingRight + o.columns * o.itemWidth + (o.columns - 1) * o.spacingX;
    }
    height(count: number): number {
        const rows = Math.ceil(count / this.options.columns);
        return (
            this.options.paddingTop +
            this.options.paddingBottom +
            Math.max(0, rows * this.stride - this.options.spacingY)
        );
    }
    clampOffset(count: number, viewport: number, offset: number): number {
        return Math.max(0, Math.min(offset, Math.max(0, this.height(count) - viewport)));
    }
    range(count: number, viewport: number, offset: number): VirtualListRange {
        if (!count || viewport <= 0) return { start: 0, end: 0 };
        const o = this.options;
        const top = this.clampOffset(count, viewport, offset) - o.paddingTop;
        const rows = Math.ceil(count / o.columns);
        const first = Math.max(0, Math.floor((top - o.itemHeight) / this.stride) + 1 - o.overscanRows);
        const end = Math.min(rows, Math.ceil((top + viewport) / this.stride) + o.overscanRows);
        if (end <= first) return { start: 0, end: 0 };
        return { start: first * o.columns, end: Math.min(count, end * o.columns) };
    }
    capacity(count: number, viewport: number): number {
        if (viewport <= 0) return 0;
        return Math.min(
            count,
            (Math.ceil(viewport / this.stride) + 1 + this.options.overscanRows * 2) * this.options.columns,
        );
    }
    position(index: number): { x: number; y: number } {
        const o = this.options;
        return {
            x: o.paddingLeft + (index % o.columns) * (o.itemWidth + o.spacingX),
            y: o.paddingTop + Math.floor(index / o.columns) * this.stride,
        };
    }
    offset(count: number, viewport: number, index: number, alignment: VirtualListAlignment, current: number): number {
        const top = this.position(index).y;
        const bottom = top + this.options.itemHeight;
        let target = top;
        if (alignment === 'center') target = (top + bottom - viewport) / 2;
        else if (alignment === 'end') target = bottom - viewport;
        else if (alignment === 'nearest') {
            if (top >= current && bottom <= current + viewport) target = current;
            else if (top <= current && bottom >= current + viewport) target = current;
            else target = top < current ? top : bottom - viewport;
        }
        return this.clampOffset(count, viewport, target);
    }
}
