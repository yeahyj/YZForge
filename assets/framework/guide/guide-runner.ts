import { invariant, FrameworkError, OperationCancelled } from '../core/errors';
import { runTask, type Lifetime, type TaskContext } from '../core/scope';

/** 引导持久化记录；记录下一步稳定 ID，避免插入步骤后把数组位置误当完成进度。 */
export interface GuideCheckpoint {
    /** 业务定义版本；变更不兼容流程时应递增。 */
    readonly version: number;
    /** running 表示还需继续，completed/skipped 表示本版本已结束。 */
    readonly status: 'running' | 'completed' | 'skipped';
    /** running 时必须存在，标识下一待完成步骤。 */
    readonly nextStep?: string;
}
/** 可注入的同步进度存储；写入失败会停止流程，不把失败保存当成成功。 */
export interface GuideProgressStore {
    /** 读取已有记录，无记录返回 undefined。 */
    read(id: string): GuideCheckpoint | undefined;
    /** 保存完整记录；账号隔离由注入的存储命名空间承担。 */
    write(id: string, checkpoint: GuideCheckpoint): void;
}
/** 一项业务步骤；先等待界面/目标，再等待真实业务完成，成功返回才推进进度。 */
export interface GuideStep {
    /** 本引导内唯一且稳定的步骤 ID。 */
    readonly id: string;
    /** 可选超时毫秒，默认 30000。超时只发取消信号，不强行终止不配合的 Promise。 */
    readonly timeoutMs?: number;
    /** 响应 context.signal；节点写入使用 context.commit；异步清理登记到 context.scope.defer。 */
    run(context: TaskContext): void | Promise<void>;
}
/** 引导定义由业务模块提供，框架不内置业务节点、奖励或完成条件。 */
export interface GuideDefinition {
    /** 稳定引导 ID，通常带业务模块前缀。 */
    readonly id: string;
    /** 正整数版本；旧版本记录会从本版本第一步重新开始。 */
    readonly version: number;
    /** 顺序执行的步骤，至少一项，ID 不可重复。 */
    readonly steps: readonly GuideStep[];
    /** 是否允许用户主动跳过，默认 false；跳过会保存 skipped。 */
    readonly allowSkip?: boolean;
}
/** 单次执行结果；失败通过 result Promise 拒绝，取消保留已保存的进度。 */
export interface GuideResult {
    /** completed 全部完成；skipped 用户跳过；cancelled 所有者结束或主动取消。 */
    readonly status: 'completed' | 'skipped' | 'cancelled';
}
/** 正在执行的引导句柄；取消/跳过同步发信号，清理完成后 result 才兑现。 */
export interface GuideHandle {
    /** 所有步骤任务和异步清理结束后的结果。 */
    readonly result: Promise<GuideResult>;
    /** 取消本次执行，不覆盖最后一个成功保存的检查点。 */
    cancel(): void;
    /** 按定义允许跳过；不允许时抛 GUIDE_SKIP_DISABLED。 */
    skip(): void;
    /** 返回当前步骤和执行状态；draining 时仍禁止启动下一次引导。 */
    inspect(): { readonly id: string; readonly step?: string; readonly state: 'running' | 'draining' | 'ended' };
}
/**
 * 顺序引导执行器，同一实例只允许一个执行。步骤完成、取消或失败都先排空任务和清理再继续。
 * 可绑定页面 Scope；跨页面流程须由外部会话持有，目标注册仍归各页面/条目自己的期限。
 */
