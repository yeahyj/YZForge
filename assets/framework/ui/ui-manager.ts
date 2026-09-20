import { BlockInputEvents, instantiate, isValid, Node, UIOpacity, UITransform, Widget } from 'cc';
import { Assets, destroyNode } from '../assets/asset-manager';
import { AssetKey } from '../assets/asset-types';
import { untilCancelled } from '../core/cancellation';
import { ClockDriver, foregroundDeadline } from '../core/clock-driver';
import { ErrorReporter, FrameworkError, invariant, OperationCancelled, reportError } from '../core/errors';
import { GameComponent } from '../core/game-component';
import { runTask, Scope, taskContext, TaskContext } from '../core/scope';
import { ModuleContext, ModuleManager } from '../modules/module-manager';
import { TimeService } from '../time/time-service';
import { UIView, ViewShowContext } from './ui-view';

export interface ViewKey<Params = void, Result = void> {
    readonly id: string;
    readonly __params?: Params;
    readonly __result?: Result;
}
export type ViewResult<T> =
    | { readonly status: 'completed'; readonly value: T }
    | { readonly status: 'cancelled' }
    | { readonly status: 'failed'; readonly error: unknown; readonly cleanupPending: boolean };
export interface ViewHandle<T> {
    readonly id: string;
    readonly result: Promise<ViewResult<T>>;
    close(): Promise<void>;
}
export interface ViewDefinition {
    readonly id: string;
    readonly module: string;
    readonly prefab: AssetKey<'Prefab'>;
    readonly kind: 'page' | 'popup' | 'overlay' | 'toast' | 'loading';
    readonly cache?: 'none' | 'keep-one';
    readonly duplicate?: 'reject' | 'allow';
    readonly modal?: boolean;
}
type Instance = {
    node: Node;
    view: UIView<unknown, unknown>;
    components: GameComponent[];
    scope: Scope;
    context: ModuleContext;
    definition: ViewDefinition;
    disposed: boolean;
};
type RecordView = {
    id: number;
    definition: ViewDefinition;
    owner: Scope;
    operation: Scope;
    params: unknown;
    instance?: Instance;
    show?: ViewShowContext<unknown, unknown>;
    preparing: Promise<void>;
    closing?: Promise<void>;
    termination?: ViewResult<unknown>;
    published: boolean;
    interactive: boolean;
    suspended: boolean;
    result: Promise<ViewResult<unknown>>;
    resolve: (value: ViewResult<unknown>) => void;
    settled: boolean;
    detach: () => void;
    handle: ViewHandle<unknown>;
    faultPending: boolean;
    instanceDrained: Promise<void>;
    resolveDrained: () => void;
    unown: () => void;
};
const layerOrder = { page: 0, popup: 1, overlay: 2, toast: 3, loading: 4 };
export class UIManager {
    private readonly definitions = new Map<string, ViewDefinition>();
    private readonly records = new Map<number, RecordView>();
    private readonly cache = new Map<string, Instance>();
    private readonly blocked = new Set<string>();
    private readonly layers = new Map<ViewDefinition['kind'], Node>();
    private readonly pages: RecordView[] = [];
    private navigation: Promise<unknown> = Promise.resolve();
    private sequence = 0;
    private showing = 0;
    private accepting = true;
    constructor(
        private readonly root: Node,
        private readonly assets: Assets,
        private readonly modules: ModuleManager,
        private readonly time: TimeService,
        private readonly clock: ClockDriver,
        definitions: readonly ViewDefinition[],
        private readonly report: ErrorReporter = reportError,
        private readonly cleanupTimeoutMs = 10000,
    ) {
        for (const definition of definitions) {
            invariant(!this.definitions.has(definition.id), 'UI_DUPLICATE_ID', definition.id);
            this.definitions.set(definition.id, definition);
        }
        for (const kind of Object.keys(layerOrder) as ViewDefinition['kind'][]) {
            const node = new Node(kind);
            node.layer = root.layer;
            root.addChild(node);
            node.addComponent(UITransform);
            const widget = node.addComponent(Widget);
            widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
            widget.top = widget.bottom = widget.left = widget.right = 0;
            widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
            this.layers.set(kind, node);
        }
        modules.evictIdleViews = (id) => this.evictModule(id);
    }
    async open<P, R>(key: ViewKey<P, R>, params: P, owner: Scope): Promise<ViewHandle<R>> {
        owner.signal.throwIfAborted();
        invariant(this.accepting, 'APP_STOPPING', 'UI is shutting down');
        const definition = this.definitions.get(key.id);
        invariant(definition, 'UI_NOT_REGISTERED', key.id);
        this.modules.assertCanOpen(definition.module, owner);
        invariant(!this.blocked.has(key.id), 'UI_CLEANUP_PENDING', `A previous instance is still draining: ${key.id}`);
        invariant(
            definition.duplicate === 'allow' ||
                !Array.from(this.records.values()).some((record) => record.definition.id === key.id),
            'UI_ALREADY_OPEN',
            key.id,
        );
        const operation = new Scope(`ui:${key.id}`, this.report);
        let resolve!: (value: ViewResult<unknown>) => void;
        const result = new Promise<ViewResult<unknown>>((yes) => {
            resolve = yes;
        });
        let resolveDrained!: () => void;
        const instanceDrained = new Promise<void>((yes) => {
            resolveDrained = yes;
        });
        const record: RecordView = {
            id: ++this.sequence,
            definition,
            owner,
            operation,
            params: snapshotParams(params),
            preparing: Promise.resolve(),
            published: false,
            interactive: false,
            suspended: false,
            result,
            resolve,
            settled: false,
            detach: () => {},
            handle: undefined as unknown as ViewHandle<unknown>,
            faultPending: false,
            instanceDrained,
            resolveDrained,
            unown: () => {},
        };
        record.handle = Object.freeze({
            id: key.id,
            result,
            close: () => this.requestClose(record, { status: 'cancelled' }),
        });
        this.records.set(record.id, record);
        record.detach = owner.signal.onAbort(() => {
            void this.requestClose(record, { status: 'cancelled' }).catch(this.report);
        });
        record.unown = owner.defer(() => record.closing ?? this.requestClose(record, { status: 'cancelled' }));
        record.preparing = Promise.resolve().then(async () => {
            if (!this.modules.isInternalOwner(definition.module, owner))
                await this.modules.use({ id: definition.module }, operation);
            if (record.termination) throw new OperationCancelled();
            const context = this.modules.context(definition.module);
            let instance = this.cache.get(key.id);
            if (instance) {
                this.cache.delete(key.id);
                record.instance = instance;
            } else {
                const scope = new Scope(`view-instance:${key.id}`, this.report);
                try {
                    const prefab = await this.assets.load(definition.prefab, scope);
                    if (record.termination) throw new OperationCancelled();
                    const node = instantiate(prefab);
                    node.active = false;
                    scope.defer(() => destroyNode(node));
                    const view = node.getComponent(UIView) as UIView<unknown, unknown> | null;
                    invariant(view, 'UI_VIEW_MISSING', `${key.id} root requires a UIView`);
                    instance = {
                        node,
                        view,
                        scope,
                        context,
                        definition,
                        components: node.getComponentsInChildren(GameComponent),
                        disposed: false,
                    };
                    record.instance = instance;
                    view.__bind(context, (error) => {
                        void this.requestClose(record, { status: 'failed', error, cleanupPending: false }).catch(
                            this.report,
                        );
                    });
                    for (const component of instance.components) component.__bind(context, scope, this.time);
                    this.layers.get(definition.kind)!.addChild(node);
                    if ((definition.modal ?? definition.kind === 'popup') && !node.getComponent(BlockInputEvents))
                        node.addComponent(BlockInputEvents);
                    this.gate(instance, false);
                    node.active = true;
                    this.gate(instance, false);
                    // Cocos activates the whole subtree synchronously before this call returns.
                    await view.__create({ scope, ctx: context });
                } catch (error) {
                    if (!record.instance) await scope.close();
                    throw error;
                }
            }
            if (record.termination) return;
            await this.show(record);
        });
        void record.preparing.catch((error) => {
            if (error instanceof OperationCancelled && record.termination) return;
            void this.requestClose(record, { status: 'failed', error, cleanupPending: false }).catch(this.report);
        });
        try {
            await untilCancelled(
                Promise.race([
                    record.preparing,
                    result.then((value) => {
                        if (value.status === 'failed') throw value.error;
                    }),
                ]),
                owner.signal,
            );
            if (record.termination) {
                await result;
                if (record.termination.status === 'cancelled')
                    throw new OperationCancelled(`UI closed before opening: ${key.id}`);
                if (record.termination.status === 'failed') throw record.termination.error;
            }
            record.published = true;
            return record.handle as ViewHandle<R>;
        } catch (error) {
            if (!record.termination)
                void this.requestClose(record, {
                    status: error instanceof OperationCancelled ? 'cancelled' : 'failed',
                    error,
                    cleanupPending: false,
                } as ViewResult<unknown>).catch(this.report);
            throw error;
        }
    }
    private async show(record: RecordView): Promise<void> {
        const instance = record.instance!;
        const scope = instance.scope.child(`show:${++this.showing}`);
        const isCurrent = () => record.show === context && !record.termination && !record.suspended;
        const scopedAssets = instance.context.assets.in(scope);
        const context: ViewShowContext<unknown, unknown> = Object.freeze({
            ...taskContext(scope, isCurrent),
            showId: this.showing,
            params: record.params,
            time: this.time.in(scope),
            run: <T>(task: (task: TaskContext) => T | Promise<T>) => runTask(scope, task, isCurrent),
            listen: (node: Node, event: string, callback: (...args: unknown[]) => void | Promise<void>) => {
                scope.signal.throwIfAborted();
                const handler = (...args: unknown[]) => {
                    if (!isCurrent() || !record.interactive) return;
                    void runTask(scope, () => callback(...args), isCurrent).catch((error) => {
                        if (!(error instanceof OperationCancelled))
                            void this.requestClose(record, { status: 'failed', error, cleanupPending: false }).catch(
                                this.report,
                            );
                    });
                };
                node.on(event, handler);
                let detach = () => {};
                const off = () => {
                    if (isValid(node)) node.off(event, handler);
                    detach();
                };
                detach = scope.signal.onAbort(off);
                return off;
            },
            setSprite: (sprite, key) => runTask(scope, () => scopedAssets.setSprite(sprite, key), isCurrent),
            finish: (value) => {
                if (isCurrent() && !scope.signal.aborted)
                    void this.requestClose(record, { status: 'completed', value }).catch(this.report);
            },
        });
        record.show = context;
        record.suspended = false;
        instance.view.__bind(instance.context, (error) => {
            void this.requestClose(record, { status: 'failed', error, cleanupPending: false }).catch(this.report);
        });
        instance.node.active = true;
        this.gate(instance, false);
        await scope.track(Promise.resolve().then(() => instance.view.__show(context)));
        if (record.termination || scope.signal.aborted) return;
        record.interactive = true;
        this.gate(instance, true);
        instance.view.__interactive(context);
        for (const component of instance.components) component.__allow(scope);
        this.updateInput();
    }
    private requestClose(record: RecordView, outcome: ViewResult<unknown>): Promise<void> {
        if (record.settled) return record.closing ?? Promise.resolve();
        if (!record.termination || outcome.status === 'failed') record.termination = outcome;
        if (record.closing) return record.closing;
        record.interactive = false;
        if (record.instance) {
            this.gate(record.instance, false);
            record.instance.view.__interactive(undefined);
            for (const component of record.instance.components) component.__allow(undefined);
        }
        record.show?.scope.cancel();
        // Cancels an in-flight module wait without destroying an already delivered module API.
        record.operation.cancel();
        const stop = foregroundDeadline(this.clock, this.cleanupTimeoutMs, () => {
            record.faultPending = true;
            this.blocked.add(record.definition.id);
            this.modules.quarantine(record.definition.module, record.instanceDrained);
            record.termination = {
                status: 'failed',
                error: new FrameworkError('UI_CLEANUP_PENDING', `UI tasks have not drained: ${record.definition.id}`),
                cleanupPending: true,
            };
            this.settle(record);
            this.updateInput();
        });
        record.closing = Promise.resolve().then(async () => {
            try {
                await record.preparing.catch((error) => {
                    if (!(error instanceof OperationCancelled))
                        record.termination = { status: 'failed', error, cleanupPending: false };
                });
                if (record.instance) {
                    await this.hide(record, record.termination!.status);
                    const instance = record.instance;
                    if (
                        record.definition.cache === 'keep-one' &&
                        record.termination?.status !== 'failed' &&
                        !record.faultPending &&
                        this.modules.isReady(record.definition.module) &&
                        !this.cache.has(record.definition.id)
                    ) {
                        instance.node.active = false;
                        this.cache.set(record.definition.id, instance);
                    } else await this.dispose(instance);
                }
            } catch (error) {
                record.termination = { status: 'failed', error, cleanupPending: false };
                if (record.instance && !record.instance.disposed)
                    try {
                        await this.dispose(record.instance);
                    } catch (cleanup) {
                        this.report(cleanup);
                    }
            } finally {
                record.detach();
                record.unown();
                this.records.delete(record.id);
                record.resolveDrained();
                const pageIndex = this.pages.indexOf(record),
                    wasTop = pageIndex >= 0 && pageIndex === this.pages.length - 1;
                if (pageIndex >= 0) this.pages.splice(pageIndex, 1);
                // Remove active UI before the module's last demand can evict its idle cache.
                try {
                    await record.operation.close();
                } catch (error) {
                    record.termination = { status: 'failed', error, cleanupPending: false };
                }
                stop();
                this.blocked.delete(record.definition.id);
                this.settle(record);
                this.updateInput();
                if (wasTop && this.accepting) void this.navigate(() => this.resumeTop()).catch(this.report);
            }
        });
        return record.closing;
    }
    private async hide(record: RecordView, reason: 'completed' | 'cancelled' | 'failed' | 'suspended'): Promise<void> {
        const instance = record.instance!,
            show = record.show;
        record.interactive = false;
        this.gate(instance, false);
        instance.view.__interactive(undefined);
        for (const component of instance.components) component.__allow(undefined);
        if (!show) return;
        show.scope.cancel();
        const results = await show.scope.drainTasks();
        const fault = results.find(
            (result) => result.status === 'rejected' && !(result.reason instanceof OperationCancelled),
        ) as PromiseRejectedResult | undefined;
        if (fault) record.termination = { status: 'failed', error: fault.reason, cleanupPending: false };
        await Promise.all(instance.components.map((component) => component.__deactivate()));
        const hiding = instance.scope.child('hide');
        try {
            await instance.view.__hide({ reason, scope: hiding });
        } finally {
            await hiding.close();
            await show.scope.close();
            record.show = undefined;
        }
    }
    private settle(record: RecordView): void {
        if (record.settled) return;
        record.settled = true;
        record.resolve(record.termination ?? { status: 'cancelled' });
    }
    private gate(instance: Instance, visible: boolean): void {
        if (!isValid(instance.node, true)) return;
        const opacity = instance.node.getComponent(UIOpacity) ?? instance.node.addComponent(UIOpacity);
        opacity.opacity = visible ? 255 : 0;
        if (visible) instance.node.resumeSystemEvents(true);
        else instance.node.pauseSystemEvents(true);
    }
    private updateInput(): void {
        const active = Array.from(this.records.values())
            .filter((record) => record.interactive && !record.termination && !record.suspended)
            .sort((a, b) => layerOrder[a.definition.kind] - layerOrder[b.definition.kind] || a.id - b.id);
        let blocked = false;
        for (const record of active.reverse()) {
            if (blocked) record.instance!.node.pauseSystemEvents(true);
            else record.instance!.node.resumeSystemEvents(true);
            if (record.definition.modal ?? (record.definition.kind === 'popup' || record.definition.kind === 'loading'))
                blocked = true;
        }
    }
    private async dispose(instance: Instance): Promise<void> {
        if (instance.disposed) return;
        instance.disposed = true;
        try {
            instance.view.__dispose();
        } finally {
            await instance.scope.close();
        }
    }
    async evictModule(module: string): Promise<void> {
        for (const [id, instance] of Array.from(this.cache))
            if (instance.definition.module === module) {
                this.cache.delete(id);
                await this.dispose(instance);
            }
    }
    private navigate<T>(action: () => Promise<T>): Promise<T> {
        const next = this.navigation.then(action);
        this.navigation = next.catch(() => {});
        return next;
    }
    private async resumeTop(): Promise<void> {
        const record = this.pages[this.pages.length - 1];
        if (!record || record.termination || !record.suspended || !this.accepting) return;
        record.preparing = record.preparing.then(async () => {
            if (!record.termination && this.pages[this.pages.length - 1] === record) await this.show(record);
        });
        try {
            await record.preparing;
        } catch (error) {
            void this.requestClose(record, { status: 'failed', error, cleanupPending: false }).catch(this.report);
        }
    }
    pushPage<P, R>(key: ViewKey<P, R>, params: P, owner: Scope): Promise<ViewHandle<R>> {
        return this.navigate(() => this.pushPageNow(key, params, owner));
    }
    private async pushPageNow<P, R>(key: ViewKey<P, R>, params: P, owner: Scope): Promise<ViewHandle<R>> {
        invariant(this.definitions.get(key.id)?.kind === 'page', 'UI_NOT_PAGE', key.id);
        const previous = this.pages[this.pages.length - 1];
        const handle = await this.open(key, params, owner);
        const current = Array.from(this.records.values()).find((record) => record.handle === handle);
        if (!current || current.termination) return handle;
        if (previous && !previous.termination) {
            previous.suspended = true;
            previous.interactive = false;
            this.gate(previous.instance!, false);
            previous.instance!.view.__interactive(undefined);
            previous.show?.scope.cancel();
            // Do not wait here: the previous page's tracked click may itself be awaiting pushPage.
            previous.preparing = previous.preparing.then(async () => {
                await this.hide(previous, 'suspended');
                if (previous.instance && isValid(previous.instance.node, true)) previous.instance.node.active = false;
            });
            void previous.preparing.catch((error) => {
                void this.requestClose(previous, { status: 'failed', error, cleanupPending: false }).catch(this.report);
            });
        }
        this.pages.push(current);
        this.updateInput();
        return handle;
    }
    back(): Promise<void> {
        return this.navigate(async () => {
            const current = this.pages[this.pages.length - 1];
            if (current) await this.requestClose(current, { status: 'cancelled' });
            await this.resumeTop();
        });
    }
    async close(): Promise<void> {
        this.accepting = false;
        await Promise.all(
            Array.from(this.records.values()).map((record) => this.requestClose(record, { status: 'cancelled' })),
        );
        for (const instance of this.cache.values()) await this.dispose(instance);
        this.cache.clear();
        for (const node of this.layers.values()) await destroyNode(node);
    }
}
function snapshotParams<T>(value: T): T {
    if (Array.isArray(value)) return Object.freeze(value.map(snapshotParams)) as T;
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.freeze(
            Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshotParams(entry)])),
        ) as T;
    }
    return value; // Explicit callbacks and service references retain identity.
}
