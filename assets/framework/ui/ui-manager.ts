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

/**
 * 界面的公开类型合同，通常使用生成的 ModuleViews 常量；不直接导入界面私有组件或预制体。
 * @typeParam Params - 打开参数类型，默认 void。
 * @typeParam Result - show.finish 返回的业务结果类型，默认 void。
 */
export interface ViewKey<Params = void, Result = void> {
    /**
     * 全局界面 ID，必须在生成的 ViewDefinition 中登记。
     */
    readonly id: string;
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    readonly __params?: Params;
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    readonly __result?: Result;
}
/**
 * 界面最终结果的可判别联合：
 * - completed：界面调用 show.finish，value 为业务结果。
 * - cancelled：外部关闭、返回或所有者结束，没有业务结果。
 * - failed：error 为错误，cleanupPending 为 true 时只是逻辑结案，实际清理仍在进行。
 * 根据 status 分支后读取对应字段；不要把取消当成成功结果。
 */
export type ViewResult<T> =
    | {
          /**
           * 界面结案状态：completed 业务成功、cancelled 取消、failed 失败；先判断状态再读取对应字段。
           */
          readonly status: 'completed';
          /**
           * 界面通过 show.finish 提交的业务结果，仅 status 为 completed 时存在。
           */
          readonly value: T;
      }
    | {
          /**
           * 界面结案状态：completed 业务成功、cancelled 取消、failed 失败；先判断状态再读取对应字段。
           */
          readonly status: 'cancelled';
      }
    | {
          /**
           * 界面结案状态：completed 业务成功、cancelled 取消、failed 失败；先判断状态再读取对应字段。
           */
          readonly status: 'failed';
          /**
           * 界面准备、运行或清理中的错误，仅 status 为 failed 时存在。
           */
          readonly error: unknown;
          /**
           * 逻辑结果已报告但底层清理仍在进行时为 true；不能因此认定节点和资源已释放。
           */
          readonly cleanupPending: boolean;
      };
/**
 * 一次界面打开操作的句柄，用于观察结果或从外部关闭；与预制体实例和缓存条目不同。
 */
export interface ViewHandle<T> {
    /**
     * 界面定义的逻辑 ID，同一界面的多个允许并存实例共享此值；不是唯一实例编号。
     */
    readonly id: string;
    /**
     * 等待这次界面结束，而非等待打开完成。正常以 ViewResult 返回，业务成功、取消与失败通过 status 区分。
     * 通常在调用界面的外部等待；不要在该界面自己的 onShow、受跟踪点击回调或 onHide 中等待自身结果。
     * cleanupPending 为 true 时，底层清理尚未结束。
     */
    readonly result: Promise<ViewResult<T>>;
    /**
     * 从外部以 cancelled 结果请求关闭，可重复调用并等待实际清理。
     * @returns 本次关闭流程完成的 Promise，不承载业务返回值。
     * @remarks 界面内部提交成功结果用 show.finish；不要在自己的受跟踪任务中 await 自身 close，以免互相等待。
     */
    close(): Promise<void>;
}
/**
 * 工作台生成的界面装配描述，定义模块归属、预制体和 UI 策略；业务通过 ViewKey 使用。
 */
