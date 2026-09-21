import { untilCancelled } from '../core/cancellation';
import { Scope } from '../core/scope';
import { ErrorReporter, reportError } from '../core/errors';
type Entry<V> = { users: number; value?: V; ready: Promise<V>; released: boolean };

/**
 * @internal
 * 按键共享异步加载的租约缓存。每个 Scope 对同一键只有一份逻辑持有，多个 Scope 共享一次物理引用。
 * 最后一个持有者归还后释放；加载失败可重试，一个等待者取消不影响其他等待者。
 */
export class LeaseCache<V> {
    private readonly entries = new Map<string, Entry<V>>();
    private readonly owners = new WeakMap<Scope, Map<string, Promise<V>>>();
    /**
     * 创建共享租约缓存，由资源和配置管理器使用。
     * @param load - 首次请求某键时执行的异步加载函数。
     * @param retain - 加载成功后执行一次的物理持有操作，例如 addRef。
     * @param release - 最后一个逻辑持有归还后的物理释放操作，例如 decRef。
     * @param report - 释放异常上报器，默认 reportError。
     */
    constructor(
        private readonly load: (key: string) => Promise<V>,
        private readonly retain: (value: V) => void,
        private readonly release: (value: V) => void,
        private readonly report: ErrorReporter = reportError,
    ) {}
    /**
     * 取得键对应的值，并把归还操作登记到 scope；不要在业务中手动调用物理 release。
     * @param key - 共享缓存键，须能完整区分资源版本或加载参数。
     * @param scope - 租约所有者；取消会终止等待，已交付的租约在清理阶段归还。
     * @returns 共享加载结果；同一 Scope 重复取得同键不会重复持有。
     * @throws OperationCancelled scope 已取消或等待期间取消；加载失败原样传播。
     */
    acquire(key: string, scope: Scope): Promise<V> {
        scope.signal.throwIfAborted();
        let owned = this.owners.get(scope);
        if (!owned) this.owners.set(scope, (owned = new Map()));
        const previous = owned.get(key);
        if (previous) return previous;
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { users: 0, ready: Promise.resolve(undefined as V), released: false };
            const captured = entry;
            this.entries.set(key, captured);
            captured.ready = Promise.resolve()
                .then(() => this.load(key))
                .then(
                    (value) => {
                        this.retain(value);
                        captured.value = value;
                        if (captured.users === 0) this.drop(key, captured);
                        return value;
                    },
                    (error) => {
                        if (this.entries.get(key) === captured) this.entries.delete(key);
                        throw error;
                    },
                );
        }
        const captured = entry;
        captured.users++;
        let returned = false,
            unown = () => {};
        const giveBack = () => {
            if (returned) return;
            returned = true;
            owned!.delete(key);
            unown();
            if (--captured.users === 0 && captured.value !== undefined) this.drop(key, captured);
        };
        // Pending caller cancellation can return demand early. A delivered lease lives until cleanup.
        const off = scope.signal.onAbort(() => {
            if (!captured.value) giveBack();
        });
        unown = scope.defer(() => {
            off();
            giveBack();
        });
        const result = untilCancelled(captured.ready, scope.signal).catch((error) => {
            off();
            giveBack();
            throw error;
        });
        owned.set(key, result);
        return result;
    }
    private drop(key: string, entry: Entry<V>): void {
        if (entry.released) return;
        entry.released = true;
        if (this.entries.get(key) === entry) this.entries.delete(key);
        try {
            this.release(entry.value!);
        } catch (error) {
            this.report(error);
        }
    }
    /**
     * 当前共享条目数，包含仍在加载的条目；不是资源字节数，也不是逻辑持有者总数。
     */
    get retainedCount(): number {
        return this.entries.size;
    }
}
