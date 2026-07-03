import { Component, isValid, Node } from 'cc';
import { YZForgeError } from './errors';
import type { Module } from './module';
import type { ViewRef } from './refs';
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
}

export interface ViewHandle<TResult = unknown> {
    readonly id: string;
    readonly ref: ViewRef<unknown, TResult>;
    readonly node: Node;
    readonly view: View<unknown, TResult>;
    readonly owner: Module;
    state: ViewState;
    close(result?: TResult): Promise<void>;
    cancel(reason?: unknown): Promise<void>;
}

export function isUiCancelResult(value: unknown): value is UiCancelResult {
    return Boolean(value) && typeof value === 'object' && (value as UiCancelResult).cancelled === true;
}

let nextViewId = 0;
type AnyViewHandle = ViewHandle<any>;

export class UIManager {
    private readonly moduleUis = new Map<string, ModuleUI>();

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
}

export class ModuleUI {
    private readonly handles = new Set<AnyViewHandle>();

    public constructor(
        private readonly module: Module,
        private readonly roots: Partial<Record<ViewLayer, Node>>,
    ) {}

    public async open<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        _options: OpenViewOptions = {},
    ): Promise<ViewHandle<TResult>> {
        const node = await this.module.assets.instantiate(ref);
        const component = node.getComponent(ref.component);
        if (!component) {
            node.destroy();
            throw new YZForgeError(`View prefab does not contain component: ${ref.path}`, 'ui.view_component_missing');
        }

        const view = component as View<TData, TResult>;
        const id = `view-${++nextViewId}`;
        const handle: ViewHandle<TResult> = {
            id,
            ref: ref as unknown as ViewRef<unknown, TResult>,
            node,
            view: view as unknown as View<unknown, TResult>,
            owner: this.module,
            state: ViewState.Loading,
            close: async (result?: TResult) => this.close(handle, result),
            cancel: async (reason?: unknown) => this.close(handle, { cancelled: true, reason }),
        };

        view.__yzforgeBind(this.module, handle);
        handle.state = ViewState.Opening;
        await view.__yzforgeBeforeOpen(data);
        const layer = this.resolveLayer(ref);
        const root = this.roots[layer];
        if (root) {
            root.addChild(node);
        }
        handle.state = ViewState.Open;
        this.handles.add(handle as AnyViewHandle);
        await view.__yzforgeOpen(data);
        return handle;
    }

    public async openForResult<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        options: OpenViewOptions = {},
    ): Promise<TResult | UiCancelResult> {
        const handle = await this.open(ref, data, options);
        return await handle.view.__yzforgeWaitResult();
    }

    public async close<TResult>(
        target: ViewHandle<TResult> | ViewRef<unknown, TResult>,
        result?: TResult | UiCancelResult | unknown,
    ): Promise<void> {
        const handle = this.resolveHandle(target);
        if (!handle || handle.state === ViewState.Closing || handle.state === ViewState.Disposed) {
            return;
        }
        handle.state = ViewState.Closing;
        await handle.view.__yzforgeBeforeClose(result);
        await handle.view.__yzforgeClose(result);
        this.handles.delete(handle);
        if (isValid(handle.node)) {
            handle.node.destroy();
        }
        handle.state = ViewState.Disposed;
    }

    public async closeOwned(reason?: unknown): Promise<void> {
        for (const handle of Array.from(this.handles).reverse()) {
            await this.close(handle, isUiCancelResult(reason) ? reason : { cancelled: true, reason });
        }
    }

    public pauseOwned(): void {
        for (const handle of this.handles) {
            if (handle.state === ViewState.Open) {
                handle.node.active = false;
                handle.state = ViewState.Paused;
            }
        }
    }

    public resumeOwned(): void {
        for (const handle of this.handles) {
            if (handle.state === ViewState.Paused) {
                handle.node.active = true;
                handle.state = ViewState.Open;
            }
        }
    }

    public async back(): Promise<boolean> {
        const last = Array.from(this.handles).reverse().find((handle) => handle.state === ViewState.Open);
        if (!last) {
            return false;
        }
        await this.close(last, { cancelled: true, reason: 'back' });
        return true;
    }

    private resolveLayer(ref: ViewRef): ViewLayer {
        if (ref.policy.layer !== undefined) {
            return ref.policy.layer as ViewLayer;
        }
        if (ref.policy.kind === ViewKind.Popup) return ViewLayer.Popup;
        if (ref.policy.kind === ViewKind.Paper) return ViewLayer.Paper;
        if (ref.policy.kind === ViewKind.Toast) return ViewLayer.Toast;
        if (ref.policy.kind === ViewKind.Top) return ViewLayer.Top;
        if (ref.policy.kind === ViewKind.System) return ViewLayer.System;
        return ViewLayer.Page;
    }

    private resolveHandle(target: AnyViewHandle | ViewRef): AnyViewHandle | undefined {
        if ('id' in target) {
            return target;
        }
        return Array.from(this.handles).reverse().find((handle) => handle.ref === target);
    }
}

export abstract class View<TData = unknown, TResult = unknown> extends Component {
    private ownerModule?: Module;
    private viewHandle?: ViewHandle<TResult>;
    private resultResolver?: (value: TResult | UiCancelResult) => void;
    private readonly disposers: Array<() => void> = [];

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
    }

    public async __yzforgeBeforeOpen(data: TData | undefined): Promise<void> {
        await this.beforeOpen(data as TData);
    }

    public async __yzforgeOpen(data: TData | undefined): Promise<void> {
        await this.onOpen(data as TData);
    }

    public async __yzforgeBeforeClose(reason: unknown): Promise<void> {
        await this.beforeClose(reason);
    }

    public async __yzforgeClose(result: unknown): Promise<void> {
        await this.onClose(result as TResult);
        this.resultResolver?.(isUiCancelResult(result) ? result : result as TResult);
        this.resultResolver = undefined;
        for (const disposer of this.disposers.splice(0).reverse()) {
            disposer();
        }
        this.onDispose();
    }

    public async __yzforgeWaitResult(): Promise<TResult | UiCancelResult> {
        return await new Promise<TResult | UiCancelResult>((resolve) => {
            this.resultResolver = resolve;
        });
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
    protected beforeClose(_reason: unknown): MaybePromise<void> {}
    protected onClose(_result: TResult | undefined): MaybePromise<void> {}
    protected onDispose(): void {}
}

export abstract class Part<TData = unknown> extends Component {
    public async init(_data: TData): Promise<void> {}
    public dispose(): void {}
}
