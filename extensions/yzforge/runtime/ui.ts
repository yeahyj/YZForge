import {
    BlockInputEvents,
    Color,
    Component,
    director,
    EventKeyboard,
    Graphics,
    input,
    Input,
    isValid,
    KeyCode,
    Node,
    UITransform,
} from 'cc';
import { YZForgeError } from './errors';
import type { Module } from './module';
import type { ViewPolicyLike, ViewRef } from './refs';
import type { MaybePromise } from './types';

export enum ViewKind {
    Page = 'page',
    Paper = 'paper',
    Popup = 'popup',
    Toast = 'toast',
    Top = 'top',
    System = 'system',
}

export enum ViewLayer {
    Page = 100,
    Paper = 200,
    Popup = 300,
    Toast = 400,
    Top = 500,
    System = 900,
}

export enum ViewStackMode {
    Single = 'single',
    Stack = 'stack',
    Queue = 'queue',
    Free = 'free',
}

export enum ViewState {
    Closed = 'closed',
    Loading = 'loading',
    Opening = 'opening',
    Open = 'open',
    Paused = 'paused',
    Closing = 'closing',
    Disposed = 'disposed',
    Failed = 'failed',
}

export interface UiCancelResult {
    readonly cancelled: true;
    readonly reason?: unknown;
}

export interface OpenViewOptions {
    readonly key?: string;
    readonly duplicate?: 'focus' | 'reject' | 'reopen';
    readonly closeOnMask?: boolean;
    readonly policy?: Partial<ViewPolicyLike>;
}

export interface CloseViewOptions {
    readonly force?: boolean;
}

export interface ResolvedViewPolicy {
    readonly kind: ViewKind;
    readonly layer: ViewLayer;
    readonly stack: ViewStackMode;
    readonly modal: boolean;
    readonly mask: 'none' | 'dim' | 'transparent';
    readonly duplicate: 'focus' | 'reject' | 'reopen';
    readonly closeOnBack: boolean;
    readonly closeOnMask: boolean;
    readonly closeWithOwner: boolean;
    readonly pauseWithOwner: boolean;
    readonly cache: 'none' | 'asset' | 'node';
}

export interface ViewHandle<TResult = unknown> {
    readonly id: string;
    readonly key: string;
    readonly ref: ViewRef<unknown, TResult>;
    readonly layer: ViewLayer;
    readonly policy: ResolvedViewPolicy;
    readonly node: Node;
    readonly view: View<unknown, TResult>;
    readonly owner: Module;
    state: ViewState;
    close(result?: TResult): Promise<void>;
    cancel(reason?: unknown): Promise<void>;
    focus(): void;
}

export interface BackKeyOptions {
    readonly keys?: readonly KeyCode[];
    readonly consume?: boolean;
}

export type BackKeyHandler = () => MaybePromise<boolean>;

export interface ViewSnapshot {
    readonly id: string;
    readonly key: string;
    readonly path: string;
    readonly owner: string;
    readonly kind: ViewKind;
    readonly layer: ViewLayer;
    readonly state: ViewState;
    readonly modal: boolean;
    readonly closeOnBack: boolean;
}

export function isUiCancelResult(value: unknown): value is UiCancelResult {
    return Boolean(value) && typeof value === 'object' && (value as UiCancelResult).cancelled === true;
}

export type ComponentType<TComponent extends Component> = new (...args: any[]) => TComponent;

let nextViewId = 0;
type AnyViewHandle = ViewHandle<any>;

interface OpenToken {
    readonly key: string;
    readonly layer: ViewLayer;
    readonly path: string;
    readonly keyVersion: number;
    readonly layerVersion: number;
}

interface CachedNodeRecord {
    readonly node: Node;
    readonly ref: ViewRef<unknown, unknown>;
}

const LAYER_NODE_NAMES: Record<ViewLayer, string> = {
    [ViewLayer.Page]: 'PageLayer',
    [ViewLayer.Paper]: 'PaperLayer',
    [ViewLayer.Popup]: 'PopupLayer',
    [ViewLayer.Toast]: 'ToastLayer',
    [ViewLayer.Top]: 'TopLayer',
    [ViewLayer.System]: 'SystemLayer',
};

