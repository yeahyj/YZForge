import { CancellationSource, CancellationSignal } from './cancellation';
import { ErrorReporter, FrameworkError, OperationCancelled, reportError } from './errors';
type Cleanup = () => void | Promise<void>;
/**
 * 借用一段使用期限：可以登记清理、创建自己拥有的子期限，但不能结束宿主。
 * show.scope、activation.scope、ctx.scope 均使用此接口。需要提前结束一组工作时，
 * 用 child 创建自己的 Scope；页面关闭使用 show.dismiss/finish/back。
 */
export interface Lifetime {
    /** 宿主结束时发出的取消信号。 */
    readonly signal: CancellationSignal;
    /** 为当前使用期登记清理；返回函数只撤销登记。 */
    defer(cleanup: Cleanup): () => void;
    /** 创建归调用方管理的子期限，可以单独 close。 */
    child(label: string): Scope;
    /** 读取诊断快照，不延长使用期。 */
    inspect(): ScopeSnapshot;
}
const owners = new WeakMap<Lifetime, Scope>();
/** @internal 将框架创建的借用入口还原为所有者，仅供框架执行关闭与任务屏障。 */
export function scopeOwner(lifetime: Lifetime): Scope {
    const owner = owners.get(lifetime);
    if (!owner) throw new FrameworkError('LIFETIME_INVALID', 'Use a framework lifetime');
    return owner;
}
/** 使用期限的只读诊断快照，不包含任务、节点或资源对象本身。 */
export interface ScopeSnapshot {
    /** 创建时的诊断名称。 */
    readonly label: string;
    /** active 可工作；cancelled 已取消；closing 正在等待；closed 已完成清理。 */
    readonly state: 'active' | 'cancelled' | 'closing' | 'closed';
    /** 尚未完成的任务名称；同名表示多个独立任务。 */
    readonly tasks: readonly string[];
    /** 尚未执行的清理回调数量，不等同于资源数量。 */
    readonly cleanupCount: number;
    /** 当前仍被持有的子期限，已完整关闭的子级会移除。 */
    readonly children: readonly ScopeSnapshot[];
}
/**
 * 一段明确的使用期限，统一管理任务、资源持有和清理函数。
 * 关闭时先取消，再等待已登记任务结束，最后清理资源；其他 Scope 的共享持有不受影响。
 * show.scope 对应本次界面显示，ctx.scope 对应本次模块业务实例。
 * @example
 * const owner = app.flows.child('inventory-flow');
 * try { await app.modules.use(InventoryModule, owner); } finally { await owner.close(); }
 */
