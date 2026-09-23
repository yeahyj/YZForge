import { _decorator, Button, screen, view } from 'cc';
import type { TaskContext } from '../../../../../framework/core/scope';
import { OperationCancelled, reportError } from '../../../../../framework/core/errors';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import { ComponentsLabPageBinding } from './generated/ComponentsLabPageBinding';
const { ccclass } = _decorator;
/** 示例延迟：主动响应任务取消，关闭页面不会留下定时器。 */
async function waitForDemo(task: TaskContext, ms: number): Promise<void> {
    task.signal.throwIfAborted();
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            off();
            resolve();
        }, ms);
        const off = task.signal.onAbort(() => {
            clearTimeout(timer);
            resolve();
        });
    });
    task.signal.throwIfAborted();
}
/** 通用组件示例；继承原生控件，子节点切换和滚动文本直接在 Inspector 配置。 */
@ccclass('showcase.ComponentsLabPage')
export class ComponentsLabPage extends ComponentsLabPageBinding {
    protected onShow(show: ViewShowContext<void, void>): void {
        const report = (error: unknown) => {
            if (!(error instanceof OperationCancelled)) reportError(error);
        };
        const click = (button: Button, work: () => void | Promise<void>) =>
            show.listen(button.node, Button.EventType.CLICK, work, report);
        click(this.btnBack, () => show.ui.back());
        let submitted = 0;
        this.lblSubmit.string = '完成 0 次';
        click(this.btnSubmit, async () => {
            await this.btnSubmit.run(async (task) => {
                await waitForDemo(task, 700);
                task.commit(() => {
                    this.lblSubmit.string = `完成 ${++submitted} 次`;
                });
            });
        });
        // 换图、Switch、倒计时和滚动文字直接在 Inspector 配置事件。
        const safe = this.compSafe;
        this.lblSafe.string = '安全区：设备实际边距';
        click(this.btnSafe, () => {
            safe.simulate = !safe.simulate;
            const size = view.getVisibleSize(),
                landscape = screen.windowSize.width > screen.windowSize.height;
            const viewport = view.getViewportRect();
            // 模拟缺口越过预览窗口已有的留白，保证固定设计尺寸下仍能看到避让。
            safe.previewTop = landscape
                ? 0
                : Math.max(0, (screen.windowSize.height - viewport.y) / view.getScaleY() - size.height) + 72;
            safe.previewBottom = landscape ? 0 : Math.max(0, viewport.y / view.getScaleY()) + 24;
            safe.previewLeft = landscape ? Math.max(0, viewport.x / view.getScaleX()) + 72 : 0;
            safe.previewRight = landscape
                ? Math.max(0, (screen.windowSize.width - viewport.x) / view.getScaleX() - size.width) + 24
                : 0;
            safe.refresh();
            this.lblSafe.string = safe.simulate ? '安全区：预览模拟已开启' : '安全区：设备实际边距';
        });
    }
}
