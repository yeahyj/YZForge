import { untilCancelled } from '../../../core/cancellation';
import { invariant, reportError } from '../../../core/errors';
import { type Lifetime, type Scope, type TaskContext, runTask } from '../../../core/scope';

/** @internal 页签切换的逻辑部分；旧任务及清理退出前不打开新内容，快速切换只打开最后一个。 */
export class TabController {
    readonly scope: Scope;
    private current?: { id: string; scope: Scope; result: Promise<void> };
    constructor(
        owner: Lifetime,
        private readonly ids: ReadonlySet<string>,
        private readonly open: (id: string, task: TaskContext) => void | Promise<void>,
        private readonly changed: (id?: string) => void,
    ) {
        this.scope = owner.child('tabs');
        this.scope.signal.onAbort(() => this.changed(undefined));
    }
    /** 选择同一有效页签复用当前操作；非法 ID 不关闭现有页签。 */
    select(id: string): Promise<void> {
        this.scope.signal.throwIfAborted();
        invariant(this.ids.has(id), 'TAB_ID_INVALID', `不存在的页签：${id}`);
        if (this.current?.id === id && !this.current.scope.signal.aborted) return this.current.result;
        const previous = this.current;
        const scope = this.scope.child(`tab:${id}`);
        const entry = { id, scope, result: Promise.resolve() };
        this.current = entry;
        const before = previous?.scope.close() ?? Promise.resolve();
        // 等待屏障独立于 open：B 尚未启动就被 C 取消，C 仍须等待 A 的清理。
        void scope.track(before, 'tab:previous-cleanup');
        scope.signal.onAbort(() => {
            void scope.close().catch(reportError);
        });
        this.changed(id);
        const opened = runTask(
            scope,
            async (task) => {
                await before;
                task.signal.throwIfAborted();
                await this.open(id, task);
                task.signal.throwIfAborted();
            },
            () => this.current === entry,
            'tab:open',
        );
        // 先交付业务错误，再关闭失败页签，避免内部 close 把原错误替换成取消。
        entry.result = untilCancelled(opened, scope.signal);
        void opened
            .catch(async () => {
                try {
                    await scope.close();
                } finally {
                    if (this.current === entry) {
                        this.current = undefined;
                        this.changed(undefined);
                    }
                }
            })
            .catch(reportError);
        return entry.result;
    }
    /** 当前选择的 ID；包含正在准备的页签，失败/关闭后为 undefined。 */
    get selected(): string | undefined {
        return this.current && !this.current.scope.signal.aborted ? this.current.id : undefined;
    }
    /** 取消并等待本组全部页签工作、资源与清理；不要在 open 内 await 自己的 dispose。 */
    dispose(): Promise<void> {
        return this.scope.close();
    }
}
