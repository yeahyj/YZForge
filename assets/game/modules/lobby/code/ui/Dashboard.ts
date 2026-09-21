import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { DashboardParams, DashboardResult } from './Dashboard.types';
import { ItemsTable } from '../generated/config/Items.table';
import { LobbyRes } from '../../contracts/generated/resources-default';
import { LobbyViews } from '../../contracts/generated/views';
import { DashboardBinding } from './generated/DashboardBinding';
const { ccclass } = _decorator;
/**
 * 框架 API 演示页面：配置、时间、节点事件、弹窗结果、音频及动态图片。
 * 继承自动生成的 DashboardBinding 直接取得节点，不需要在业务脚本中查路径或手动拖引用。
 */
@ccclass('lobby.Dashboard')
export class Dashboard extends DashboardBinding {
    private elapsed = 0;
    private popupBusy = false;
    /**
     * 每次展示时加载数据、注册输入和日切通知；框架等待此方法完成后才允许交互。
     * @param show - 仅属于本次展示的上下文。资源与监听用 show.scope，await 后更新 UI 用 show.commit。
     */
    protected async onShow(show: ViewShowContext<DashboardParams, DashboardResult>): Promise<void> {
        this.lblStatus.string = '自动绑定已验证 · 资源包 m-lobby';
        await this.readItems(show);
        this.refreshClock(show);
        // 监听业务日变化，并通过 emitCurrent 在注册后先刷新当前日。480 是 UTC+8 的分钟偏移。
        show.time.onBoundary(
            'day',
            (event) => {
                show.commit(() => {
                    this.lblPeriod.string = `当前业务日：${event.occurrenceKey.split(':')[1]}\n本地时间 · 周一为每周开始`;
                });
            },
            { emitCurrent: true, offsetMinutes: 480 },
        );
        show.listen(this.btnReward.node, Button.EventType.CLICK, async () => {
            if (this.popupBusy) return;
            this.popupBusy = true;
            try {
                // 子弹窗属于当前页面展示；页面结束时会同时关闭它。
                const popup = await this.ctx.ui.open(
                    LobbyViews.rewardPopup,
                    { title: '每日体验奖励', amount: 100 },
                    show.scope,
                );
                // open 等待打开完成，result 另行等待玩家选择或外部关闭。
                const result = await popup.result;
                show.commit(() => {
                    this.lblResult.string =
                        result.status === 'completed' && result.value.claimed
                            ? `已领取 ${result.value.amount} 金币。\n弹窗任务和资源已完成清理。`
                            : '本次未领取奖励，可以再次打开。';
                });
            } finally {
                show.commit(() => {
                    this.popupBusy = false;
                });
            }
        });
        show.listen(this.btnReload.node, Button.EventType.CLICK, async () => {
            await this.readItems(show);
            show.commit(() => {
                this.lblResult.string = '配置读取完成。\n相同 Scope 内复用共享加载结果。';
            });
        });
        show.listen(this.btnAudio.node, Button.EventType.CLICK, async () => {
            this.ctx.audio.resumeFromGesture();
            const handle = await this.ctx.audio.play(LobbyRes.audio.confirm, show.scope);
            await handle.ended;
            show.commit(() => {
                this.lblResult.string = '音效播放完成，播放句柄已结束。';
            });
        });
        await show.setSprite(this.sprIcon, LobbyRes.sprite.status);
    }
    private async readItems(show: ViewShowContext<DashboardParams, DashboardResult>): Promise<void> {
        // ItemsTable 只有类型和结构合同；load 按发布路由加载 JSON，引用跟随本次展示。
        const items = await this.ctx.config.load(ItemsTable, show.scope);
        // 异步期间页面可能已退出；过期 show 的 commit 会跳过，防止旧结果写回。
        show.commit(() => {
            this.lblItems.string = `按需读取 ${items.size} 条配置\n${items.require(1).name} × ${items.require(1).amount}  ·  JSON 数据 / TS 合同`;
        });
    }
    private refreshClock(show: ViewShowContext<DashboardParams, DashboardResult>): void {
        // nowMs 是 UTC 毫秒时间戳；datetime 选择日期+时分秒，480 按 UTC+8 展示。
        // calendar 是纯工具，不自动继承面板的日历偏移，因此这里明确传入 480。
        this.lblTime.string = show.time.calendar.format(show.time.nowMs(), 'datetime', 480);
    }
    /**
     * 可交互期间每帧调用；这里只累计到约一秒刷新一次时钟文字，不代表业务日切通知。
     * @param dt - 帧间隔，单位秒；60 FPS 时约 0.0167。
     * @param show - 当前有效的展示上下文，挂起或关闭后不再调用此钩子。
     */
    protected onTick(dt: number, show: ViewShowContext<DashboardParams, DashboardResult>): void {
        this.elapsed += dt;
        if (this.elapsed >= 1) {
            this.elapsed %= 1;
            this.refreshClock(show);
        }
    }
}