export class GuideRunner {
    private active?: GuideHandle;
    /** 注入可选进度存储；省略时仅执行，不保存完成状态。 */
    constructor(private readonly progress?: GuideProgressStore) {}
    /**
     * 校验定义并开始/恢复引导；已完成或已跳过的同版本定义直接返回保存的结果。
     * 清理失败或业务异常会拒绝 result，当前步骤不会被记为完成。
     * 不要在步骤任务中 await 自己的 result；cancel/skip 仅发起终止，可以直接调用。
     */
    start(definition: GuideDefinition, owner: Lifetime): GuideHandle {
        definition = { ...definition };
        owner.signal.throwIfAborted();
        invariant(!this.active, 'GUIDE_BUSY', '已有引导运行或正在清理');
        invariant(
            definition.id.trim().length > 0 &&
                Number.isSafeInteger(definition.version) &&
                definition.version > 0 &&
                definition.steps.length > 0,
            'GUIDE_DEFINITION_INVALID',
            '引导需要 ID、正版本和步骤',
        );
        const steps = definition.steps.map((step) => ({ ...step }));
        const ids = new Set<string>();
        for (const step of steps) {
            invariant(
                step.id.trim().length > 0 && !ids.has(step.id) && typeof step.run === 'function',
                'GUIDE_DEFINITION_INVALID',
                '步骤 ID 不能为空或重复',
            );
            invariant(
                step.timeoutMs === undefined ||
                    (Number.isFinite(step.timeoutMs) && step.timeoutMs > 0 && step.timeoutMs <= 2147483647),
                'GUIDE_DEFINITION_INVALID',
                '步骤超时必须为有效正毫秒数',
            );
            ids.add(step.id);
        }
        const saved = this.progress?.read(definition.id);
        const checkpoint = saved?.version === definition.version ? saved : undefined;
        let index = checkpoint?.status === 'running' ? steps.findIndex((step) => step.id === checkpoint.nextStep) : 0;
        invariant(index >= 0, 'GUIDE_PROGRESS_INVALID', '检查点步骤不存在，请迁移进度或递增引导版本');
        const scope = owner.child(`guide:${definition.id}`);
        let stop: 'cancelled' | 'skipped' | undefined;
        let state: 'running' | 'draining' | 'ended' = 'running';
        let current: string | undefined;
        const write = (value: GuideCheckpoint) => this.progress?.write(definition.id, Object.freeze(value));
        const execute = async (): Promise<GuideResult> => {
            try {
                if (checkpoint && checkpoint.status !== 'running') return { status: checkpoint.status };
                for (; index < steps.length; index++) {
                    scope.signal.throwIfAborted();
                    const step = steps[index];
                    current = step.id;
                    const stepScope = scope.child(step.id);
                    let expired = false;
                    const timer = setTimeout(() => {
                        expired = true;
                        stepScope.cancel(new OperationCancelled('引导步骤超时'));
                    }, step.timeoutMs ?? 30000);
                    try {
                        await runTask(stepScope, step.run, undefined, `guide-step:${step.id}`);
                        stepScope.signal.throwIfAborted();
                    } catch (error) {
                        if (expired && !scope.signal.aborted)
                            throw new FrameworkError('GUIDE_TIMEOUT', `引导步骤超时：${step.id}`);
                        throw error;
                    } finally {
                        clearTimeout(timer);
                        state = 'draining';
                        await stepScope.close();
                    }
                    scope.signal.throwIfAborted();
                    write(
                        index + 1 < steps.length
                            ? { version: definition.version, status: 'running', nextStep: steps[index + 1].id }
                            : { version: definition.version, status: 'completed' },
                    );
                    state = 'running';
                }
                return { status: 'completed' };
            } catch (error) {
                if (!scope.signal.aborted) throw error;
                if (!(error instanceof OperationCancelled)) throw error;
                if (stop === 'skipped') {
                    write({ version: definition.version, status: 'skipped' });
                    return { status: 'skipped' };
                }
                return { status: 'cancelled' };
            } finally {
                state = 'draining';
                try {
                    await scope.close();
                } finally {
                    state = 'ended';
                    if (this.active === handle) this.active = undefined;
                }
            }
        };
        // 推迟一个微任务，确保回调运行前已发布唯一句柄，阻止重入 start。
        const result = Promise.resolve().then(execute);
        const handle: GuideHandle = Object.freeze({
            result,
            cancel: () => {
                if (state === 'ended' || scope.signal.aborted) return;
                stop = 'cancelled';
                state = 'draining';
                scope.cancel();
            },
            skip: () => {
                invariant(definition.allowSkip, 'GUIDE_SKIP_DISABLED', '此引导不允许跳过');
                if (state === 'ended' || scope.signal.aborted) return;
                stop = 'skipped';
                state = 'draining';
                scope.cancel();
            },
            inspect: () => ({ id: definition.id, step: current, state }),
        });
        this.active = handle;
        return handle;
    }
}