export interface ViewDefinition {
    /**
     * 唯一界面 ID，与 ViewKey.id 对应。
     */
    readonly id: string;
    /**
     * 宿主业务模块 ID，显示之前必须完成初始化。
     */
    readonly module: string;
    /**
     * 根节点带 UIView 的预制体资源键，由资源系统准备脚本和资源。
     */
    readonly prefab: AssetKey<'Prefab'>;
    /**
     * 界面层级，由低到高为 page 页面、popup 弹窗、overlay 覆盖层、toast 提示、loading 加载层。
     * Part 使用 GameComponent，由父对象组合，不登记为完整界面。
     */
    readonly kind: 'page' | 'popup' | 'overlay' | 'toast' | 'loading';
    /**
     * 实例缓存策略，默认 none；keep-one 最多保留一个已结束展示的闲置实例。
     * 缓存只复用节点，下一次展示仍有新的 show.scope；模块结束时缓存也会驱逐。
     */
    readonly cache?: 'none' | 'keep-one';
    /**
     * 同一界面并存策略，默认 reject；allow 允许多个打开实例，结果和展示 Scope 各自独立。
     */
    readonly duplicate?: 'reject' | 'allow';
    /**
     * 是否阻挡下层框架 UI 的输入。省略时 popup 和 loading 会阻挡，其他层默认不阻挡。
     * 节点本身的点击范围仍取决于预制体布局；不是全局系统输入拦截器。
     */
    readonly modal?: boolean;
}
/** 已发出的页面返回请求；本对象不是 Promise，页面点击回调发出请求后即可结束。 */
export interface NavigationRequest {
    /**
     * 外部协调器等待关闭和恢复完成的屏障；失败时拒绝。
     * 不在即将关闭页面自己的受跟踪任务中等待此属性，否则该页面仍会等待该任务退出。
     */
    readonly completed: Promise<void>;
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
/**
 * 统一管理完整 UI 的加载、模块持有、显示生命周期、输入层级、结果和页面栈。
 * 通过生成的 ViewKey 打开；界面内部只重写 UIView 的框架钩子。
 */
export class UIManager {
    /** 读取页面栈及实例清理状态；只返回诊断值，不暴露可修改的节点或内部记录。 */
    inspect() {
        return Object.freeze({
            pages: Object.freeze(this.pages.map((record) => record.definition.id)),
            cached: Object.freeze(Array.from(this.cache.keys())),
            views: Object.freeze(
                Array.from(this.records.values(), (record) =>
                    Object.freeze({
                        instanceId: record.id,
                        id: record.definition.id,
                        interactive: record.interactive,
                        suspended: record.suspended,
                        closing: !!record.closing,
                        cleanupPending: record.faultPending,
                        scope: record.instance?.scope.inspect() ?? record.operation.inspect(),
                    }),
                ),
            ),
        });
    }
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
    /**
     * @internal
     * 由 App 创建 UI 层并接入资源、模块及时间服务。
     * @param root - Canvas 下的 UI 根节点。
     * @param assets - 共享资源管理器。
     * @param modules - 模块业务及代码管理器。
     * @param time - 业务时间服务。
     * @param clock - 前台清理超时计时器。
     * @param definitions - 界面装配描述。
     * @param report - 异步错误上报器。
     * @param cleanupTimeoutMs - 清理超时毫秒数，默认 10000；超时隔离未完成实例，不强制释放。
     */
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
    /**
     * 加载并显示一个界面，等待 onCreate/onShow 就绪后返回句柄，不等待玩家关闭。
     * @param key - 生成的 ViewKey，决定参数及返回结果类型。
     * @param params - 打开参数；普通对象及数组递归复制、冻结，函数和类服务实例保留身份；不要传循环结构。
     * @param owner - 界面所有者，取消时关闭。子弹窗通常使用父界面的 show.scope。
     * @returns 打开句柄，通过 handle.result 另行等待业务结果；onShow 已 finish 时可能返回已结束句柄。
     * @throws FrameworkError 未登记、重复打开被禁止、绑定/初始化失败或上一实例仍异常清理；打开前取消会抛 OperationCancelled。
     * @remarks open 不自动维护页面返回栈，页面导航请用 pushPage。
     * @example
     * const popup = await this.ctx.ui.open(RewardViews.rewardPopup, params, show.scope);
     * const result = await popup.result;
     * if (result.status === "completed") {
     *     show.commit(() => this.renderReward(result.value));
     * }
     */
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
            assets: scopedAssets,
            config: instance.context.config.in(scope),
            audio: instance.context.audio.in(scope),
            showId: this.showing,
            params: record.params,
            time: this.time.in(scope),
            run: <T>(task: (task: TaskContext) => T | Promise<T>) => runTask(scope, task, isCurrent),
            listen: (
                node: Node,
                event: string,
                callback: (...args: unknown[]) => void | Promise<void>,
                onError?: (error: unknown) => void,
            ) => {
                scope.signal.throwIfAborted();
                const handler = (...args: unknown[]) => {
                    if (!isCurrent() || !record.interactive) return;
                    void runTask(scope, () => callback(...args), isCurrent, `event:${event}`).catch((error) => {
                        if (!(error instanceof OperationCancelled)) {
                            try {
                                (onError ?? this.report)(error);
                            } catch (handlerError) {
                                this.report(handlerError);
                            }
                        }
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
            dismiss: () => {
                if (isCurrent() && !scope.signal.aborted)
                    void this.requestClose(record, { status: 'cancelled' }).catch(this.report);
            },
            back: () => {
                if (isCurrent() && !scope.signal.aborted && this.pages[this.pages.length - 1] === record) this.back();
            },
        });
        record.show = context;
        record.suspended = false;
        instance.view.__bind(instance.context, (error) => {
            void this.requestClose(record, { status: 'failed', error, cleanupPending: false }).catch(this.report);
        });
        instance.node.active = true;
        this.gate(instance, false);
        await scope.track(
            Promise.resolve().then(() => instance.view.__show(context)),
            'onShow',
        );
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
    /**
     * @internal
     * 销毁指定模块的闲置 UI 缓存，不关闭它当前已打开的界面；模块清理时自动调用。
     */
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
    /**
     * 串行导航到 page 层界面，并把它压入页面栈；新页面打开后暂停前一页的展示。
     * @param key - kind 必须为 page 的 ViewKey。
     * @param params - 页面打开参数，快照规则与 open 相同。
     * @param owner - 页面所属导航会话；应覆盖该页的存活期，避免使用即将被暂停的上一页 show.scope。
     * @returns 新页面句柄，不等待页面结束或前一页全部清理完成。
     * @remarks 上一页暂停时结束旧 show.scope；返回后重新执行 onShow，并提供新的展示上下文。
     * @throws FrameworkError 目标不是页面或打开失败；取消错误与 open 一致。
     */
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
    /**
     * 串行关闭当前栈顶页面，然后恢复前一页；空栈时直接完成，只有一页时会关闭最后一页。
     * @returns 非 Promise 的请求句柄。按钮回调调用 back() 后即可结束；外部需要等待时使用 request.completed。
     * @example
     * show.listen(button.node, Button.EventType.CLICK, () => { this.ctx.ui.back(); });
     * // 外部流程：await app.ui.back().completed;
     */
    back(): NavigationRequest {
        const requested = this.pages[this.pages.length - 1];
        const completed = this.navigate(async () => {
            const current = this.pages[this.pages.length - 1];
            if (current !== requested) return; // 合并同一栈顶的重复返回请求，不关闭后来打开的页面。
            if (current) await this.requestClose(current, { status: 'cancelled' });
            await this.resumeTop();
        });
        void completed.catch(this.report);
        return Object.freeze({ completed });
    }
    /**
     * @internal
     * App 关停时停止接受新界面、关闭全部操作、销毁缓存及 UI 层节点。
     * @returns 所有界面及层节点实际清理完成后结束。
     */
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