const VIEW_KINDS = [ViewKind.Page, ViewKind.Paper, ViewKind.Popup, ViewKind.Toast, ViewKind.Top, ViewKind.System];
const VIEW_STACK_MODES = [ViewStackMode.Single, ViewStackMode.Stack, ViewStackMode.Queue, ViewStackMode.Free];
const VIEW_LAYERS = [ViewLayer.Page, ViewLayer.Paper, ViewLayer.Popup, ViewLayer.Toast, ViewLayer.Top, ViewLayer.System];
const DEFAULT_BACK_KEYS = [KeyCode.MOBILE_BACK, KeyCode.ESCAPE] as const;

const DEFAULT_POLICY_BY_KIND: Record<ViewKind, ResolvedViewPolicy> = {
    [ViewKind.Page]: {
        kind: ViewKind.Page,
        layer: ViewLayer.Page,
        stack: ViewStackMode.Single,
        modal: false,
        mask: 'none',
        duplicate: 'reopen',
        closeOnBack: false,
        closeOnMask: false,
        closeWithOwner: true,
        pauseWithOwner: true,
        cache: 'asset',
    },
    [ViewKind.Paper]: {
        kind: ViewKind.Paper,
        layer: ViewLayer.Paper,
        stack: ViewStackMode.Stack,
        modal: false,
        mask: 'none',
        duplicate: 'focus',
        closeOnBack: true,
        closeOnMask: false,
        closeWithOwner: true,
        pauseWithOwner: true,
        cache: 'asset',
    },
    [ViewKind.Popup]: {
        kind: ViewKind.Popup,
        layer: ViewLayer.Popup,
        stack: ViewStackMode.Stack,
        modal: true,
        mask: 'dim',
        duplicate: 'focus',
        closeOnBack: true,
        closeOnMask: false,
        closeWithOwner: true,
        pauseWithOwner: false,
        cache: 'asset',
    },
    [ViewKind.Toast]: {
        kind: ViewKind.Toast,
        layer: ViewLayer.Toast,
        stack: ViewStackMode.Queue,
        modal: false,
        mask: 'none',
        duplicate: 'reopen',
        closeOnBack: false,
        closeOnMask: false,
        closeWithOwner: true,
        pauseWithOwner: false,
        cache: 'asset',
    },
    [ViewKind.Top]: {
        kind: ViewKind.Top,
        layer: ViewLayer.Top,
        stack: ViewStackMode.Free,
        modal: false,
        mask: 'none',
        duplicate: 'focus',
        closeOnBack: false,
        closeOnMask: false,
        closeWithOwner: true,
        pauseWithOwner: true,
        cache: 'asset',
    },
    [ViewKind.System]: {
        kind: ViewKind.System,
        layer: ViewLayer.System,
        stack: ViewStackMode.Single,
        modal: true,
        mask: 'transparent',
        duplicate: 'focus',
        closeOnBack: false,
        closeOnMask: false,
        closeWithOwner: true,
        pauseWithOwner: false,
        cache: 'asset',
    },
};

export class UIManager {
    private readonly moduleUis = new Map<string, ModuleUI>();
    private backKeyHandler?: BackKeyHandler;
    private backKeyInstalled = false;
    private backKeyHandling = false;
    private backKeyConsume = true;
    private backKeys = new Set<KeyCode>(DEFAULT_BACK_KEYS);

    private readonly onBackKeyDown = (event: EventKeyboard): void => {
        if (!this.backKeyHandler || !this.backKeys.has(event.keyCode)) {
            return;
        }

        if (this.backKeyConsume) {
            stopKeyboardEvent(event);
        }
        if (this.backKeyHandling) {
            return;
        }

        this.backKeyHandling = true;
        Promise.resolve(this.backKeyHandler())
            .catch((error) => {
                console.error('[YZForge] Back key handler failed.', error);
            })
            .then(() => {
                this.backKeyHandling = false;
            });
    };

    public constructor(private readonly roots: Partial<Record<ViewLayer, Node>> = {}) {}

    public forModule(module: Module): ModuleUI {
        let ui = this.moduleUis.get(module.name);
        if (!ui) {
            ui = new ModuleUI(module, this.roots);
            this.moduleUis.set(module.name, ui);
        }
        return ui;
    }

    public createForModule(moduleName: string, module: Module): ModuleUI {
        let ui = this.moduleUis.get(moduleName);
        if (!ui) {
            ui = new ModuleUI(module, this.roots);
            this.moduleUis.set(moduleName, ui);
        }
        return ui;
    }

