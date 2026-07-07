import { isValid, Node } from 'cc';

export type LayerId = number;

export interface LayerRegistrySnapshot {
    readonly layer: LayerId;
    readonly configured: boolean;
    readonly valid: boolean;
    readonly name?: string;
}

export class LayerRegistry {
    private roots: Partial<Record<LayerId, Node>> = {};

    public constructor(roots: Partial<Record<LayerId, Node>> = {}) {
        this.configure(roots);
    }

    public configure(roots: Partial<Record<LayerId, Node>>): void {
        this.roots = { ...roots };
    }

    public get(layer: LayerId): Node | undefined {
        const root = this.roots[layer];
        return root && isValid(root) ? root : undefined;
    }

    public snapshot(): LayerRegistrySnapshot[] {
        return Object.keys(this.roots)
            .map((key) => Number(key))
            .sort((a, b) => a - b)
            .map((layer) => {
                const root = this.roots[layer];
                return {
                    layer,
                    configured: Boolean(root),
                    valid: Boolean(root && isValid(root)),
                    ...(root && isValid(root) ? { name: root.name } : {}),
                };
            });
    }
}
