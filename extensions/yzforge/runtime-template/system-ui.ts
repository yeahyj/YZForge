import { BlockInputEvents, Color, Graphics, isValid, Node, UITransform } from 'cc';
import { YZForgeError } from './errors';
import { LayerRegistry } from './layer-registry';

export interface PopupMaskRequest {
    readonly targetNode: Node;
    readonly mask: 'dim' | 'transparent';
    readonly closeOnMask: boolean;
    close(): void;
}

export interface SystemUISnapshot {
    readonly popupMaskVisible: boolean;
    readonly touchMaskVisible: boolean;
}

export interface SystemUIProvider {
    readonly name: string;
    createPopupMask?(root: Node, mask: 'dim' | 'transparent'): Node;
    createTouchMask?(root: Node, reason?: unknown): Node;
    dispose?(): void;
}

export class SystemUI {
    private popupMask?: Node;
    private popupRequest?: PopupMaskRequest;
    private touchMask?: Node;
    private readonly providers = new Map<string, SystemUIProvider>();

    private readonly onPopupMaskTouchEnd = (): void => {
        if (this.popupRequest?.closeOnMask) {
            this.popupRequest.close();
        }
    };

    public constructor(private readonly layers: LayerRegistry) {}

    public registerProvider(provider: SystemUIProvider): () => void {
        if (!provider.name) {
            throw new YZForgeError('SystemUI provider name is required.', 'system_ui.provider_invalid');
        }
        if (this.providers.has(provider.name)) {
            throw new YZForgeError(`SystemUI provider already registered: ${provider.name}`, 'system_ui.provider_duplicate', {
                provider: provider.name,
            });
        }
        this.providers.set(provider.name, provider);
        this.destroyMasks();
        let active = true;
        return () => {
            if (!active) {
                return;
            }
            active = false;
            if (this.providers.get(provider.name) === provider) {
                const wasActiveProvider = this.activeProvider() === provider;
                this.providers.delete(provider.name);
                if (wasActiveProvider) {
                    this.destroyMasks();
                }
                provider.dispose?.();
            }
        };
    }

    public updatePopupMask(request?: PopupMaskRequest): void {
        this.popupRequest = request;
        if (!request) {
            this.hidePopupMask();
            return;
        }

        const root = request.targetNode.parent;
        if (!root || !isValid(root)) {
            this.hidePopupMask();
            return;
        }

        const mask = this.ensurePopupMask(root, request.mask);
        if (mask.parent !== root) {
            root.addChild(mask);
        }
        mask.setSiblingIndex(Math.max(0, request.targetNode.getSiblingIndex() - 1));
        mask.active = true;
    }

    public showTouchMask(reason?: unknown): Node | undefined {
        const root = this.layers.get(SystemLayerId);
        if (!root) {
            return undefined;
        }
        const mask = this.ensureTouchMask(root, reason);
        mask.active = true;
        mask.setSiblingIndex(root.children.length - 1);
        mask.name = reason === undefined ? 'YZForgeTouchMask' : `YZForgeTouchMask`;
        return mask;
    }

    public hideTouchMask(): void {
        if (this.touchMask && isValid(this.touchMask)) {
            this.touchMask.active = false;
        }
    }

    public dispose(): void {
        this.destroyMasks();
        const providers = Array.from(this.providers.values()).reverse();
        this.providers.clear();
        for (const provider of providers) {
            provider.dispose?.();
        }
    }

    public snapshot(): SystemUISnapshot {
        return {
            popupMaskVisible: Boolean(this.popupMask && isValid(this.popupMask) && this.popupMask.active),
            touchMaskVisible: Boolean(this.touchMask && isValid(this.touchMask) && this.touchMask.active),
        };
    }

    private ensurePopupMask(root: Node, maskKind: 'dim' | 'transparent'): Node {
        if (this.popupMask && isValid(this.popupMask)) {
            if (!this.activeProvider()?.createPopupMask) {
                this.redrawPopupMask(this.popupMask, maskKind);
            }
            return this.popupMask;
        }

        const mask = this.activeProvider()?.createPopupMask?.(root, maskKind) ?? new Node('YZForgePopupMask');
        this.prepareMaskNode(mask, 'YZForgePopupMask');
        if (!mask.getComponent(Graphics)) {
            mask.addComponent(Graphics);
        }
        mask.off(Node.EventType.TOUCH_END, this.onPopupMaskTouchEnd, this);
        mask.on(Node.EventType.TOUCH_END, this.onPopupMaskTouchEnd, this);
        root.addChild(mask);
        this.popupMask = mask;
        if (!this.activeProvider()?.createPopupMask) {
            this.redrawPopupMask(mask, maskKind);
        }
        return mask;
    }

    private hidePopupMask(): void {
        this.popupRequest = undefined;
        if (this.popupMask && isValid(this.popupMask)) {
            this.popupMask.active = false;
            this.popupMask.removeFromParent();
        }
    }

    private redrawPopupMask(mask: Node, maskKind: 'dim' | 'transparent'): void {
        const graphics = mask.getComponent(Graphics);
        if (!graphics) {
            return;
        }
        graphics.clear();
        graphics.fillColor = maskKind === 'dim' ? new Color(0, 0, 0, 128) : new Color(0, 0, 0, 0);
        graphics.rect(-5000, -5000, 10000, 10000);
        graphics.fill();
    }

    private ensureTouchMask(root: Node, reason?: unknown): Node {
        if (this.touchMask && isValid(this.touchMask)) {
            if (this.touchMask.parent !== root) {
                root.addChild(this.touchMask);
            }
            return this.touchMask;
        }
        const mask = this.activeProvider()?.createTouchMask?.(root, reason) ?? new Node('YZForgeTouchMask');
        this.prepareMaskNode(mask, 'YZForgeTouchMask');
        root.addChild(mask);
        this.touchMask = mask;
        return mask;
    }

    private activeProvider(): SystemUIProvider | undefined {
        return Array.from(this.providers.values())[this.providers.size - 1];
    }

    private prepareMaskNode(mask: Node, name: string): void {
        mask.name = mask.name || name;
        if (!mask.getComponent(BlockInputEvents)) {
            mask.addComponent(BlockInputEvents);
        }
        const transform = mask.getComponent(UITransform) ?? mask.addComponent(UITransform);
        transform.setContentSize(10000, 10000);
    }

    private destroyMasks(): void {
        this.popupRequest = undefined;
        if (this.popupMask && isValid(this.popupMask)) {
            this.popupMask.off(Node.EventType.TOUCH_END, this.onPopupMaskTouchEnd, this);
            this.popupMask.destroy();
        }
        this.popupMask = undefined;
        if (this.touchMask && isValid(this.touchMask)) {
            this.touchMask.destroy();
        }
        this.touchMask = undefined;
    }
}

const SystemLayerId = 900;
