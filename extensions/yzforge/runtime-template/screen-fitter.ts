import { _decorator, Component, screen, sys, UITransform, view, Widget } from 'cc';

const { ccclass } = _decorator;

type FitMode = 'fullscreen' | 'safe-area';

export interface ScreenFitSnapshot {
    readonly mode: FitMode;
    readonly width: number;
    readonly height: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

@ccclass('YZScreenFitter')
export class YZScreenFitter extends Component {
    protected fitMode: FitMode = 'fullscreen';
    private installed = false;

    private readonly refreshHandler = (): void => {
        this.refresh();
    };

    protected onEnable(): void {
        this.install();
        this.refresh();
    }

    protected onDisable(): void {
        this.uninstall();
    }

    protected onDestroy(): void {
        this.uninstall();
    }

    public refresh(): ScreenFitSnapshot {
        return this.fitMode === 'safe-area'
            ? this.applySafeArea()
            : this.applyFullscreen();
    }

    protected install(): void {
        if (this.installed) {
            return;
        }
        view.on('canvas-resize', this.refreshHandler);
        this.installed = true;
    }

    protected uninstall(): void {
        if (!this.installed) {
            return;
        }
        view.off('canvas-resize', this.refreshHandler);
        this.installed = false;
    }

    protected applyFullscreen(): ScreenFitSnapshot {
        const widget = this.ensureWidget();
        this.stretchWidget(widget, 0, 0, 0, 0);
        this.ensureTransformSize();
        return this.snapshot('fullscreen', 0, 0, 0, 0);
    }

    protected applySafeArea(): ScreenFitSnapshot {
        const insets = safeAreaInsetsInDesign();
        const widget = this.ensureWidget();
        this.stretchWidget(widget, insets.left, insets.right, insets.top, insets.bottom);
        this.ensureTransformSize();
        return this.snapshot('safe-area', insets.left, insets.right, insets.top, insets.bottom);
    }

    private ensureWidget(): Widget {
        return this.node.getComponent(Widget) ?? this.node.addComponent(Widget);
    }

    private stretchWidget(widget: Widget, left: number, right: number, top: number, bottom: number): void {
        widget.isAlignLeft = true;
        widget.isAlignRight = true;
        widget.isAlignTop = true;
        widget.isAlignBottom = true;
        widget.left = left;
        widget.right = right;
        widget.top = top;
        widget.bottom = bottom;
        widget.updateAlignment();
    }

    private ensureTransformSize(): void {
        const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        const design = view.getDesignResolutionSize();
        transform.setContentSize(design.width, design.height);
    }

    private snapshot(mode: FitMode, left: number, right: number, top: number, bottom: number): ScreenFitSnapshot {
        const transform = this.node.getComponent(UITransform);
        const size = transform?.contentSize ?? view.getDesignResolutionSize();
        return {
            mode,
            width: size.width,
            height: size.height,
            left,
            right,
            top,
            bottom,
        };
    }
}

function safeAreaInsetsInDesign(): { left: number; right: number; top: number; bottom: number } {
    const frame = screen.windowSize;
    const design = view.getDesignResolutionSize();
    const reader = sys as unknown as { getSafeAreaRect?: () => { x: number; y: number; width: number; height: number } };
    const safe = typeof reader.getSafeAreaRect === 'function'
        ? reader.getSafeAreaRect()
        : { x: 0, y: 0, width: frame.width, height: frame.height };
    const xScale = frame.width === 0 ? 1 : design.width / frame.width;
    const yScale = frame.height === 0 ? 1 : design.height / frame.height;
    return {
        left: safe.x * xScale,
        right: Math.max(0, frame.width - safe.x - safe.width) * xScale,
        top: Math.max(0, frame.height - safe.y - safe.height) * yScale,
        bottom: safe.y * yScale,
    };
}
