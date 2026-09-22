import { untilCancelled } from './cancellation';
import { invariant, OperationCancelled, reportError } from './errors';
import { Lifetime, runTask, Scope, TaskContext } from './scope';

type Work<T> = (task: TaskContext) => T | Promise<T>;
type Running<T> = { scope: Scope; result: Promise<T>; completed: Promise<void> };

/**
 * 一段生命周期内的命名操作。页面使用 show.actions，Part 使用 activation.actions。
 * latest 用于查询，exclusive 用于忽略重复触发，serial 用于有界顺序执行。
 * 这些策略不会撤销已经提交的业务变更；需要跨页面继续的业务使用业务会话所有者。
 */
export class Actions {
    private readonly running = new Map<string, Running<unknown>>();
    private readonly tails = new Map<string, Promise<void>>();
    private readonly pending = new Map<string, number>();
    private readonly policies = new Map<string, string>();

    /** @param owner 操作及资源的所有者；子操作结束后归还其局部资源。 */
    constructor(
        private readonly owner: Lifetime,
        private readonly isCurrent: () => boolean = () => true,
    ) {}

    /**
     * 当前命名操作是否仍在执行或排队；不创建操作。
     * @param key 与 latest/exclusive/serial 使用的名称一致。
     */
    busy(key: string): boolean {
        return this.running.has(key) || (this.pending.get(key) ?? 0) > 0;
    }

    /**
     * 同名查询只接受最新一次结果；旧调用立即收到 OperationCancelled，旧任务仍须响应 signal。
     * task.commit 同时检查查询代次和宿主使用期，旧结果无法通过它覆盖新界面。
     * 用 show.assets 等宿主入口持有需要显示至页面结束的资源；task.scope 仅覆盖本次操作。
     * @param key 稳定的操作名，例如 search；同一 Actions 内共用名称会互相替换。
     * @param work 本次工作，主动响应 task.signal，更新界面放在 task.commit。
     * @returns 本次结果；被替换或宿主结束时拒绝为 OperationCancelled。
     * @throws ACTION_KEY_EMPTY 名称为空；ACTION_POLICY_MISMATCH 同名混用策略。
     */
    latest<T>(key: string, work: Work<T>): Promise<T> {
        this.policy(key, 'latest');
        this.owner.signal.throwIfAborted();
        this.running.get(key)?.scope.cancel(new OperationCancelled(`Replaced action: ${key}`));
        return this.start(key, work).result;
    }

    /**
     * 同名操作执行期间忽略重复触发并返回 undefined；不会重复执行回调，也不自动重试业务提交。
     * @param key 防重复的操作名，例如 claim-reward；不同名称可并行。
     * @param work 首次触发要执行的工作；异常交给调用方，不自动重试。
     * @returns 首次调用结果，重复触发为 undefined；宿主结束时拒绝为 OperationCancelled。
     * @throws ACTION_KEY_EMPTY 名称为空；ACTION_POLICY_MISMATCH 同名混用策略。
     */
    exclusive<T>(key: string, work: Work<T>): Promise<T | undefined> {
        this.policy(key, 'exclusive');
        this.owner.signal.throwIfAborted();
        if (this.busy(key)) return Promise.resolve(undefined);
        return this.start(key, work).result;
    }

    /**
     * 同名操作按顺序执行；maxPending 包含运行中的操作，默认 32，超限明确失败。
     * 排队期间宿主结束会立即取消等待，尚未执行的回调不会开始。
     * 同一个 key 固定使用一种策略，不在同名操作内部等待自己排队的操作。
     * @param key 队列名称；不同名称有各自的队列。
     * @param work 排到本项时执行的工作；某项失败不阻止后续项。
     * @param maxPending 正整数容量，每次提交都会按此值检查当前待完成数量。
     * @returns 本项结果或错误；宿主结束时尚未执行的回调不会开始。
     * @throws ACTION_QUEUE_FULL 超限；ACTION_LIMIT_INVALID 容量无效；名称与策略错误同 latest。
     */
    serial<T>(key: string, work: Work<T>, maxPending = 32): Promise<T> {
        this.policy(key, 'serial');
        this.owner.signal.throwIfAborted();
        invariant(Number.isSafeInteger(maxPending) && maxPending > 0, 'ACTION_LIMIT_INVALID', key);
        const count = this.pending.get(key) ?? 0;
        invariant(count < maxPending, 'ACTION_QUEUE_FULL', `Action queue is full: ${key}`);
        this.pending.set(key, count + 1);
        const next = (this.tails.get(key) ?? Promise.resolve()).then(async () => {
            this.owner.signal.throwIfAborted();
            const running = this.start(key, work);
            try {
                return await running.result;
            } finally {
                await running.completed;
            }
        });
        const tail = next
            .then(
                () => {},
                () => {},
            )
            .finally(() => {
                const left = this.pending.get(key)! - 1;
                if (left) this.pending.set(key, left);
                else this.pending.delete(key);
                if (this.tails.get(key) === tail) this.tails.delete(key);
            });
        this.tails.set(key, tail);
        return untilCancelled(next, this.owner.signal);
    }

    private policy(key: string, policy: string): void {
        invariant(key.trim().length > 0, 'ACTION_KEY_EMPTY', 'Provide a stable action name');
        invariant(!this.policies.has(key) || this.policies.get(key) === policy, 'ACTION_POLICY_MISMATCH', key);
        this.policies.set(key, policy);
    }
    private start<T>(key: string, work: Work<T>): Running<T> {
        invariant(key.trim().length > 0, 'ACTION_KEY_EMPTY', 'Provide a stable action name');
        const scope = this.owner.child(`action:${key}`);
        let finished = false;
        const current = (): boolean => !finished && this.isCurrent() && this.running.get(key) === running;
        const physical = runTask(
            scope,
            async (task) => {
                const value = await work(task);
                task.signal.throwIfAborted();
                if (!current()) throw new OperationCancelled(`Action ended: ${key}`);
                return value;
            },
            current,
            key,
        );
        // 先登记交付，再登记清理，正常完成时取消子 Scope 不会反过来取消已经交付的结果。
        const result = untilCancelled(physical, scope.signal);
        const completed = physical
            .then(
                () => {},
                () => {},
            )
            .then(async () => {
                finished = true;
                if (this.running.get(key) === running) this.running.delete(key);
                await scope.close();
            });
        void completed.catch(reportError);
        const running: Running<T> = { scope, result, completed };
        this.running.set(key, running);
        return running;
    }
}
