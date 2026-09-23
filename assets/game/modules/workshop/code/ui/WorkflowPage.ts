import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { TaskCardModel } from '../../contracts/workflow';
import type { WorkflowPageParams } from './WorkflowPage.types';
import type { WorkflowPagePort } from './WorkflowPagePresenter';
import { WorkshopServices } from '../WorkshopServices';
import { WorkshopRes } from '../../contracts/generated/resources-default';
import { TaskPart } from '../components/TaskPart';
import { WorkflowPageBinding } from './generated/WorkflowPageBinding';
import { WorkflowPagePresenter } from './WorkflowPagePresenter';
import { Badge } from '../../../../../framework/ui/components/badge/badge';
import { TaskBadges } from '../../contracts/badges';
const { ccclass } = _decorator;
/** 界面负责节点和输入，把展示流程交给 Presenter；共享业务规则放在模块 Service。 */
@ccclass('workshop.WorkflowPage')
export class WorkflowPage extends WorkflowPageBinding implements WorkflowPagePort {
    private display?: ViewShowContext<WorkflowPageParams, void>;
    private readonly parts = new Map<number, TaskPart>();

    /** 每次展示创建独立 Presenter，事件监听与异步工作归本次 show。 */
    protected async onShow(show: ViewShowContext<WorkflowPageParams, void>): Promise<void> {
        this.display = show;
        this.nodeBadge.getComponent(Badge)!.bind(this.ctx.badges, TaskBadges, show.scope);
        this.parts.clear();
        const presenter = new WorkflowPagePresenter(this.ctx.services(WorkshopServices).tasks, show, this);
        const error = (cause: unknown) =>
            show.commit(() => {
                this.lblOutput.string = String(cause);
            });
        show.listen(this.btnBack.node, Button.EventType.CLICK, () => show.ui.back());
        show.listen(this.btnTrain.node, Button.EventType.CLICK, () => presenter.train(), error);
        show.listen(this.btnFailure.node, Button.EventType.CLICK, () => presenter.failNext());
        show.listen(this.btnReload.node, Button.EventType.CLICK, () => presenter.reload(), error);
        show.listen(this.btnInspect.node, Button.EventType.CLICK, () => {
            const state = this.ctx.diagnostics.snapshot();
            const module = this.ctx.diagnostics.module('workshop');
            this.lblOutput.string = `任务代码已加载：${module.codeReady}\n业务实例存活：${module.businessReady}\n页面栈：${state.pages.join(' → ')}\n配置持有 ${state.configCount} · 资源持有 ${state.resourceCount}`;
        });
        await presenter.start();
    }

    /** 动态 Part 先创建为 inactive，传入模型后激活，避免空数据闪烁。 */
    async mount(cards: readonly TaskCardModel[], claim: (id: number) => Promise<void>): Promise<void> {
        const show = this.display!;
        for (const card of cards) {
            const node = await show.assets.instantiate(WorkshopRes.prefab.prefabsTaskPart, this.nodeItems, {
                active: false,
            });
            if (
                !show.commit(() => {
                    const part = node.getComponent(TaskPart);
                    if (!part) throw Error('TaskPart 组件缺失，请重新生成绑定');
                    part.render(card, claim);
                    this.parts.set(card.id, part);
                    show.assets.activate(node);
                })
            )
                await show.assets.destroyInstance(node);
        }
    }

    /** 唯一的节点渲染入口，参数是展示模型，不执行存档或发奖。 */
    render(cards: readonly TaskCardModel[], summary: string): void {
        for (const card of cards) this.parts.get(card.id)?.render(card);
        this.lblOutput.string = summary;
    }

    /** 动态节点由 show.assets 回收，此处只释放页面保存的引用。 */
    protected onHide(): void {
        this.display = undefined;
        this.parts.clear();
    }
}
