import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { CalendarUnit } from '../../../../../framework/time/calendar';
import type { Scope } from '../../../../../framework/core/scope';
import { TimeService } from '../../../../../framework/time/time-service';
import { LabClock } from '../services/LabClock';
import { TimeLabPageBinding } from './generated/TimeLabPageBinding';
const { ccclass } = _decorator;
/** 使用真实 TimeService + 注入时钟观察时间行为；全程不修改应用级时钟。 */
@ccclass('showcase.TimeLabPage')
export class TimeLabPage extends TimeLabPageBinding {
    private renderLive?: () => void;
    private elapsed = 0;
    protected onShow(show: ViewShowContext<void, void>): void {
        let owner: Scope | undefined;
        let clock: LabClock;
        let service: TimeService;
        let server: TimeService;
        let lines: string[] = [];
        const render = () =>
            show.commit(() => {
                this.lblOutput.string = [
                    `真实应用：${show.time.calendar.format(show.time.nowMs())}`,
                    `实验 UTC+8：${service.calendar.format(service.nowMs())} · ${service.snapshot().quality}`,
                    ...lines.slice(-4),
                ].join('\n');
            });
        const record = (text: string) => {
            lines = [...lines, text].slice(-4);
            render();
        };
        const create = () => {
            owner = show.scope.child('time-lab');
            clock = new LabClock();
            service = new TimeService(
                clock,
                owner,
                {
                    calendar: { offsetMinutes: 480, resetMinute: 240, weekStartsOn: 1 },
                },
                (error) => record(String(error)),
            );
            // 校时实验独立于本地日历，避免未校时/样本过期使跨日实验暂停。
            server = new TimeService(
                clock,
                owner,
                {
                    calendar: { offsetMinutes: 480 },
                    autoSync: false,
                    sampleCount: 1,
                    source: {
                        sample: async (requestId, task) => {
                            task.signal.throwIfAborted();
                            const now = clock.deviceNowMs() + 120000;
                            return { requestId, receivedAtMs: now, sentAtMs: now };
                        },
                    },
                },
                (error) => record(String(error)),
            );
            const time = service.in(owner);
            for (const unit of ['day', 'week', 'month', 'year'] as const)
                time.onBoundary(unit, (event) =>
                    record(`${unit}：${event.reason} · 跳过 ${event.missedCount ?? 0} 期`),
                );
            time.afterPeriod({ unit: 'week', count: 1 }, () => record('afterPeriod：从注册起一周到期一次'));
            time.everyPeriod({ unit: 'month', count: 1 }, (event) =>
                record(`每月锚点：${service.calendar.format(event.scheduledAtMs, 'date')}`),
            );
            time.at(time.nowMs() + 86400000, () => record('at：指定绝对截止时间已到'));
            time.onChanged(() => render());
            lines = ['日切 04:00 · 周一开始 · 初始 1 月 31 日', '可跨月观察月末截断；后台多期合并通知。'];
            render();
        };
        create();
        this.renderLive = render;
        this.elapsed = 0;
        const bind = (button: Button, work: () => void | Promise<void>) =>
            show.listen(button.node, Button.EventType.CLICK, work, (error) => record(String(error)));
        const advance = (unit: CalendarUnit) => {
            const now = clock.deviceNowMs();
            clock.advance(service.calendar.add(now, { unit, count: 1 }) - now);
            render();
        };
        bind(this.btnBack, () => show.ui.back());
        bind(this.btnDay, () => advance('day'));
        bind(this.btnWeek, () => advance('week'));
        bind(this.btnMonth, () => advance('month'));
        bind(this.btnYear, () => advance('year'));
        bind(this.btnBackground, () => {
            clock.setBackground(true);
            clock.advance(3 * 86400000);
            clock.setBackground(false);
            record('模拟后台 3 天后恢复，观察 resume / missedCount。');
        });
        bind(this.btnRewind, () => {
            clock.rewindDay();
            record('仅设备时间回拨一天；已派发期次不会因此重发。');
        });
        bind(this.btnSync, async () => {
            const state = await server.in(owner!).sync();
            record(`模拟服务器快 2 分钟：${state.source} / ${state.quality}`);
        });
        bind(this.btnReset, async () => {
            await show.actions.exclusive('reset', async () => {
                await owner!.close();
                show.signal.throwIfAborted();
                create();
            });
        });
    }
    protected onTick(dt: number): void {
        this.elapsed += dt;
        if (this.elapsed >= 1) {
            this.elapsed %= 1;
            this.renderLive?.();
        }
    }
    protected onHide(): void {
        this.renderLive = undefined;
    }
}
