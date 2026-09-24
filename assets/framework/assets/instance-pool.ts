import { FrameworkError, invariant, reportError } from '../core/errors';
import { runTask, Scope, scopeOwner, type Lifetime } from '../core/scope';

/** 池容量包含空闲、借出、正在创建和正在归还的实例。 */
export interface InstancePoolOptions {
    /** 实例总量上限，默认 32；达到上限直接拒绝，不无限排队。 */
    readonly maxSize?: number;
    /** 最大空闲实例数，默认 8，不能大于 maxSize。 */
    readonly maxIdle?: number;
}
/** 每次借用都有独立期限；旧句柄归还后不可再次读取 value。 */
export interface InstanceLease<T> {
    readonly value: T;
    readonly scope: Lifetime;
    /** 主动结束本次使用，等待停用、借用任务和清理后复用；自身任务不能 await 自己的归还。 */
    release(): Promise<void>;
}
/** @internal 引擎适配器把最终销毁登记到 create 的 owner；激活必须同步。 */
export interface InstancePoolDriver<T, Input> {
    create(owner: Lifetime): Promise<T>;
    activate(value: T, input: Input, owner: Lifetime): void;
    deactivate(value: T): Promise<void>;
    valid(value: T): boolean;
}
type Entry<T> = { scope: Scope; value: T };
type Borrow = { release(): Promise<void>; cancel(): Promise<void> };