    public async closeModule(module: Module, reason?: unknown): Promise<void> {
        await this.moduleUis.get(module.name)?.closeOwned(reason);
    }

    public async disposeModule(moduleName: string, reason?: unknown): Promise<void> {
        const ui = this.moduleUis.get(moduleName);
        if (!ui) {
            return;
        }
        await ui.dispose(reason);
        this.moduleUis.delete(moduleName);
    }

    public installBackKeyHandler(handler: BackKeyHandler, options: BackKeyOptions = {}): void {
        this.backKeyHandler = handler;
        this.backKeys = new Set(options.keys ?? DEFAULT_BACK_KEYS);
        this.backKeyConsume = options.consume ?? true;
        if (this.backKeyInstalled) {
            return;
        }
        input.on(Input.EventType.KEY_DOWN, this.onBackKeyDown, this);
        this.backKeyInstalled = true;
    }

    public uninstallBackKeyHandler(): void {
        if (!this.backKeyInstalled) {
            this.backKeyHandler = undefined;
            return;
        }
        input.off(Input.EventType.KEY_DOWN, this.onBackKeyDown, this);
        this.backKeyHandler = undefined;
        this.backKeyInstalled = false;
        this.backKeyHandling = false;
    }

    public snapshots(moduleName?: string): ViewSnapshot[] {
        const uis = moduleName ? [this.moduleUis.get(moduleName)] : Array.from(this.moduleUis.values());
        const snapshots: ViewSnapshot[] = [];
        for (const ui of uis) {
            if (ui) {
                snapshots.push(...ui.snapshots());
            }
        }
        return snapshots;
    }
}

export class ModuleUI {
    private readonly handles = new Set<AnyViewHandle>();
    private readonly pendingOpens = new Map<string, Promise<AnyViewHandle>>();
    private readonly queueTasks = new Map<ViewLayer, Promise<void>>();
    private readonly keyVersions = new Map<string, number>();
    private readonly layerVersions = new Map<ViewLayer, number>();
    private readonly nodeCache = new Map<string, CachedNodeRecord>();
    private popupMask?: Node;
    private maskTarget?: AnyViewHandle;

    public constructor(
        private readonly module: Module,
        private readonly roots: Partial<Record<ViewLayer, Node>>,
    ) {}

