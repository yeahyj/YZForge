import { screen, sys, view } from 'cc';
import { EventBus } from './event-bus';

export interface EdgeInsets {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

export interface RectLike {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface DeviceProfile {
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly visibleWidth: number;
    readonly visibleHeight: number;
    readonly designWidth: number;
    readonly designHeight: number;
    readonly aspectRatio: number;
    readonly orientation: 'portrait' | 'landscape';
    readonly safeArea: RectLike;
    readonly safeInsets: EdgeInsets;
}

export interface ViewportConfig {
    readonly designWidth: number;
    readonly designHeight: number;
    readonly fit: 'width' | 'height' | 'auto';
}

export interface ViewportEvents {
    readonly changed: DeviceProfile;
}

export class ViewportManager {
    private readonly event = new EventBus<ViewportEvents>();
    private installed = false;
    private currentProfile: DeviceProfile;

    private readonly onResize = (): void => {
        this.refresh();
    };

    public constructor(private readonly config?: ViewportConfig) {
        this.currentProfile = this.readProfile();
    }

    public get profile(): DeviceProfile {
        return this.currentProfile;
    }

    public initialize(): void {
        if (this.config) {
            this.applyDesignResolution(this.config);
        }
        this.refresh();
        if (!this.installed) {
            view.on('canvas-resize', this.onResize);
            this.installed = true;
        }
    }

    public dispose(): void {
        if (this.installed) {
            view.off('canvas-resize', this.onResize);
            this.installed = false;
        }
        this.event.clear();
    }

    public onChanged(handler: (profile: DeviceProfile) => void): () => void {
        return this.event.on('changed', handler);
    }

    public refresh(): DeviceProfile {
        const next = this.readProfile();
        const changed = !sameProfile(this.currentProfile, next);
        this.currentProfile = next;
        if (changed) {
            this.event.emit('changed', next);
        }
        return next;
    }

    private applyDesignResolution(config: ViewportConfig): void {
        const frame = screen.windowSize;
        const designRatio = config.designWidth / config.designHeight;
        const frameRatio = frame.width / frame.height;
        const fitWidth = config.fit === 'width' || (config.fit === 'auto' && frameRatio < designRatio);
        const fitHeight = config.fit === 'height' || (config.fit === 'auto' && frameRatio >= designRatio);
        view.setDesignResolutionSize(config.designWidth, config.designHeight, 0);
        view.setResolutionPolicy({
            name: `yzforge-${config.fit}`,
            init() {},
            apply() {
                view.setDesignResolutionSize(config.designWidth, config.designHeight, 0);
                view.getDesignResolutionSize();
                return { scale: [fitWidth ? 1 : 0, fitHeight ? 1 : 0] };
            },
            preApply() {},
            postApply() {},
        } as never);
    }

    private readProfile(): DeviceProfile {
        const frame = screen.windowSize;
        const visible = view.getVisibleSize();
        const design = view.getDesignResolutionSize();
        const safeArea = rectToPlain(readSafeArea());
        const frameWidth = frame.width;
        const frameHeight = frame.height;
        return {
            frameWidth,
            frameHeight,
            visibleWidth: visible.width,
            visibleHeight: visible.height,
            designWidth: design.width,
            designHeight: design.height,
            aspectRatio: frameHeight === 0 ? 0 : frameWidth / frameHeight,
            orientation: frameWidth >= frameHeight ? 'landscape' : 'portrait',
            safeArea,
            safeInsets: {
                left: safeArea.x,
                right: Math.max(0, frameWidth - safeArea.x - safeArea.width),
                top: Math.max(0, frameHeight - safeArea.y - safeArea.height),
                bottom: safeArea.y,
            },
        };
    }
}

function readSafeArea(): RectLike {
    const safeAreaReader = sys as unknown as { getSafeAreaRect?: () => RectLike };
    if (typeof safeAreaReader.getSafeAreaRect === 'function') {
        return safeAreaReader.getSafeAreaRect();
    }
    return {
        x: 0,
        y: 0,
        width: screen.windowSize.width,
        height: screen.windowSize.height,
    };
}

function rectToPlain(rect: RectLike): RectLike {
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    };
}

function sameProfile(left: DeviceProfile, right: DeviceProfile): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
