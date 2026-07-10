import { ResolutionPolicy, screen, sys, view } from 'cc';
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
    readonly frameSafeArea: RectLike;
    readonly safeArea: RectLike;
    readonly safeInsets: EdgeInsets;
}

export interface ViewportConfig {
    readonly designWidth: number;
    readonly designHeight: number;
    readonly fit: 'width' | 'height' | 'auto';
}

export interface ViewportReader {
    readonly profile: DeviceProfile;
    onChanged(handler: (profile: DeviceProfile) => void): () => void;
}

export interface ViewportEvents {
    readonly changed: DeviceProfile;
}

export class ViewportController implements ViewportReader {
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
        const frameRatio = frame.height === 0 ? designRatio : frame.width / frame.height;
        const fit = config.fit === 'auto'
            ? (frameRatio < designRatio ? 'width' : 'height')
            : config.fit;
        const policy = fit === 'width' ? ResolutionPolicy.FIXED_WIDTH : ResolutionPolicy.FIXED_HEIGHT;
        view.setDesignResolutionSize(config.designWidth, config.designHeight, policy);
    }

    private readProfile(): DeviceProfile {
        const frame = screen.windowSize;
        const visible = view.getVisibleSize();
        const design = view.getDesignResolutionSize();
        const frameSafeArea = rectToPlain(readFrameSafeArea());
        // Visible size is the actual canvas extent expressed in design-coordinate units.
        // It may differ from the requested design size under FIXED_WIDTH/FIXED_HEIGHT.
        const xScale = frame.width === 0 ? 1 : visible.width / frame.width;
        const yScale = frame.height === 0 ? 1 : visible.height / frame.height;
        const safeArea = {
            x: frameSafeArea.x * xScale,
            y: frameSafeArea.y * yScale,
            width: frameSafeArea.width * xScale,
            height: frameSafeArea.height * yScale,
        };
        return {
            frameWidth: frame.width,
            frameHeight: frame.height,
            visibleWidth: visible.width,
            visibleHeight: visible.height,
            designWidth: design.width,
            designHeight: design.height,
            aspectRatio: frame.height === 0 ? 0 : frame.width / frame.height,
            orientation: frame.width >= frame.height ? 'landscape' : 'portrait',
            frameSafeArea,
            safeArea,
            safeInsets: {
                left: safeArea.x,
                right: Math.max(0, visible.width - safeArea.x - safeArea.width),
                top: Math.max(0, visible.height - safeArea.y - safeArea.height),
                bottom: safeArea.y,
            },
        };
    }
}

type ViewportProfileHandler = (profile: DeviceProfile) => void;
const bridgeHandlers = new Set<ViewportProfileHandler>();
let bridgeReader: ViewportReader | undefined;
let disposeBridgeReader: (() => void) | undefined;

export function installViewportBridge(reader: ViewportReader): () => void {
    disposeBridgeReader?.();
    bridgeReader = reader;
    disposeBridgeReader = reader.onChanged((profile) => emitBridgeProfile(profile));
    emitBridgeProfile(reader.profile);
    return () => {
        if (bridgeReader !== reader) {
            return;
        }
        disposeBridgeReader?.();
        disposeBridgeReader = undefined;
        bridgeReader = undefined;
    };
}

export function onViewportProfile(handler: ViewportProfileHandler): () => void {
    bridgeHandlers.add(handler);
    if (bridgeReader) {
        handler(bridgeReader.profile);
    }
    return () => bridgeHandlers.delete(handler);
}

function emitBridgeProfile(profile: DeviceProfile): void {
    for (const handler of Array.from(bridgeHandlers)) {
        handler(profile);
    }
}

function readFrameSafeArea(): RectLike {
    const safeAreaReader = sys as unknown as { getSafeAreaRect?: () => RectLike };
    if (typeof safeAreaReader.getSafeAreaRect === 'function') {
        return safeAreaReader.getSafeAreaRect();
    }
    return { x: 0, y: 0, width: screen.windowSize.width, height: screen.windowSize.height };
}

function rectToPlain(rect: RectLike): RectLike {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function sameProfile(left: DeviceProfile, right: DeviceProfile): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