    public async open<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        options: OpenViewOptions = {},
    ): Promise<ViewHandle<TResult>> {
        const policy = this.resolvePolicy(ref, options);
        const key = this.viewKey(ref, options);
        const duplicate = this.findDuplicate(ref, key);
        if (duplicate) {
            return await this.resolveDuplicate(duplicate, ref, data, options, policy);
        }
        const pending = this.pendingOpens.get(key);
        if (pending) {
            return await this.resolvePendingDuplicate(pending, ref, data, options, policy, key);
        }

        const task = policy.stack === ViewStackMode.Queue
            ? this.enqueueOpen(ref, data, options, policy, key)
            : this.openWithPolicy(ref, data, options, policy, key);
        this.pendingOpens.set(key, task as Promise<AnyViewHandle>);
        try {
            return await task;
        } finally {
            if (this.pendingOpens.get(key) === task) {
                this.pendingOpens.delete(key);
            }
        }
    }

    private async openWithPolicy<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data: TData | undefined,
        options: OpenViewOptions,
        policy: ResolvedViewPolicy,
        key: string,
    ): Promise<ViewHandle<TResult>> {
        if (policy.stack === ViewStackMode.Single) {
            await this.closeLayer(policy.layer, { cancelled: true, reason: 'single_view_replaced' }, { force: true });
        }
        return await this.openImmediate(ref, data, options, policy, this.createOpenToken(policy.layer, key, ref.path));
    }

    private async openImmediate<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data: TData | undefined,
        options: OpenViewOptions,
        policy: ResolvedViewPolicy,
        token: OpenToken,
    ): Promise<ViewHandle<TResult>> {
        let node: Node | undefined;
        let nodeFromCache = false;
        try {
            this.ensureOpenAllowed(token);
            node = policy.cache === 'node' ? this.takeCachedNode(token.key) : undefined;
            if (node) {
                nodeFromCache = true;
                node.active = true;
                this.module.assets.trackNode(node);
            } else {
                node = await this.module.assets.instantiate(ref, {
                    acquireAsset: policy.cache !== 'asset',
                });
            }
            this.ensureOpenAllowed(token);
            const component = node.getComponent(ref.component);
            if (!component) {
                this.module.assets.destroyNode(node);
                if (policy.cache === 'none') {
                    this.module.assets.release(ref);
                }
                throw new YZForgeError(`View prefab does not contain component: ${ref.path}`, 'ui.view_component_missing');
            }

            const view = component as View<TData, TResult>;
            const id = `view-${++nextViewId}`;
            const handle: ViewHandle<TResult> = {
                id,
                key: token.key,
                ref: ref as unknown as ViewRef<unknown, TResult>,
                layer: policy.layer,
                policy,
                node,
                view: view as unknown as View<unknown, TResult>,
                owner: this.module,
                state: ViewState.Loading,
                close: async (result?: TResult) => this.close(handle, result),
                cancel: async (reason?: unknown) => this.close(handle, { cancelled: true, reason }),
                focus: () => this.focus(handle),
            };

            view.__yzforgeBind(this.module, handle);
            handle.state = ViewState.Opening;
            await view.__yzforgeBeforeOpen(data);
            this.ensureOpenAllowed(token);
            const root = this.resolveRoot(policy.layer);
            if (root) {
                root.addChild(node);
            } else {
                this.module.logger.warn(`UI layer root not found: ${ViewLayer[policy.layer] ?? policy.layer}`);
            }
            handle.state = ViewState.Open;
            this.handles.add(handle as AnyViewHandle);
            this.focus(handle);
            await view.__yzforgeOpen(data);
            this.ensureOpenAllowed(token);
            this.updatePopupMask();
            return handle;
        } catch (error) {
            if (error instanceof YZForgeError && error.code === 'ui.view_open_cancelled') {
                this.module.logger.debug(`View open cancelled: ${token.path}`, error.details);
            }
            if (node && isValid(node)) {
                this.module.assets.destroyNode(node);
            }
            if (policy.cache !== 'asset' && (!nodeFromCache || policy.cache === 'node')) {
                this.module.assets.release(ref);
            }
            throw error;
        }
    }

    private async enqueueOpen<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data: TData | undefined,
        options: OpenViewOptions,
        policy: ResolvedViewPolicy,
        key: string,
    ): Promise<ViewHandle<TResult>> {
        const previous = this.queueTasks.get(policy.layer) ?? Promise.resolve();
        const token = this.createOpenToken(policy.layer, key, ref.path);
        let resolveOpened!: (handle: ViewHandle<TResult>) => void;
        let rejectOpened!: (error: unknown) => void;
        const opened = new Promise<ViewHandle<TResult>>((resolve, reject) => {
            resolveOpened = resolve;
            rejectOpened = reject;
        });

        const task = previous
            .catch(() => undefined)
            .then(async () => {
                try {
                    this.ensureOpenAllowed(token);
                    const handle = await this.openImmediate(ref, data, options, policy, token);
                    resolveOpened(handle);
                    await handle.view.__yzforgeWaitResult();
                } catch (error) {
                    rejectOpened(error);
                }
            });

        const stored = task.then(() => undefined, () => undefined);
        this.queueTasks.set(policy.layer, stored);
        stored.then(() => {
            if (this.queueTasks.get(policy.layer) === stored) {
                this.queueTasks.delete(policy.layer);
            }
        });

        return await opened;
    }

    public async openForResult<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        options: OpenViewOptions = {},
    ): Promise<TResult | UiCancelResult> {
        try {
            const handle = await this.open(ref, data, options);
            return await handle.view.__yzforgeWaitResult();
        } catch (error) {
            if (isOpenCancelledError(error)) {
                return { cancelled: true, reason: (error as YZForgeError).code };
            }
            throw error;
        }
    }

    public async close<TResult>(
        target: ViewHandle<TResult> | ViewRef<unknown, TResult>,
        result?: TResult | UiCancelResult | unknown,
        options: CloseViewOptions = {},
    ): Promise<void> {
        const handle = this.resolveHandle(target);
        if (!handle || handle.state === ViewState.Closing || handle.state === ViewState.Disposed) {
            return;
        }
        if (!options.force) {
            const canClose = await handle.view.__yzforgeBeforeClose(result);
            if (canClose === false) {
                return;
            }
        }
        handle.state = ViewState.Closing;
        await handle.view.__yzforgeClose(result);
        this.handles.delete(handle);
        if (handle.policy.cache === 'node' && isValid(handle.node)) {
            this.cacheNode(handle);
        } else if (isValid(handle.node)) {
            this.module.assets.destroyNode(handle.node);
        } else if (handle.policy.cache === 'node') {
            this.module.assets.release(handle.ref);
        }
        if (handle.policy.cache === 'none') {
            this.module.assets.release(handle.ref);
        }
        handle.state = ViewState.Disposed;
        this.updatePopupMask();
    }

    public async closeLayer(
        layer: ViewLayer,
        reason?: unknown,
        options: CloseViewOptions = {},
    ): Promise<void> {
        this.cancelLayerOpens(layer);
        const handles = this.sortedHandles().filter((handle) => handle.layer === layer);
        for (const handle of handles.reverse()) {
            await this.close(handle, reason, options);
        }
    }

    public async closeOwned(reason?: unknown): Promise<void> {
        this.cancelLayerOpens();
        for (const handle of this.sortedHandles().reverse()) {
            if (handle.policy.closeWithOwner) {
                await this.close(handle, isUiCancelResult(reason) ? reason : { cancelled: true, reason }, { force: true });
            }
        }
    }

    public async dispose(reason?: unknown): Promise<void> {
        this.cancelLayerOpens();
        await this.closeOwned(reason);
        this.clearNodeCache();
        this.destroyPopupMask();
    }

    public async pauseOwned(): Promise<void> {
        this.cancelLayerOpens();
        for (const handle of this.sortedHandles()) {
            if (handle.state !== ViewState.Open) {
                continue;
            }
            if (handle.policy.pauseWithOwner) {
                handle.node.active = false;
                handle.state = ViewState.Paused;
            } else if (handle.policy.closeWithOwner) {
                await this.close(handle, { cancelled: true, reason: 'module_pause' }, { force: true });
            }
        }
        this.updatePopupMask();
    }

    public resumeOwned(): void {
        for (const handle of this.handles) {
            if (handle.state === ViewState.Paused) {
                handle.node.active = true;
                handle.state = ViewState.Open;
            }
        }
        this.updatePopupMask();
    }

    public async back(): Promise<boolean> {
        const last = this.sortedHandles().reverse().find((handle) => handle.state === ViewState.Open && handle.policy.closeOnBack);
        if (!last) {
            return false;
        }
        await this.close(last, { cancelled: true, reason: 'back' });
        return true;
    }

    public snapshots(): ViewSnapshot[] {
        return this.sortedHandles().map((handle) => ({
            id: handle.id,
            key: handle.key,
            path: handle.ref.path,
            owner: handle.owner.name,
            kind: handle.policy.kind,
            layer: handle.layer,
            state: handle.state,
            modal: handle.policy.modal,
            closeOnBack: handle.policy.closeOnBack,
        }));
    }

    public top(): ViewHandle | undefined {
        return this.sortedHandles().reverse().find((handle) => handle.state === ViewState.Open);
    }

    private async resolveDuplicate<TData, TResult>(
        duplicate: AnyViewHandle,
        ref: ViewRef<TData, TResult>,
        data: TData | undefined,
        options: OpenViewOptions,
        policy: ResolvedViewPolicy,
    ): Promise<ViewHandle<TResult>> {
        const mode = options.duplicate ?? policy.duplicate;
        if (mode === 'reject') {
            throw new YZForgeError(`View is already open: ${ref.path}`, 'ui.view_duplicate_rejected');
        }
        if (mode === 'reopen') {
            await this.close(duplicate, { cancelled: true, reason: 'reopen' }, { force: true });
            return await this.open(ref, data, { ...options, duplicate: 'reject' });
        }
        this.focus(duplicate);
        return duplicate as ViewHandle<TResult>;
    }

    private async resolvePendingDuplicate<TData, TResult>(
        pending: Promise<AnyViewHandle>,
        ref: ViewRef<TData, TResult>,
        data: TData | undefined,
        options: OpenViewOptions,
        policy: ResolvedViewPolicy,
        key: string,
    ): Promise<ViewHandle<TResult>> {
        const mode = options.duplicate ?? policy.duplicate;
        if (mode === 'reject') {
            throw new YZForgeError(`View is already opening: ${ref.path}`, 'ui.view_duplicate_rejected');
        }
        if (mode === 'reopen') {
            this.cancelKeyOpen(key);
            this.pendingOpens.delete(key);
            return await this.open(ref, data, { ...options, duplicate: 'reject' });
        }
        const handle = await pending as ViewHandle<TResult>;
        this.focus(handle);
        return handle;
    }

    private resolvePolicy(ref: ViewRef, options: OpenViewOptions): ResolvedViewPolicy {
        const rawKind = options.policy?.kind ?? ref.policy.kind ?? ViewKind.Page;
        const kind = this.normalizeKind(rawKind);
        const defaults = DEFAULT_POLICY_BY_KIND[kind];
        const merged = {
            ...defaults,
            ...ref.policy,
            ...options.policy,
            kind,
        };
        const layer = merged.layer !== undefined ? merged.layer as ViewLayer : defaults.layer;
        return {
            kind,
            layer,
            stack: this.normalizeStack(merged.stack, defaults.stack),
            modal: Boolean(merged.modal),
            mask: merged.mask ?? defaults.mask,
            duplicate: options.duplicate ?? merged.duplicate ?? defaults.duplicate,
            closeOnBack: merged.closeOnBack ?? defaults.closeOnBack,
            closeOnMask: options.closeOnMask ?? defaults.closeOnMask,
            closeWithOwner: merged.closeWithOwner ?? defaults.closeWithOwner,
            pauseWithOwner: merged.pauseWithOwner ?? defaults.pauseWithOwner,
            cache: merged.cache ?? defaults.cache,
        };
    }

    private normalizeKind(value: unknown): ViewKind {
        return VIEW_KINDS.indexOf(value as ViewKind) >= 0 ? value as ViewKind : ViewKind.Page;
    }

    private normalizeStack(value: unknown, fallback: ViewStackMode): ViewStackMode {
        return VIEW_STACK_MODES.indexOf(value as ViewStackMode) >= 0 ? value as ViewStackMode : fallback;
    }

    private viewKey(ref: ViewRef, options: OpenViewOptions): string {
        return `${ref.path}::${options.key ?? 'default'}`;
    }

    private findDuplicate(ref: ViewRef, key: string): AnyViewHandle | undefined {
        return this.sortedHandles().reverse().find((handle) => {
            return handle.ref === ref && handle.key === key && handle.state !== ViewState.Closing && handle.state !== ViewState.Disposed;
        });
    }

    private focus(handle: AnyViewHandle): void {
        if (isValid(handle.node) && handle.node.parent) {
            handle.node.setSiblingIndex(handle.node.parent.children.length - 1);
        }
        if (this.handles.delete(handle)) {
            this.handles.add(handle);
        }
        if (handle.layer === ViewLayer.Popup) {
            this.updatePopupMask();
        }
    }

    private sortedHandles(): AnyViewHandle[] {
        return Array.from(this.handles);
    }

    private createOpenToken(layer: ViewLayer, key: string, path: string): OpenToken {
        return {
            key,
            layer,
            path,
            keyVersion: this.keyVersion(key),
            layerVersion: this.layerVersion(layer),
        };
    }

    private ensureOpenAllowed(token: OpenToken): void {
        if (this.keyVersion(token.key) !== token.keyVersion || this.layerVersion(token.layer) !== token.layerVersion) {
            throw new YZForgeError(`View open was cancelled: ${token.path}`, 'ui.view_open_cancelled', {
                key: token.key,
                layer: token.layer,
            });
        }
    }

    private keyVersion(key: string): number {
        return this.keyVersions.get(key) ?? 0;
    }

    private layerVersion(layer: ViewLayer): number {
        return this.layerVersions.get(layer) ?? 0;
    }

    private cancelKeyOpen(key: string): void {
        this.keyVersions.set(key, this.keyVersion(key) + 1);
    }

    private cancelLayerOpens(layer?: ViewLayer): void {
        const layers = layer !== undefined ? [layer] : VIEW_LAYERS;
        for (const item of layers) {
            this.layerVersions.set(item, this.layerVersion(item) + 1);
        }
    }

    private takeCachedNode(key: string): Node | undefined {
        const cached = this.nodeCache.get(key);
        if (!cached) {
            return undefined;
        }
        this.nodeCache.delete(key);
        if (isValid(cached.node)) {
            return cached.node;
        }
        this.module.assets.release(cached.ref);
        return undefined;
    }

    private cacheNode(handle: AnyViewHandle): void {
        const existing = this.nodeCache.get(handle.key);
        if (existing && existing.node !== handle.node) {
            this.destroyCachedNode(existing);
        }
        handle.node.removeFromParent();
        handle.node.active = false;
        this.nodeCache.set(handle.key, {
            node: handle.node,
            ref: handle.ref,
        });
    }

    private clearNodeCache(): void {
        for (const cached of Array.from(this.nodeCache.values())) {
            this.destroyCachedNode(cached);
        }
        this.nodeCache.clear();
    }

    private destroyCachedNode(cached: CachedNodeRecord): void {
        if (isValid(cached.node)) {
            this.module.assets.destroyNode(cached.node);
        }
        this.module.assets.release(cached.ref);
    }

    private updatePopupMask(): void {
        const popup = this.sortedHandles().reverse().find((handle) => {
            return handle.layer === ViewLayer.Popup
                && handle.policy.modal
                && handle.policy.mask !== 'none'
                && (handle.state === ViewState.Open || handle.state === ViewState.Opening);
        });

        if (!popup) {
            this.destroyPopupMask();
            return;
        }

        const root = this.resolveRoot(ViewLayer.Popup);
        if (!root) {
            return;
        }

        const maskKind = popup.policy.mask === 'transparent' ? 'transparent' : 'dim';
        const mask = this.ensurePopupMask(root, maskKind);
        this.maskTarget = popup;
        if (mask.parent !== root) {
            root.addChild(mask);
        }
        const popupIndex = popup.node.parent === root ? popup.node.getSiblingIndex() : root.children.length;
        mask.setSiblingIndex(Math.max(0, popupIndex - 1));
        mask.active = true;
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
            const target = this.maskTarget;
            if (target?.policy.closeOnMask) {
                void this.close(target, { cancelled: true, reason: 'mask' });
            }
        });
        root.addChild(mask);
        this.popupMask = mask;
        this.redrawPopupMask(mask, maskKind);
        return mask;
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

    private destroyPopupMask(): void {
        this.maskTarget = undefined;
        if (this.popupMask && isValid(this.popupMask)) {
            this.popupMask.destroy();
        }
        this.popupMask = undefined;
    }

    private resolveLayer(ref: ViewRef): ViewLayer {
        return this.resolvePolicy(ref, {}).layer;
    }

    private resolveRoot(layer: ViewLayer): Node | undefined {
        const configured = this.roots[layer];
        if (configured && isValid(configured)) {
            return configured;
        }
        const scene = director.getScene();
        if (!scene) {
            return undefined;
        }
        return findChildByName(scene, LAYER_NODE_NAMES[layer]);
    }

    private resolveHandle(target: AnyViewHandle | ViewRef): AnyViewHandle | undefined {
        if ('id' in target) {
            return target;
        }
        return this.sortedHandles().reverse().find((handle) => handle.ref === target);
    }
}