/** @internal 可测试的实例复用控制器；PrefabPool 提供节点业务入口。 */
export class InstancePool<T, Input> {
    private readonly scope: Scope;
    private readonly entries = new Set<Entry<T>>();
    private readonly idle: Entry<T>[] = [];
    private readonly borrows = new Set<Borrow>();
    private creating = 0;
    private readonly maxSize: number;
    private readonly maxIdle: number;
    private explicitShutdown = false;
    private shutdown: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);

    constructor(
        owner: Lifetime,
        private readonly driver: InstancePoolDriver<T, Input>,
        options: InstancePoolOptions = {},
    ) {
        this.maxSize = options.maxSize ?? 32;
        this.maxIdle = options.maxIdle ?? Math.min(8, this.maxSize);
        invariant(
            Number.isSafeInteger(this.maxSize) &&
                this.maxSize > 0 &&
                Number.isSafeInteger(this.maxIdle) &&
                this.maxIdle >= 0 &&
                this.maxIdle <= this.maxSize,
            'POOL_LIMIT_INVALID',
            '池容量必须为整数，0 ≤ maxIdle ≤ maxSize，maxSize > 0',
        );
        this.scope = owner.child('instance-pool');
        this.scope.signal.onAbort(() => {
            // 回收属于清理阶段，不能作为父级任务，否则等待父级任务时会等到自己。
            this.shutdown = Promise.allSettled(
                Array.from(this.borrows, (borrow) => (this.explicitShutdown ? borrow.release() : borrow.cancel())),
            );
        });
        this.scope.defer(async () => {
            const returned = await this.shutdown;
            this.idle.length = 0;
            const results = [
                ...returned,
                ...(await Promise.allSettled(Array.from(this.entries, (entry) => this.destroy(entry)))),
            ];
            const failures = results
                .filter((result) => result.status === 'rejected')
                .map((result) => result.reason as unknown);
            if (failures.length) throw new FrameworkError('POOL_CLEANUP_FAILED', '实例池销毁失败', { failures });
        });
    }
    /** 只读容量摘要，不遍历节点。 */
    inspect() {
        return Object.freeze({
            size: this.entries.size + this.creating,
            idle: this.idle.length,
            borrowed: this.borrows.size,
            maxSize: this.maxSize,
            closed: this.scope.closed,
        });
    }
    /** 预先准备至少 count 个闲置实例；不执行业务激活，已成功准备的实例可继续使用。 */
    prewarm(count: number, owner: Lifetime): Promise<void> {
        this.scope.signal.throwIfAborted();
        invariant(
            Number.isSafeInteger(count) && count >= 0 && count <= this.maxIdle,
            'POOL_WARM_LIMIT',
            '预热数量不得超过 maxIdle',
        );
        const work = runTask(
            owner,
            async () => {
                while (this.idle.length < count) {
                    this.scope.signal.throwIfAborted();
                    owner.signal.throwIfAborted();
                    const entry = await this.create(owner);
                    if (this.idle.length < this.maxIdle) this.idle.push(entry);
                    else await this.destroy(entry);
                }
            },
            undefined,
            'pool.prewarm',
        );
        return this.track(work);
    }
    /** 借用完成前先配置再激活；配置失败的实例销毁，不能混入空闲池。 */
    acquire(input: Input, owner: Lifetime): Promise<InstanceLease<T>> {
        this.scope.signal.throwIfAborted();
        owner.signal.throwIfAborted();
        const use = owner.child('pool-use');
        const offPool = this.scope.signal.onAbort(() => use.cancel());
        const work = runTask(
            owner,
            async () => {
                let entry: Entry<T> | undefined;
                let borrow: Borrow | undefined;
                let broken = false;
                try {
                    use.signal.throwIfAborted();
                    while ((entry = this.idle.pop()) && !this.driver.valid(entry.value)) {
                        await this.destroy(entry);
                        entry = undefined;
                    }
                    entry ??= await this.create(use);
                    use.signal.throwIfAborted();
                    this.scope.signal.throwIfAborted();
                    const current = entry;
                    let releasing: Promise<void> | undefined;
                    let automatic: Promise<void> | undefined;
                    let deactivation: Promise<void> | undefined;
                    let detach = () => {},
                        unown = () => {};
                    let complete!: () => void;
                    const released = new Promise<void>((resolve) => {
                        complete = resolve;
                    });
                    const stop = (): Promise<void> => {
                        if (!deactivation) {
                            deactivation = Promise.resolve().then(() => this.driver.deactivate(current.value));
                            // 自动回收可能先等父级任务，停用错误留到 release 汇总。
                            void deactivation.catch(() => {});
                            use.cancel();
                        }
                        return deactivation;
                    };
                    const release = (): Promise<void> => {
                        if (releasing) return releasing;
                        // 先发布屏障再发取消，允许取消监听安全重入。
                        releasing = Promise.resolve()
                            .then(async () => {
                                const failures: unknown[] = [];
                                try {
                                    await stop();
                                } catch (error) {
                                    failures.push(error);
                                }
                                try {
                                    await use.close();
                                } catch (error) {
                                    failures.push(error);
                                }
                                if (
                                    !broken &&
                                    !failures.length &&
                                    !this.scope.signal.aborted &&
                                    this.driver.valid(current.value) &&
                                    this.idle.length < this.maxIdle
                                )
                                    this.idle.push(current);
                                else
                                    try {
                                        await this.destroy(current);
                                    } catch (error) {
                                        failures.push(error);
                                    }
                                if (failures.length)
                                    throw new FrameworkError('POOL_RETURN_FAILED', '实例归还失败，已尝试销毁', {
                                        failures,
                                    });
                            })
                            .finally(() => {
                                detach();
                                // 所有者已取消时保留清理登记，让其 close 仍能收到归还异常。
                                if (!owner.signal.aborted) unown();
                                offPool();
                                this.borrows.delete(borrow!);
                            });
                        void stop();
                        void releasing.then(complete, complete);
                        return releasing;
                    };
                    const cancel = (): Promise<void> => {
                        if (releasing) return releasing;
                        if (!automatic) {
                            automatic = Promise.resolve().then(async () => {
                                const waiting: Promise<unknown>[] = [];
                                if (owner.signal.aborted) waiting.push(scopeOwner(owner).drainCancelledTasks());
                                if (this.scope.signal.aborted) waiting.push(this.scope.drainCancelledTasks());
                                // 业务显式 release/close 表示提前结束使用，可解除自动回收的父级等待。
                                // 例如父级任务的 finally 中 await release，不能让它反过来等该任务。
                                if (waiting.length) await Promise.race([Promise.all(waiting), released]);
                                await release();
                            });
                            void stop();
                        }
                        return automatic;
                    };
                    borrow = { release, cancel };
                    this.borrows.add(borrow);
                    detach = use.signal.onAbort(() => {
                        if (!releasing && !automatic) void cancel().catch(reportError);
                    });
                    unown = owner.defer(cancel);
                    const returned: unknown = this.driver.activate(current.value, input, use.lifetime);
                    if (returned && typeof (returned as Promise<unknown>).then === 'function') {
                        void Promise.resolve(returned).catch(() => {});
                        throw new FrameworkError('POOL_ACTIVATE_ASYNC', '实例配置与激活必须同步');
                    }
                    use.signal.throwIfAborted();
                    return Object.freeze({
                        get value() {
                            use.signal.throwIfAborted();
                            return current.value;
                        },
                        scope: use.lifetime,
                        release,
                    });
                } catch (error) {
                    broken = true;
                    try {
                        if (borrow) await borrow.release();
                        else {
                            if (entry) await this.destroy(entry);
                            await use.close();
                        }
                    } catch (cleanup) {
                        throw new FrameworkError('POOL_ACQUIRE_CLEANUP_FAILED', '实例借用失败且回收异常', {
                            error,
                            cleanup,
                        });
                    } finally {
                        offPool();
                    }
                    throw error;
                }
            },
            undefined,
            'pool.acquire',
        );
        // runTask 在调用者已取消时可能不进入函数体，也要回收预先登记的等待期限。
        const result = work.catch(async (error) => {
            offPool();
            if (!use.closed) await use.close();
            throw error;
        });
        return this.track(result);
    }
    /** 主动取消全部借用，等待池操作和借用任务后销毁；可重复调用，借用自身的任务不能 await。 */
    close(): Promise<void> {
        this.explicitShutdown = true;
        // 自动关闭已在等父级时，显式关池同样能够主动完成归还，避免父级任务等待自身。
        if (this.scope.signal.aborted)
            for (const borrow of Array.from(this.borrows)) void borrow.release().catch(() => {});
        return this.scope.close();
    }

    private track<R>(work: Promise<R>): Promise<R> {
        // 调用错误交给发起者；这个屏障只保证关池不能早于创建/归还完成。
        void this.scope.track(
            work.then(
                () => {},
                () => {},
            ),
            'pool.operation',
        );
        return work;
    }
    private async create(owner: Lifetime): Promise<Entry<T>> {
        this.scope.signal.throwIfAborted();
        owner.signal.throwIfAborted();
        invariant(this.entries.size + this.creating < this.maxSize, 'POOL_FULL', '实例池已达总量上限');
        this.creating++;
        const resources = new Scope('pooled-instance');
        const offOwner = owner.signal.onAbort(() => resources.cancel());
        const offPool = this.scope.signal.onAbort(() => resources.cancel());
        try {
            const value = await this.driver.create(resources.lifetime);
            resources.signal.throwIfAborted();
            invariant(this.driver.valid(value), 'POOL_INSTANCE_INVALID', '新实例无效');
            const entry = { scope: resources, value };
            this.entries.add(entry);
            return entry;
        } catch (error) {
            try {
                await resources.close();
            } catch (cleanup) {
                throw new FrameworkError('POOL_CREATE_CLEANUP_FAILED', '创建实例失败且回收异常', { error, cleanup });
            }
            throw error;
        } finally {
            this.creating--;
            offOwner();
            offPool();
        }
    }
    private async destroy(entry: Entry<T>): Promise<void> {
        try {
            await entry.scope.close();
        } finally {
            this.entries.delete(entry);
        }
    }
}
