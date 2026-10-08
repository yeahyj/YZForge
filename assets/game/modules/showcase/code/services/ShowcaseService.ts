import type { ModuleContext } from '../../../../../framework/modules/module-manager';
import { eventKey } from '../../../../../framework/core/events';
import { WorkshopChanged } from '../../../workshop/public';

/** 首页展示的数据发生变化；订阅跟随本次显示结束。 */
export const ShowcaseChanged = eventKey<void>('showcase/changed');

/** 首页观察跨模块事件和异步实验结果。日志在模块存活期间保留，页面关闭不清空。 */
export class ShowcaseService {
    private lines: string[] = [];
    private dropped = 0;
    /** 订阅业务事实而非访问任务页面节点，订阅随本模块结束。 */
    constructor(private readonly ctx: ModuleContext) {
        ctx.events.on(
            WorkshopChanged,
            (event) => this.record(`${event.reason} · 进度 ${event.progress} · 金币 ${event.coins}`),
            ctx.scope,
        );
    }
    /** 增加一条观察记录，最多保留 5 条，同时通知已经恢复显示的首页。 */
    record(line: string): void {
        this.lines = [...this.lines, line].slice(-5);
        this.ctx.events.emit(ShowcaseChanged, undefined);
    }
    /** 记录过期 UI 提交被正确拦截的次数。 */
    rejectStaleCommit(): void {
        this.dropped++;
        this.record(`过期界面提交已拦截 × ${this.dropped}`);
    }
    /** 独立副本，渲染方不能修改服务内部记录。 */
    snapshot() {
        return { lines: this.lines.slice(), dropped: this.dropped };
    }
}
