import type { ModuleContext } from '../../../../../framework/modules/module-manager';
import { WorkshopChanged } from '../../../workshop/contracts/workflow';

/** 首页观察跨模块事件和异步实验结果。日志在模块存活期间保留，页面关闭不清空。 */
export class ShowcaseService {
    private lines: string[] = [];
    private dropped = 0;
    /** 订阅业务事实而非访问任务页面节点，订阅随本模块结束。 */
    constructor(ctx: ModuleContext) {
        ctx.events.on(
            WorkshopChanged,
            (event) => this.record(`${event.reason} · 进度 ${event.progress} · 金币 ${event.coins}`),
            ctx.scope,
        );
    }
    /** 增加一条观察记录，最多保留 5 条，供首页恢复显示时读取。 */
    record(line: string): void {
        this.lines = [...this.lines, line].slice(-5);
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
