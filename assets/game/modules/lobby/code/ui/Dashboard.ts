import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { DashboardParams, DashboardResult } from './Dashboard.types';
import { ItemsTable } from '../generated/config/Items.table';
import { LobbyRes } from '../../contracts/generated/resources-default';
import { LobbyViews } from '../../contracts/generated/views';
import { DashboardBinding } from './generated/DashboardBinding';
const { ccclass } = _decorator;
@ccclass('lobby.Dashboard')
export class Dashboard extends DashboardBinding {
    private elapsed = 0;
    private popupBusy = false;
    protected async onShow(show: ViewShowContext<DashboardParams, DashboardResult>): Promise<void> {
        this.lblStatus.string = '自动绑定已验证 · 资源包 m-lobby';
        await this.readItems(show);
        this.refreshClock(show);
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
                const popup = await this.ctx.ui.open(
                    LobbyViews.rewardPopup,
                    { title: '每日体验奖励', amount: 100 },
                    show.scope,
                );
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
        const items = await this.ctx.config.load(ItemsTable, show.scope);
        show.commit(() => {
            this.lblItems.string = `按需读取 ${items.size} 条配置\n${items.require(1).name} × ${items.require(1).amount}  ·  JSON 数据 / TS 合同`;
        });
    }
    private refreshClock(show: ViewShowContext<DashboardParams, DashboardResult>): void {
        this.lblTime.string = show.time.calendar.format(show.time.nowMs(), 'datetime', 480);
    }
    protected onTick(dt: number, show: ViewShowContext<DashboardParams, DashboardResult>): void {
        this.elapsed += dt;
        if (this.elapsed >= 1) {
            this.elapsed %= 1;
            this.refreshClock(show);
        }
    }
}
