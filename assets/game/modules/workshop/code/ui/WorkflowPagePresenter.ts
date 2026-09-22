import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { TasksRow } from '../../contracts/generated/config/Tasks.types';
import type { TaskCardModel } from '../../contracts/workflow';
import type { WorkflowPageParams } from './WorkflowPage.types';
import type { TaskService } from '../services/TaskService';
import { WorkshopViews } from '../generated/views';

/** Presenter 只持有渲染能力，不接触 Cocos 节点。 */
export interface WorkflowPagePort {
    /** 初次创建任务卡片，卡片输入以业务 ID 回传。 */
    mount(cards: readonly TaskCardModel[], claim: (id: number) => Promise<void>): Promise<void>;
    /** 同步更新已有卡片和摘要，不在渲染中执行领域命令。 */
    render(cards: readonly TaskCardModel[], summary: string): void;
}

/** 一次页面展示的协调器：取数、确认、命令、反馈。领域规则由 TaskService 再次检查。 */
export class WorkflowPagePresenter {
    private rows: readonly TasksRow[] = [];
    private note = '点击完成训练，再点击卡片领取奖励。';

    /** 本次 show.ui 提供弹窗交互，渲染由 view 承担；任务状态由模块 Service 持有。 */
    constructor(
        private readonly service: TaskService,
        private readonly show: ViewShowContext<WorkflowPageParams, void>,
        private readonly view: WorkflowPagePort,
    ) {}

    /** 展示初始化；订阅和资源跟随本次 show，返回页面时重新获取最新状态。 */
    async start(): Promise<void> {
        this.rows = await this.service.load(this.show.scope);
        this.show.signal.throwIfAborted();
        await this.view.mount(this.service.cards(this.rows), (id) => this.claim(id));
        // subscribe 立即推送当前状态，随后同时观察训练和账号变化。
        this.service.subscribe(() => this.refresh(), this.show.scope);
    }

    /** 转发输入为领域命令，不通过修改 Label 来修改训练次数。 */
    train(): void {
        this.service.train();
        this.note = '训练已保存；业务事件通知页面和展示大厅。';
        this.refresh();
    }

    /** 只在示例中注入一次可恢复故障。 */
    failNext(): void {
        this.service.simulateFailure();
        this.note = '下一次领取将失败；失败后可再次领取。';
        this.refresh();
    }

    /** 连续刷新仅接受最后一次结果，防止旧配置请求覆盖新结果。 */
    async reload(): Promise<void> {
        await this.show.actions.latest('reload', async (task) => {
            const rows = await this.service.load(task.scope);
            task.commit(() => {
                this.rows = rows;
                this.note = '配置重新读取完成，存档与领取状态保留。';
                this.refresh();
            });
        });
    }

    /** 同一展示期间合并重复点击；弹窗取消不执行领域命令。 */
    async claim(id: number): Promise<void> {
        await this.show.actions.exclusive('claim', async (task) => {
            const row = this.rows.find((item) => item.id === id);
            if (!row) throw Error(`任务不存在：${id}`);
            const popup = await this.show.ui.open(
                WorkshopViews.claimPopup,
                {
                    title: `领取「${row.name}」`,
                    detail: `奖励 ${row.reward} 金币。\n取消不会修改状态；重复命令不会重复发放。`,
                },
                { owner: task.scope },
            );
            const result = await popup.result;
            task.signal.throwIfAborted();
            if (result.status === 'failed') {
                task.commit(() => {
                    this.note = `确认界面失败，未提交领取：${String(result.error)}`;
                    this.refresh();
                });
                return;
            }
            if (result.status !== 'completed' || !result.value) {
                task.commit(() => {
                    this.note = '已取消，业务状态未改变。';
                    this.refresh();
                });
                return;
            }
            let granted: boolean;
            try {
                granted = this.service.claim(row.id);
            } catch (error) {
                task.commit(() => {
                    this.note = String(error);
                    this.refresh();
                });
                return;
            }
            task.commit(() => {
                this.note = granted ? '奖励已保存；余额和领取记录一次写入。' : '已领取，不重复增加余额。';
                this.refresh();
            });
            // 业务成功以存档提交为准；视觉反馈不参与发奖事务。
        });
    }

    private refresh(): void {
        const state = this.service.snapshot();
        this.show.commit(() =>
            this.view.render(
                this.service.cards(this.rows),
                `训练 ${state.progress} 次 · 余额 ${state.coins} 金币\n${this.note}\nService → Presenter → Page / Part\n模块通信：公开 API + 类型化事件`,
            ),
        );
    }
}
