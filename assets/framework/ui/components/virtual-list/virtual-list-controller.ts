import { type ErrorReporter, FrameworkError, invariant, OperationCancelled, reportError } from '../../../core/errors';
import { type Lifetime, runTask, Scope, type TaskContext, taskContext } from '../../../core/scope';
import {
    FixedVirtualLayout,
    type VirtualListAlignment,
    type VirtualListLayout,
    type VirtualListRange,
} from './virtual-list-layout';

/** 条目的一次数据绑定。复用、刷新、移出窗口或列表关闭都会使旧上下文失效。 */
export interface VirtualListItemContext<T> extends TaskContext {
    /** 本次绑定的零基索引；不能保存为条目永久身份。 */
    readonly index: number;
    /** 本次数据引用；框架不会深复制，建议传入不可变业务模型。 */
    readonly data: T;
    /**
     * 登记异步工作；复用会等待其退出，await 后用本次 task.commit 更新节点。
     * @param work 接收本次绑定的任务上下文；应响应 signal，调用方必须处理拒绝。
     * @returns 业务任务的结果。
     */
    run<R>(work: (task: TaskContext) => R | Promise<R>): Promise<R>;
}

/** 只读诊断，不持有节点和业务数据。 */
export interface VirtualListSnapshot {
    /** 数据总数。 */
    readonly count: number;
    /** 包含预备行的目标窗口。 */
    readonly range: VirtualListRange;
    /** 实例总数，包括加载中和等待旧工作退出的实例。 */
    readonly slots: number;
    /** 正在加载、渲染或清理的操作数；不包含未触发回收的 item.run。 */
    readonly pending: number;
    /** 已分配绑定的索引，按升序排列；异步渲染可能尚未显示。 */
    readonly indices: readonly number[];
}

/** @internal 引擎适配端口；create 必须把实例销毁登记到传入的所有者。 */
export interface VirtualListAdapter<T, Item> {
    create(owner: Lifetime): Promise<Item>;
    place(item: Item, index: number, layout: FixedVirtualLayout): void;
    render(item: Item, context: VirtualListItemContext<T>): void | Promise<void>;
    activate(item: Item): void;
    /** 必须同步隐藏并禁止新激活，返回旧 Part 工作的退出屏障。 */
    deactivate(item: Item): Promise<void>;
}
type Request<T> = { index: number; data: T };
type Slot<T, Item> = {
    scope: Scope;
    item?: Item;
    request?: Request<T>;
    binding?: Scope;
    state: 'idle' | 'loading' | 'bound' | 'draining' | 'destroying';
};

/**
 * @internal 无引擎依赖的复用调度器。实例上限由视口决定；慢任务退出前可能暂时留空，绝不无限创建补位节点。
 */
export class VirtualListController<T, Item> {
    readonly scope: Scope;
    layout: FixedVirtualLayout;
    private data: readonly T[] = [];
    private viewport = 0;
    private offset = 0;
    private requests = new Map<number, Request<T>>();
    private readonly failed = new Set<Request<T>>();
    private readonly slots = new Set<Slot<T, Item>>();
    private readonly pending = new Set<Promise<void>>();
    private readonly closingFailures: unknown[] = [];
    private pumping = false;
    private again = false;

