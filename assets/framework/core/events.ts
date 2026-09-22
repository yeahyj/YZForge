import { ErrorReporter, OperationCancelled, reportError } from './errors';
import { runTask, Lifetime, TaskContext } from './scope';
/**
 * 事件的轻量公开合同，用同一个稳定 ID 关联发布者与订阅者，并携带载荷的 TypeScript 类型。
 * 同一 ID 即同一频道，建议带模块前缀，避免不同业务误用同名事件。
 * @typeParam T - 事件载荷类型，建议是描述已发生事实的只读数据。
 */
export interface EventKey<T> {
    /**
     * 全局事件 ID，例如 inventory/items-changed；类型信息在运行时不会额外校验载荷。
     */
    readonly id: string;
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    readonly __payload?: T;
}
/**
 * 声明事件合同，不触发事件也不加载业务模块。
 * @param id - 全局稳定 ID，推荐带模块命名空间。
 * @returns 冻结的事件键；发布与订阅应共享同一合同定义。
 * @example
 * export const ItemsChanged = eventKey<{ readonly itemId: number }>("inventory/items-changed");
 */
export function eventKey<T>(id: string): EventKey<T> {
    return Object.freeze({ id });
}
type Subscription = { scope: Lifetime; invoke: (payload: unknown, task: TaskContext) => void | Promise<void> };
/**
 * 类型化事件总线，用于广播事实，例如物品数量已变化。
 * 需要返回值、顺序保证或执行命令时直接调用模块 API，不把事件用作隐式 RPC。
 */
export class Events {
    private readonly listeners = new Map<string, Set<Subscription>>();
    /**
     * 创建事件总线，App 默认提供共享实例。
     * @param report - 订阅回调异常的上报器；默认 reportError，正常取消不会作为错误上报。
     */
    constructor(private readonly report: ErrorReporter = reportError) {}
    /**
     * 订阅事件并自动跟随 scope 取消；每次回调作为该 Lifetime 的任务被跟踪。
     * @param key - 共享的事件合同。
     * @param callback - 接收 payload 和 task，可异步执行；await 后改 UI 应使用 task.commit。
     * @param scope - 订阅及回调任务的所有者；取消时不再接收新事件。
     * @returns 主动取消订阅的函数，不会强行停止已经开始的回调。
     * @throws OperationCancelled scope 已取消。
     * @example
     * this.ctx.events.on(ItemsChanged, (data, task) => {
     *     task.commit(() => this.refreshItem(data.itemId));
     * }, show.scope);
     */
    on<T>(
        key: EventKey<T>,
        callback: (payload: T, task: TaskContext) => void | Promise<void>,
        scope: Lifetime,
    ): () => void {
        scope.signal.throwIfAborted();
        const item: Subscription = { scope, invoke: callback as Subscription['invoke'] };
        let group = this.listeners.get(key.id);
        if (!group) this.listeners.set(key.id, (group = new Set()));
        group.add(item);
        let detach = () => {};
        const off = () => {
            group!.delete(item);
            if (!group!.size) this.listeners.delete(key.id);
            detach();
        };
        detach = scope.signal.onAbort(off);
        return off;
    }
    /**
     * 向当前订阅者发布事件，每个回调异步调度为独立任务。
     * @param key - 共享事件合同。
     * @param payload - 符合合同的数据；原对象被共享传递，不会自动克隆或冻结，订阅者不要修改它。
     * @returns 立即返回 void，不等待回调完成，也不收集回调返回值。
     * @remarks 多次发布的异步回调可能重叠；回调异常由总线统一上报。
     */
    emit<T>(key: EventKey<T>, payload: T): void {
        for (const item of Array.from(this.listeners.get(key.id) ?? [])) {
            if (!item.scope.signal.aborted)
                void runTask(item.scope, (task) => item.invoke(payload, task)).catch((error) => {
                    if (!(error instanceof OperationCancelled)) this.report(error);
                });
        }
    }
}
