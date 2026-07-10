import { _decorator, Component, UITransform, Widget } from 'cc';
import { onViewportProfile, type DeviceProfile } from './viewport';

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
    private disposeProfile?: () => void;
    private profile?: DeviceProfile;

    protected onEnable(): void {
        this.disposeProfile?.();
        this.disposeProfile = onViewportProfile((profile) => {
            this.profile = profile;
            this.refresh();
        });
    }

    protected onDisable(): void {
        this.uninstall();
    }

    protected onDestroy(): void {
        this.uninstall();
    }

    public refresh(): ScreenFitSnapshot {
        const profile = this.profile;
        if (!profile) {
            return this.snapshot(this.fitMode, 0, 0, 0, 0);
        }
        const insets = this.fitMode === 'safe-area'
            ? profile.safeInsets
            : { left: 0, right: 0, top: 0, bottom: 0 };
        const widget = this.ensureWidget();
        this.stretchWidget(widget, insets.left, insets.right, insets.top, insets.bottom);
        const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        transform.setContentSize(profile.visibleWidth, profile.visibleHeight);
        return this.snapshot(this.fitMode, insets.left, insets.right, insets.top, insets.bottom);
    }

    private uninstall(): void {
        this.disposeProfile?.();
        this.disposeProfile = undefined;
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

    private snapshot(mode: FitMode, left: number, right: number, top: number, bottom: number): ScreenFitSnapshot {
        const size = this.node.getComponent(UITransform)?.contentSize;
        return {
            mode,
            width: size?.width ?? this.profile?.visibleWidth ?? 0,
            height: size?.height ?? this.profile?.visibleHeight ?? 0,
            left,
            right,
            top,
            bottom,
        };
    }
}
