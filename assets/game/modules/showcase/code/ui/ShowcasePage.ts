import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { LabParams, DemoPage } from '../../contracts/demo-navigation';
import { ShowcaseServices } from '../ShowcaseServices';
import { ShowcasePageBinding } from './generated/ShowcasePageBinding';
const { ccclass } = _decorator;
/** 展示应用入口；这是可删除的示例业务，不是框架内置首页。 */
@ccclass('showcase.ShowcasePage')
export class ShowcasePage extends ShowcasePageBinding {
    protected onShow(show: ViewShowContext<LabParams, void>): void {
        this.btnBack.node.active = false;
        const routes: readonly [Button, DemoPage][] = [
            [this.btnWorkflow, 'workflow'],
            [this.btnUi, 'ui'],
            [this.btnData, 'data'],
            [this.btnTime, 'time'],
            [this.btnAsync, 'async'],
            [this.btnStorage, 'storage'],
            [this.btnGuide, 'guide'],
            [this.btnLegacy, 'legacy'],
        ];
        for (const [button, route] of routes)
            show.listen(
                button.node,
                Button.EventType.CLICK,
                async () => {
                    await show.params.navigation.open(route);
                },
                (error) =>
                    show.commit(() => {
                        this.lblOutput.string = String(error);
                    }),
            );
        const state = show.params.navigation.inspect();
        const events = this.ctx.services(ShowcaseServices).showcase.snapshot();
        this.lblOutput.string = [
            '三种展示：可交互实验 / 编辑器工作流 / 边界与失败验证',
            `任务代码 ${state.workshopCodeReady ? '已加载' : '未加载'} · 任务业务 ${state.workshopBusinessReady ? '存活' : '未创建'}`,
            `已拦截过期回写 ${events.dropped} 次`,
            ...events.lines.slice(-2),
        ].join('\n');
    }
}