function findChildByName(root: Node, name: string): Node | undefined {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findChildByName(child, name);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function stopKeyboardEvent(event: EventKeyboard): void {
    event.propagationStopped = true;
    event.propagationImmediateStopped = true;
    event.rawEvent?.preventDefault();
}

function isOpenCancelledError(error: unknown): error is YZForgeError {
    return error instanceof YZForgeError && error.code === 'ui.view_open_cancelled';
}

function parseAutoRefName(name: string): string | undefined {
    const match = /^@([A-Za-z_$][\w$]*)(?::[A-Za-z_$][\w$.]*)?$/.exec(name);
    return match ? match[1] : undefined;
}

function findAutoRefNode(root: Node, key: string): Node | undefined {
    if (parseAutoRefName(root.name) === key) {
        return root;
    }
    for (const child of root.children) {
        const found = findAutoRefNode(child, key);
        if (found) {
            return found;
        }
    }
    return undefined;
}

export function bindAutoRefNode(root: Node, key: string): Node {
    const node = findAutoRefNode(root, key);
    if (!node) {
        throw new YZForgeError(`AutoRef node not found: ${key}`, 'ui.autoref_node_missing');
    }
    return node;
}

export function bindAutoRefComponent<TComponent extends Component>(
    root: Node,
    key: string,
    type: ComponentType<TComponent>,
): TComponent {
    const node = bindAutoRefNode(root, key);
    const component = node.getComponent(type);
    if (!component) {
        throw new YZForgeError(`AutoRef component not found: ${key}`, 'ui.autoref_component_missing');
    }
    return component;
}

export abstract class View<TData = unknown, TResult = unknown> extends Component {
    private ownerModule?: Module;
    private viewHandle?: ViewHandle<TResult>;
    private resultPromise?: Promise<TResult | UiCancelResult>;
    private resultResolver?: (value: TResult | UiCancelResult) => void;
    private resultResolved = false;
    private readonly disposers: Array<() => void> = [];
    private refsBound = false;

    public get module(): Module {
        if (!this.ownerModule) {
            throw new YZForgeError('View is not bound to a module.', 'ui.view_context_missing');
        }
        return this.ownerModule;
    }

    public get handle(): ViewHandle<TResult> {
        if (!this.viewHandle) {
            throw new YZForgeError('View is not bound to a handle.', 'ui.view_handle_missing');
        }
        return this.viewHandle;
    }

    public __yzforgeBind(module: Module, handle: ViewHandle<TResult>): void {
        this.ownerModule = module;
        this.viewHandle = handle;
        this.resultResolved = false;
        this.resultPromise = new Promise<TResult | UiCancelResult>((resolve) => {
            this.resultResolver = resolve;
        });
    }

    public async __yzforgeBeforeOpen(data: TData | undefined): Promise<void> {
        this.__yzforgeBindRefs();
        await this.beforeOpen(data as TData);
    }

    public async __yzforgeOpen(data: TData | undefined): Promise<void> {
        await this.onOpen(data as TData);
    }

    public async __yzforgeBeforeClose(reason: unknown): Promise<boolean | void> {
        return await this.beforeClose(reason);
    }

    public async __yzforgeClose(result: unknown): Promise<void> {
        await this.onClose(result as TResult);
        if (!this.resultResolved) {
            this.resultResolved = true;
            this.resultResolver?.(isUiCancelResult(result) ? result : result as TResult);
        }
        this.resultResolver = undefined;
        for (const disposer of this.disposers.splice(0).reverse()) {
            disposer();
        }
        this.onDispose();
    }

    public async __yzforgeWaitResult(): Promise<TResult | UiCancelResult> {
        if (!this.resultPromise) {
            return { cancelled: true, reason: 'view_not_bound' };
        }
        return await this.resultPromise;
    }

    protected close(result?: TResult): Promise<void> {
        return this.handle.close(result);
    }

    protected cancel(reason?: unknown): Promise<void> {
        return this.handle.cancel(reason);
    }

    protected addDisposer(disposer: () => void): void {
        this.disposers.push(disposer);
    }

    protected listen<TNode extends Node>(
        node: TNode,
        type: string,
        callback: (...args: unknown[]) => void,
        target?: unknown,
    ): void {
        const eventNode = node as unknown as {
            on(eventType: string, cb: (...args: unknown[]) => void, thisArg?: unknown): void;
            off(eventType: string, cb: (...args: unknown[]) => void, thisArg?: unknown): void;
        };
        eventNode.on(type, callback, target);
        this.addDisposer(() => eventNode.off(type, callback, target));
    }

    protected beforeOpen(_data: TData): MaybePromise<void> {}
    protected onOpen(_data: TData): MaybePromise<void> {}
    protected beforeClose(_reason: unknown): MaybePromise<boolean | void> {}
    protected onClose(_result: TResult | undefined): MaybePromise<void> {}
    protected onDispose(): void {}
    protected onBindRefs(): void {}

    private __yzforgeBindRefs(): void {
        if (this.refsBound) {
            return;
        }
        this.refsBound = true;
        this.onBindRefs();
    }
}

export abstract class Part<TData = unknown> extends Component {
    private refsBound = false;

    public async __yzforgeInit(data: TData): Promise<void> {
        this.__yzforgeBindRefs();
        await this.init(data);
    }

    public async init(_data: TData): Promise<void> {}
    public dispose(): void {}
    protected onBindRefs(): void {}

    private __yzforgeBindRefs(): void {
        if (this.refsBound) {
            return;
        }
        this.refsBound = true;
        this.onBindRefs();
    }
}
