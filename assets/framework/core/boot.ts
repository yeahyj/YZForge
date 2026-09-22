import { FrameworkError, invariant } from './errors';
import { Lifetime, runTask, Scope, TaskContext } from './scope';

/** 启动尝试上下文；首次界面、会话和临时工作应使用这个 scope，以便失败时统一回收。 */
export interface BootContext extends TaskContext {
    /** 从 1 开始的尝试序号，便于诊断重试。 */
    readonly attempt: number;
}

/**
 * 可重试的业务启动流程。核心服务由 App 持有，业务启动失败只回收本次尝试。
 * 同时只允许一个尝试；失败回收完成后才能重试，已成功的流程不重复执行。
 */
export class BootFlow {
    private current?: Scope;
    private pending?: Promise<void>;
    private count = 0;
    private phase: 'idle' | 'starting' | 'ready' | 'failed' = 'idle';
    /** @param owner 启动尝试的父级期限，App 默认使用应用业务流程期限。 */
    constructor(private readonly owner: Lifetime) {}

    /** 当前阶段与累计尝试数；不泄露关闭权限。 */
    inspect() {
        return Object.freeze({ state: this.phase, attempts: this.count });
    }

    /**
     * 启动或重试；并发调用共享当前尝试，错误包含失败回收结果。
     * @param work 使用本次 BootContext.scope 持有首屏与会话；失败必须抛出。
     * @returns 启动成功才完成；失败先回收本次持有再拒绝，清理也失败则抛 BOOT_CLEANUP_FAILED。
     * @throws BOOT_ALREADY_READY 已启动成功；父级取消时拒绝新的尝试。
     */
    start(work: (context: BootContext) => void | Promise<void>): Promise<void> {
        if (this.pending) return this.pending;
        invariant(this.phase !== 'ready', 'BOOT_ALREADY_READY', 'Business startup already completed');
        this.owner.signal.throwIfAborted();
        const scope = this.owner.child(`boot:${++this.count}`);
        this.current = scope;
        this.phase = 'starting';
        const attempt = this.count;
        const job = runTask(
            scope,
            (task) => work(Object.freeze({ ...task, attempt })),
            () => this.current === scope,
            'onBoot',
        );
        this.pending = job
            .then(() => {
                scope.signal.throwIfAborted();
                this.phase = 'ready';
            })
            .catch(async (error) => {
                scope.cancel();
                try {
                    await scope.close();
                } catch (cleanup) {
                    throw new FrameworkError('BOOT_CLEANUP_FAILED', 'Startup failed and cleanup reported errors', {
                        error,
                        cleanup,
                    });
                } finally {
                    this.phase = 'failed';
                }
                throw error;
            })
            .finally(() => {
                this.pending = undefined;
            });
        return this.pending;
    }
}
