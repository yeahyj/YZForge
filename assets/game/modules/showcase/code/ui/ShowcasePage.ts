import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import { ShowcaseViews } from '../generated/views';
import { WorkshopViews } from '../../../workshop/contracts/generated/views';
import { LobbyViews } from '../../../lobby/contracts/generated/views';
import { ShowcaseServices } from '../ShowcaseServices';
import { ShowcasePageBinding } from './generated/ShowcasePageBinding';
import { Badge } from '../../../../../framework/ui/components/badge/badge';
import { TaskBadges } from '../../../workshop/contracts/badges';
const { ccclass } = _decorator;
/** 展示应用入口；这是可删除的示例业务，不是框架内置首页。 */
@ccclass('showcase.ShowcasePage')
export class ShowcasePage extends ShowcasePageBinding {
    protected onShow(show: ViewShowContext<void, void>): void {
        this.nodeBadge.getComponent(Badge)!.bind(this.ctx.badges, TaskBadges, show.scope);
        this.btnBack.node.active = false;
        const routes: readonly [Button, () => Promise<unknown>][] = [
            [this.btnWorkflow, () => show.ui.pushPage(WorkshopViews.workflowPage, undefined)],
            [this.btnUi, () => show.ui.pushPage(ShowcaseViews.uiLabPage, undefined)],
            [this.btnData, () => show.ui.pushPage(ShowcaseViews.dataLabPage, undefined)],
            [this.btnTime, () => show.ui.pushPage(ShowcaseViews.timeLabPage, undefined)],
            [this.btnAsync, () => show.ui.pushPage(ShowcaseViews.asyncLabPage, undefined)],
            [this.btnStorage, () => show.ui.pushPage(ShowcaseViews.storageLabPage, undefined)],
            [this.btnGuide, () => show.ui.pushPage(ShowcaseViews.guidePage, undefined)],
            [this.btnLegacy, () => show.ui.pushPage(LobbyViews.dashboard, { title: '综合示例' })],
            [this.btnResources, () => show.ui.pushPage(ShowcaseViews.resourceLabPage, undefined)],
        ];
        for (const [button, route] of routes)
            show.listen(
                button.node,
                Button.EventType.CLICK,
                async () => {
                    await route();
                },
                (error) =>
                    show.commit(() => {
                        this.lblOutput.string = String(error);
                    }),
            );
        const state = this.ctx.diagnostics.module('workshop');
        const events = this.ctx.services(ShowcaseServices).showcase.snapshot();
        this.lblOutput.string = [
            '三种展示：可交互实验 / 编辑器工作流 / 边界与失败验证',
            `任务代码 ${state.codeReady ? '已加载' : '未加载'} · 任务业务 ${state.businessReady ? '存活' : '未创建'}`,
            `已拦截过期回写 ${events.dropped} 次`,
            ...events.lines.slice(-2),
        ].join('\n');
    }
}