    constructor(
        owner: Lifetime,
        layout: VirtualListLayout,
        private readonly adapter: VirtualListAdapter<T, Item>,
        private readonly report: ErrorReporter = reportError,
    ) {
        this.layout = new FixedVirtualLayout(layout);
        this.scope = owner.child('virtual-list');
        this.scope.signal.onAbort(() => {
            this.requests.clear();
            for (const slot of this.slots) this.retire(slot);
        });
        this.scope.defer(async () => {
            await this.whenIdle();
            this.slots.clear();
            this.data = [];
            const failures = this.closingFailures.splice(0);
            if (failures.length)
                throw new FrameworkError('VIRTUAL_LIST_CLEANUP_FAILED', '虚拟列表条目清理失败', { failures });
        });
    }
    setItems(items: readonly T[]): void {
        this.scope.signal.throwIfAborted();
        this.data = items.slice();
        this.requests.clear();
        this.updateRequests();
    }
    setLayout(layout: VirtualListLayout): void {
        this.scope.signal.throwIfAborted();
        this.layout = new FixedVirtualLayout(layout);
        this.updateRequests();
    }
    setViewport(height: number, offset: number): void {
        this.scope.signal.throwIfAborted();
        invariant(
            Number.isFinite(height) && height >= 0 && Number.isFinite(offset),
            'VIRTUAL_LIST_VIEWPORT',
            '视口高度和偏移必须为有效数值',
        );
        this.viewport = height;
        this.offset = offset;
        this.updateRequests();
    }
    refresh(indices?: Iterable<number>): void {
        this.scope.signal.throwIfAborted();
        if (indices === undefined) this.requests.clear();
        else {
            const checked = Array.from(indices);
            for (const index of checked) this.checkIndex(index);
            for (const index of checked) this.requests.delete(index);
        }
        this.updateRequests();
    }
    updateItem(index: number, data: T): void {
        this.scope.signal.throwIfAborted();
        this.checkIndex(index);
        (this.data as T[])[index] = data;
        this.refresh([index]);
    }
    get count(): number {
        return this.data.length;
    }
    get contentHeight(): number {
        return Math.max(this.viewport, this.layout.height(this.count));
    }
    get scrollOffset(): number {
        return this.layout.clampOffset(this.count, this.viewport, this.offset);
    }
    scrollTarget(index: number, alignment: VirtualListAlignment): number {
        this.checkIndex(index);
        invariant(
            ['start', 'center', 'end', 'nearest'].includes(alignment),
            'VIRTUAL_LIST_ALIGNMENT',
            '未知滚动定位方式',
        );
        return this.layout.offset(this.count, this.viewport, index, alignment, this.scrollOffset);
    }
    inspect(): VirtualListSnapshot {
        return Object.freeze({
            count: this.count,
            range: Object.freeze(this.layout.range(this.count, this.viewport, this.offset)),
            slots: this.slots.size,
            pending: this.pending.size,
            indices: Object.freeze(
                Array.from(this.slots)
                    .filter((slot) => slot.state === 'bound')
                    .map((slot) => slot.request!.index)
                    .sort((a, b) => a - b),
            ),
        });
    }
    async whenIdle(): Promise<void> {
        while (this.pending.size) await Promise.all(Array.from(this.pending));
    }
    dispose(): Promise<void> {
        return this.scope.close();
    }
    private checkIndex(index: number): void {
        invariant(
            Number.isInteger(index) && index >= 0 && index < this.count,
            'VIRTUAL_LIST_INDEX',
            `索引越界：${index} / ${this.count}`,
        );
    }
    private updateRequests(): void {
        this.offset = this.scrollOffset;
        const range = this.layout.range(this.count, this.viewport, this.offset);
        const next = new Map<number, Request<T>>();
        for (let index = range.start; index < range.end; index++)
            next.set(index, this.requests.get(index) ?? { index, data: this.data[index] });
        this.requests = next;
        for (const request of this.failed) if (next.get(request.index) !== request) this.failed.delete(request);
        this.pump();
    }
    private current(request: Request<T>): boolean {
        return !this.scope.signal.aborted && this.requests.get(request.index) === request;
    }
    private pump(): void {
        if (this.scope.signal.aborted) return;
        if (this.pumping) {
            this.again = true;
            return;
        }
        this.pumping = true;
        try {
            do {
                this.again = false;
                const capacity = this.layout.capacity(this.count, this.viewport);
                for (const slot of this.slots) {
                    if (slot.request && !this.current(slot.request)) this.retire(slot);
                    if (
                        slot.state === 'idle' &&
                        Array.from(this.slots).filter((item) => item.state !== 'destroying').length > capacity
                    )
                        this.destroy(slot);
                }
                const claimed = new Set(Array.from(this.slots, (slot) => slot.request));
                for (const request of this.requests.values()) {
                    if (claimed.has(request) || this.failed.has(request)) continue;
                    let slot = Array.from(this.slots).find((slot) => slot.state === 'idle');
                    if (!slot) {
                        if (this.slots.size >= capacity) break;
                        slot = { scope: this.scope.child('slot'), state: 'idle' };
                        this.slots.add(slot);
                    }
                    slot.request = request;
                    if (!slot.item) this.create(slot, request);
                    else this.bind(slot, request);
                }
                for (const slot of this.slots)
                    if (slot.state === 'bound') this.adapter.place(slot.item!, slot.request!.index, this.layout);
            } while (this.again && !this.scope.signal.aborted);
        } finally {
            this.pumping = false;
        }
    }
    private create(slot: Slot<T, Item>, request: Request<T>): void {
        slot.state = 'loading';
        this.watch(
            runTask(
                slot.scope,
                async () => {
                    slot.item = await this.adapter.create(slot.scope.lifetime);
                    slot.request = undefined;
                    slot.state = 'idle';
                },
                undefined,
                'virtual-list:create',
            ).catch((error) => {
                this.fail(request, error);
                this.destroy(slot);
            }),
        );
    }
    private bind(slot: Slot<T, Item>, request: Request<T>): void {
        const binding = slot.scope.child(`item:${request.index}`);
        slot.binding = binding;
        slot.state = 'bound';
        const current = () => slot.binding === binding && this.current(request);
        const context: VirtualListItemContext<T> = Object.freeze({
            ...taskContext(binding, current),
            index: request.index,
            data: request.data,
            run: <R>(work: (task: TaskContext) => R | Promise<R>) =>
                runTask(binding, work, current, 'virtual-list:item'),
        });
        this.watch(
            runTask(
                binding,
                async () => {
                    this.adapter.place(slot.item!, request.index, this.layout);
                    await this.adapter.render(slot.item!, context);
                    context.commit(() => this.adapter.activate(slot.item!));
                },
                current,
                'virtual-list:render',
            ).catch((error) => {
                this.fail(request, error);
                this.retire(slot);
            }),
        );
    }
    private retire(slot: Slot<T, Item>): void {
        slot.request = undefined;
        if (slot.state !== 'bound') return;
        slot.state = 'draining';
        const binding = slot.binding!;
        slot.binding = undefined;
        // 先登记到实例父 Scope，再发取消。父级关闭时须等待异步清理完成，
        // 避免 binding 与托管预制体这两个兄弟 Scope 并行关闭而提前销毁节点。
        // 预先登记也覆盖取消监听重入 dispose 的情况。
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.watch(slot.scope.track(barrier, 'virtual-list:retire'));
        binding.cancel();
        let deactivation: Promise<void>;
        try {
            deactivation = this.adapter.deactivate(slot.item!);
        } catch (error) {
            deactivation = Promise.reject(error);
        }
        void Promise.allSettled([binding.close(), deactivation])
            .then((results) => {
                const failures = results.filter((result) => result.status === 'rejected');
                if (failures.length) {
                    for (const failure of failures) this.reportCleanup(failure.reason);
                    this.destroy(slot);
                } else slot.state = 'idle';
            })
            .catch(this.report)
            .finally(release);
    }
    private destroy(slot: Slot<T, Item>): void {
        if (slot.state === 'destroying') return;
        slot.state = 'destroying';
        slot.request = undefined;
        this.watch(
            slot.scope
                .close()
                .catch((error: unknown) => this.reportCleanup(error))
                .then(() => {
                    this.slots.delete(slot);
                }),
        );
    }
    private reportCleanup(error: unknown): void {
        this.report(error);
        // 回收已自行关闭的子 Scope 可能先从父级移除。关闭期间保留失败，
        // 等所有节点释放后再交给列表 Scope 汇总，不能只上报而成功返回 dispose。
        if (this.scope.signal.aborted) this.closingFailures.push(error);
    }
    private fail(request: Request<T>, error: unknown): void {
        if (this.current(request)) this.failed.add(request);
        if (!(error instanceof OperationCancelled)) this.report(error);
    }
    private watch(work: Promise<void>): void {
        const pending = work.catch(this.report).then(() => {
            this.pending.delete(pending);
            this.pump();
        });
        this.pending.add(pending);
    }
}
