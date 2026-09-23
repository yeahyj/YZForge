import { ErrorReporter, OperationCancelled, reportError } from './errors';
/**
 * 只读取消信号，表示所有者已经结束；框架独立实现，不依赖浏览器 AbortController。
 * 取消是协作式通知，不会强制终止任意 Promise、网络请求或引擎共享加载。
 */
export interface CancellationSignal {
    /**
     * 是否已请求取消；一旦为 true 不会恢复，早于所有异步清理完成。
     */
    readonly aborted: boolean;
    /**
     * 首次取消的 OperationCancelled；取消前为 undefined。
     */
    readonly reason: OperationCancelled | undefined;
    /**
     * 已经取消时抛出 reason，未取消时直接返回；适合在 await 后继续操作前检查。
     */
    throwIfAborted(): void;
    /**
     * 登记同步取消通知。若已经取消，立即调用 listener。
     * @param listener - 接收首次取消原因；应快速同步完成，异步收尾交给 Scope.defer。
     * @returns 取消监听的函数，调用它不会触发 listener。
     */
    onAbort(listener: (reason: OperationCancelled) => void): () => void;
}
/**
 * 可发起取消的信号源，供框架及异步适配器使用。业务通常使用现有 scope.signal 和 scope.cancel。
 */
export class CancellationSource {
    /**
     * 可交给外部操作观察的只读信号，外部无法通过它直接取消所有者。
     */
    readonly signal: CancellationSignal;
    private reason?: OperationCancelled;
    private readonly listeners = new Set<(reason: OperationCancelled) => void>();
    /**
     * 创建未取消的信号源。
     * @param report - 监听回调同步抛错时的上报器，默认 reportError；不会阻止其他监听收到通知。
     */
    constructor(private readonly report: ErrorReporter = reportError) {
        // Signal getters execute with the public signal as this, so capture its source explicitly.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const owner = this;
        this.signal = Object.freeze({
            get aborted() {
                return owner.reason !== undefined;
            },
            get reason() {
                return owner.reason;
            },
            throwIfAborted() {
                if (owner.reason) throw owner.reason;
            },
            onAbort(listener: (reason: OperationCancelled) => void) {
                if (owner.reason) {
                    owner.notify(listener, owner.reason);
                    return () => {};
                }
                owner.listeners.add(listener);
                return () => {
                    owner.listeners.delete(listener);
                };
            },
        });
    }
    /**
     * 首次调用时同步通知全部监听并记录原因；后续调用无效。
     * @param reason - 可选取消错误，默认 OperationCancelled；不会等待异步工作完成。
     */
    cancel(reason = new OperationCancelled()): void {
        if (this.reason) return;
        this.reason = reason;
        const listeners = Array.from(this.listeners);
        this.listeners.clear();
        for (const listener of listeners) this.notify(listener, reason);
    }
    private notify(listener: (reason: OperationCancelled) => void, reason: OperationCancelled): void {
        try {
            listener(reason);
        } catch (error) {
            this.report(error);
        }
    }
}
/**
 * 使当前等待可取消，同时保留原异步操作对迟到结果的处理责任。
 * @param pending - 已开始的 Promise；signal 取消不会停止它本身。
 * @param signal - 当前等待者的取消信号。
 * @returns 原结果或原错误；取消先到时以 OperationCancelled 拒绝。
 * @throws OperationCancelled 调用时已经取消则同步抛出，但仍接管 pending 的迟到拒绝。
 * @remarks 不能用它替代网络 abort、节点销毁或资源释放，底层操作仍需处理迟到结果。
 */
export function untilCancelled<T>(pending: Promise<T>, signal: CancellationSignal): Promise<T> {
    if (signal.aborted) {
        // pending 已经启动，即使取消发生在传入之前，也不能遗留未处理的拒绝。
        void pending.catch(() => {});
        signal.throwIfAborted();
    }
    return new Promise<T>((resolve, reject) => {
        const off = signal.onAbort(reject);
        pending.then(
            (value) => {
                off();
                if (signal.aborted) reject(signal.reason);
                else resolve(value);
            },
            (error) => {
                off();
                reject(error);
            },
        );
    });
}