export class Scope {
    /** 不暴露宿主关闭权限的稳定入口；同一 Scope 始终返回同一个对象。 */
    readonly lifetime: Lifetime;
    /**
     * 本使用期限的取消信号；关闭开始时即变为 aborted，不必等清理完成。
     */
    readonly signal: CancellationSignal;
    private readonly source: CancellationSource;
    private readonly children = new Set<Scope>();
    private readonly tasks = new Map<Promise<unknown>, string>();
    private readonly cleanups = new Set<Cleanup>();
    private closing?: Promise<void>;
    private ended = false;
    /**
     * 创建独立期限；需要跟随父级结束时优先使用 parent.child(label)。
     * @param label 日志和错误中的调试名称。
     * @param report 清理和异步错误的上报函数，默认输出框架日志。
     */
    constructor(
        /**
         * 用于日志和诊断的名称，不作为业务对象的唯一标识。
         */
        readonly label: string,
        private readonly report: ErrorReporter = reportError,
    ) {
        this.source = new CancellationSource(report);
        this.signal = this.source.signal;
        this.lifetime = Object.freeze({
            signal: this.signal,
            defer: (cleanup: Cleanup) => this.defer(cleanup),
            child: (label: string) => this.child(label),
            inspect: () => this.inspect(),
        });
        owners.set(this, this);
        owners.set(this.lifetime, this);
    }
    /**
     * 是否已完成全部清理；关闭中可能为 false，而 signal.aborted 已为 true。
     */
    get closed(): boolean {
        return this.ended;
    }
    /**
     * @internal
     * 判断 other 是否为自身或后代 Scope，供模块自持有和重入检查使用。
     * @param other 待检查的使用期限。
     */
    owns(other: Lifetime): boolean {
        return this === scopeOwner(other) || Array.from(this.children).some((child) => child.owns(other));
    }
    /**
     * 创建自动跟随当前 Scope 结束的子期限。
     * @param label 子级调试名称。
     * @returns 可提前关闭的独立子 Scope；关闭子级不会关闭父级。
     * @throws 当前 Scope 已取消时抛出 OperationCancelled。
     */
    child(label: string): Scope {
        this.signal.throwIfAborted();
        const child = new Scope(`${this.label}/${label}`, this.report);
        this.children.add(child);
        child.defer(() => {
            this.children.delete(child);
        });
        return child;
    }
    /**
     * 登记清理函数；close 时逆序执行，支持返回 Promise。
     * @param cleanup 释放订阅、节点等持有物的函数。
     * @returns 取消这项清理登记的函数；调用它不会执行 cleanup。
     * @example
     * show.scope.defer(() => customListener.dispose());
     */
    defer(cleanup: Cleanup): () => void {
        this.signal.throwIfAborted();
        this.cleanups.add(cleanup);
        return () => {
            this.cleanups.delete(cleanup);
        };
    }
    /**
     * @internal
     * 立即取消自身和子级，阻止新工作及 commit；不等待任务或释放资源，完整关闭使用 close。
     * @param reason 传递给等待者的取消原因。
     */
    cancel(reason = new OperationCancelled(`Scope ended: ${this.label}`)): void {
        if (this.signal.aborted) return;
        this.source.cancel(reason);
        for (const child of Array.from(this.children)) child.cancel(reason);
    }
    /**
     * @internal
     * 登记 Promise，使 close 等待它结束；不强制终止 Promise。业务优先使用 show.run 或 activation.run。
     * @param task 纳入关闭屏障的工作。
     * @returns 传入的同一个 Promise。
     */
    track<T>(task: Promise<T>, label = 'task'): Promise<T> {
        this.signal.throwIfAborted();
        this.tasks.set(task, label);
        task.then(
            () => this.tasks.delete(task),
            () => this.tasks.delete(task),
        );
        return task;
    }
    /**
     * 立即取消，再等待登记任务和子级，最后执行清理；重复调用返回同一个 Promise。
     * 不要在自身登记的任务中 await 自身 close，否则可能等待自己。此方法本身不设超时。
     * @returns 全部清理完成后兑现。
     * @throws SCOPE_CLEANUP_FAILED：汇总非取消错误，其余清理仍会继续。
     */
    close(): Promise<void> {
        if (this.closing) return this.closing;
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        this.closing = new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        this.cancel();
        void this.drain().then(resolve, reject);
        return this.closing;
    }
    private async drain(): Promise<void> {
        const failures: unknown[] = [];
        // Descendant resources remain pinned while ancestor tasks may still touch them.
        const tasks = await this.drainTasks();
        const settled = [
            ...tasks,
            ...(await Promise.allSettled(Array.from(this.children).map((child) => child.close()))),
        ];
        for (const result of settled)
            if (result.status === 'rejected' && !(result.reason instanceof OperationCancelled))
                failures.push(result.reason);
        for (const cleanup of Array.from(this.cleanups).reverse()) {
            try {
                await cleanup();
            } catch (error) {
                failures.push(error);
            }
        }
        this.cleanups.clear();
        this.ended = true;
        if (failures.length)
            throw new FrameworkError('SCOPE_CLEANUP_FAILED', `Cleanup failed: ${this.label}`, { failures });
    }
    /**
     * @internal
     * 等待当前登记的自身与后代任务结束，保留资源持有，供 UI 隐藏屏障使用。
     * @returns 各任务的完成或失败结果。
     */
    async drainTasks(): Promise<PromiseSettledResult<unknown>[]> {
        const [own, nested] = await Promise.all([
            Promise.allSettled(Array.from(this.tasks.keys())),
            Promise.all(Array.from(this.children).map((child) => child.drainTasks())),
        ]);
        return [...own, ...nested.flat()];
    }
    /** 读取谁在阻止清理；快照不延长任务或资源的使用期限，也不能用于修改框架内部状态。 */
    inspect(): ScopeSnapshot {
        return Object.freeze({
            label: this.label,
            state: this.ended ? 'closed' : this.closing ? 'closing' : this.signal.aborted ? 'cancelled' : 'active',
            tasks: Object.freeze(Array.from(this.tasks.values())),
            cleanupCount: this.cleanups.size,
            children: Object.freeze(Array.from(this.children, (child) => child.inspect())),
        });
    }
}
/**
 * 一次受 Scope 管理的工作上下文。捕获本次上下文，异步返回后通过 commit 更新界面，避免旧结果写入下一次显示。
 */
