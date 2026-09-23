import { Actions } from '../../../core/actions';
import type { Lifetime, TaskContext } from '../../../core/scope';

/** @internal 点击互斥与排空控制；忙碌状态覆盖业务任务和该次操作的异步清理。 */
export class AsyncButtonController {
    private busy = false;
    constructor(
        private readonly owner: Lifetime,
        private readonly work: (task: TaskContext) => void | Promise<void>,
        private readonly changed: (busy: boolean) => void,
    ) {}
    /** 正在执行或清理时重复触发返回 false；错误保持原样交给调用方。 */
    async press(): Promise<boolean> {
        this.owner.signal.throwIfAborted();
        if (this.busy) return false;
        this.busy = true;
        const operation = this.owner.child('button-operation');
        try {
            this.changed(true);
            await new Actions(operation).exclusive('press', this.work);
            return true;
        } finally {
            try {
                await operation.close();
            } finally {
                this.busy = false;
                if (!this.owner.signal.aborted) this.changed(false);
            }
        }
    }
}
