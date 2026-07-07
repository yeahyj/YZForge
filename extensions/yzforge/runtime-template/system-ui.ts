import { BlockInputEvents, Color, Graphics, isValid, Node, UITransform } from 'cc';
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

export class SystemUI {
    private popupMask?: Node;
    private popupRequest?: PopupMaskRequest;
    private touchMask?: Node;

    public constructor(private readonly layers: LayerRegistry) {}

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
        const mask = this.ensureTouchMask(root);
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
        this.hidePopupMask();
        if (this.touchMask && isValid(this.touchMask)) {
            this.touchMask.destroy();
        }
        this.touchMask = undefined;
    }

    public snapshot(): SystemUISnapshot {
        return {
            popupMaskVisible: Boolean(this.popupMask && isValid(this.popupMask) && this.popupMask.active),
            touchMaskVisible: Boolean(this.touchMask && isValid(this.touchMask) && this.touchMask.active),
        };
    }

    private ensurePopupMask(root: Node, maskKind: 'dim' | 'transparent'): Node {
        if (this.popupMask && isValid(this.popupMask)) {
            this.redrawPopupMask(this.popupMask, maskKind);
            return this.popupMask;
        }

        const mask = new Node('YZForgePopupMask');
        mask.addComponent(BlockInputEvents);
        const transform = mask.addComponent(UITransform);
        transform.setContentSize(10000, 10000);
        mask.addComponent(Graphics);
        mask.on(Node.EventType.TOUCH_END, () => {
            if (this.popupRequest?.closeOnMask) {
                this.popupRequest.close();
            }
        });
        root.addChild(mask);
        this.popupMask = mask;
        this.redrawPopupMask(mask, maskKind);
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

    private ensureTouchMask(root: Node): Node {
        if (this.touchMask && isValid(this.touchMask)) {
            if (this.touchMask.parent !== root) {
                root.addChild(this.touchMask);
            }
            return this.touchMask;
        }
        const mask = new Node('YZForgeTouchMask');
        mask.addComponent(BlockInputEvents);
        const transform = mask.addComponent(UITransform);
        transform.setContentSize(10000, 10000);
        root.addChild(mask);
        this.touchMask = mask;
        return mask;
    }
}

const SystemLayerId = 900;