export interface TaskContext {
    /**
     * 该任务持有资源和订阅的期限，传给 config.load、assets.load 等接口。
     */
    readonly scope: Lifetime;
    /**
     * 该任务的取消信号；网络适配和长任务应主动响应或检查它。
     */
    readonly signal: CancellationSignal;
    /**
     * 仅在 Scope 未取消且此次上下文仍有效时执行同步更新。
     * show.commit 还检查当前显示是否被替换、结束或挂起；同次显示内的请求竞态可用 show.actions.latest。
     * @param action 同步赋值或节点更新，不能传 async 函数或在其中 await。
     * @returns 已执行为 true；上下文失效、跳过执行为 false。
     * @throws ASYNC_COMMIT：回调返回 Promise；回调自己的异常继续向外抛出。
     * @example
     * const items = await show.config.load(ItemsTable);
     * show.commit(() => { label.string = items.require(1).name; });
     */
    commit(action: () => void): boolean;
}
/**
 * 构造绑定到固定 Scope 的任务上下文；UI 通常直接使用 show 或 activation。
 * @param scope 该次工作的使用期限。
 * @param isCurrent 可选的当前代次检查，默认只检查取消状态。
 * @returns 属性不可替换的上下文。
 */
export function taskContext(scope: Lifetime, isCurrent: () => boolean = () => true): TaskContext {
    return Object.freeze({
        scope: scopeOwner(scope).lifetime,
        signal: scope.signal,
        commit(action: () => void) {
            if (scope.signal.aborted || !isCurrent()) return false;
            const result: unknown = action();
            if (result && typeof (result as Promise<unknown>).then === 'function') {
                void Promise.resolve(result).catch(() => {});
                throw new FrameworkError('ASYNC_COMMIT', 'commit accepts synchronous mutations only');
            }
            return true;
        },
    });
}
/**
 * 登记并执行同步或异步工作，使 owner.close 等待它结束；已运行的外部 Promise 需自行响应 signal。
 * @param owner 工作所属的期限。
 * @param task 在下一次 Promise 微任务中执行的函数。
 * @param isCurrent 可选的代次检查，阻止过期提交。
 * @returns 任务结果或错误；调用方应 await 或处理失败。
 */
export function runTask<T>(
    owner: Lifetime,
    task: (context: TaskContext) => T | Promise<T>,
    isCurrent?: () => boolean,
    label = 'task',
): Promise<T> {
    owner.signal.throwIfAborted();
    const context = taskContext(owner, isCurrent);
    return scopeOwner(owner).track(
        Promise.resolve().then(() => {
            context.signal.throwIfAborted();
            return task(context);
        }),
        label,
    );
}
