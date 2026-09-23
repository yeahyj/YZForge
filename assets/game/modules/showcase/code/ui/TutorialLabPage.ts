import { _decorator, Button, Node, ScrollView } from 'cc';
import { TutorialLabPageBinding } from './generated/TutorialLabPageBinding';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { StorageKey } from '../../../../../framework/platform/storage';
import { GuideRunner, type GuideHandle } from '../../../../../framework/guide/guide-runner';
import { GuideTargets } from '../../../../../framework/guide/guide-targets';
import { StorageGuideProgress } from '../../../../../framework/guide/guide-progress';
import { GuideFocusOverlay } from '../../../../../framework/ui/components/guide/guide-focus-overlay';
import { VirtualList, type VirtualListHandle } from '../../../../../framework/ui/components/virtual-list';
import { VirtualListItemPart, type VirtualListDemoRow, virtualRowBadge } from '../components/VirtualListItemPart';
import { ShowcaseRes } from '../../contracts/generated/resources-default';
import { invariant } from '../../../../../framework/core/errors';
const { ccclass } = _decorator;
const DemoState: StorageKey<{ trained: number; claimed: boolean }> = {
    id: 'showcase/tutorial-state',
    version: 1,
    validate: (value): value is { trained: number; claimed: boolean } =>
        !!value &&
        typeof value === 'object' &&
        Number.isSafeInteger((value as { trained: number }).trained) &&
        (value as { trained: number }).trained >= 0 &&
        typeof (value as { claimed: boolean }).claimed === 'boolean',
};
/** 聚焦动画示例：稳定目标、虚拟列表定位、真实按钮输入与可恢复检查点。 */
@ccclass('showcase.TutorialLabPage')
export class TutorialLabPage extends TutorialLabPageBinding {
    private guide?: GuideHandle;
    private list?: VirtualListHandle<VirtualListDemoRow>;
    private targets?: GuideTargets<Node>;
    protected onShow(show: ViewShowContext<void, void>): void {
        const saved = this.ctx.storage.read(DemoState);
        invariant(
            saved.status !== 'invalid' && saved.status !== 'incompatible',
            'DEMO_GUIDE_STATE',
            '演示存档需要恢复',
        );
        let state = saved.value ?? { trained: 0, claimed: false };
        const progress = new StorageGuideProgress(this.ctx.storage.in('showcase'));
        const runner = new GuideRunner(progress),
            targets = new GuideTargets<Node>();
        this.targets = targets;
        targets.register('showcase/train', this.btnTrain.node, show.scope);
        const badge = this.ctx.badges.source(
            virtualRowBadge(21),
            show.scope,
            undefined,
            Number(state.trained > 0 && !state.claimed),
        );
        const display = () => {
            this.lblState.string = `训练 ${state.trained} 次 · 领取 ${Number(state.claimed)} 次`;
            badge.set(Number(state.trained > 0 && !state.claimed));
        };
        const write = (next: typeof state) => {
            this.ctx.storage.set(DemoState, next);
            state = next;
            display();
        };
        const scroll = this.nodeList.getComponent(ScrollView)!;
        const layout = () => ({ itemWidth: scroll.view!.width, itemHeight: 88, spacingY: 8, overscanRows: 1 });
        const list = this.nodeList.getComponent(VirtualList)!.mount<VirtualListDemoRow, VirtualListItemPart>({
            owner: show.scope,
            assets: show.assets,
            prefab: ShowcaseRes.prefab.prefabsVirtualListItemPart,
            part: VirtualListItemPart,
            layout: layout(),
            render: (part, item) => {
                part.render(item);
                targets.register(`showcase/reward/${item.data.id}`, part.node, item.scope);
                const clicked = () => {
                    if (item.data.id !== 21) return;
                    try {
                        item.commit(() => {
                            invariant(state.trained > 0, 'DEMO_TRAIN_FIRST', '请先训练');
                            if (!state.claimed) write({ ...state, claimed: true });
                            this.lblOutput.string = '第 21 项奖励已领取；重复点击不会重复领取。';
                        });
                    } catch (error) {
                        show.commit(() => {
                            this.lblOutput.string = String(error);
                        });
                    }
                };
                part.node.on(Button.EventType.CLICK, clicked);
                const off = item.signal.onAbort(() => part.node.off(Button.EventType.CLICK, clicked));
                item.scope.defer(off);
            },
        });
        this.list = list;
        list.setItems(
            Array.from({ length: 100 }, (_, index) => ({
                id: index + 1,
                title: index === 20 ? '任务 #21 · 点击领取奖励' : `训练任务 #${index + 1}`,
                revision: 0,
            })),
            true,
        );
        show.listen(scroll.view!.node, Node.EventType.SIZE_CHANGED, () => list.setLayout(layout()));
        show.listen(this.btnBack.node, Button.EventType.CLICK, () => show.ui.back());
        show.listen(this.btnTrain.node, Button.EventType.CLICK, () => write({ ...state, trained: state.trained + 1 }));
        const focus = this.nodeFocus.getComponent(GuideFocusOverlay)!;
        const start = async () => {
            if (this.guide && this.guide.inspect().state !== 'ended') return;
            const presentation = focus.begin(show.scope, () => this.guide?.skip());
            try {
                const handle = runner.start(
                    {
                        id: 'training',
                        version: 1,
                        allowSkip: true,
                        steps: [
                            {
                                id: 'train',
                                run: async (task) => {
                                    const target = await targets.wait('showcase/train', task.scope);
                                    await presentation.waitForClick(
                                        target,
                                        {
                                            message: '第 1 步：点击亮区内的“完成一次训练”。\n动画结束后目标才可点击。',
                                            shape: 'circle',
                                        },
                                        task.scope,
                                    );
                                    invariant(state.trained > 0, 'DEMO_TRAIN_FIRST', '训练尚未完成');
                                },
                            },
                            {
                                id: 'reward-21',
                                run: async (task) => {
                                    list.scrollToIndex(20, 'center');
                                    await list.whenIdle();
                                    task.signal.throwIfAborted();
                                    const target = await targets.wait('showcase/reward/21', task.scope);
                                    await presentation.waitForClick(
                                        target,
                                        {
                                            message: '第 2 步：已定位到第 21 项。\n点击亮区条目领取奖励。',
                                            shape: 'rect',
                                        },
                                        task.scope,
                                    );
                                    invariant(state.claimed, 'DEMO_REWARD_PENDING', '奖励尚未领取，进度不会提前完成');
                                },
                            },
                        ],
                    },
                    show.scope,
                );
                this.guide = handle;
                const result = await handle.result;
                show.commit(() => {
                    this.lblOutput.string = `引导 ${{ completed: '已完成', skipped: '已跳过', cancelled: '已取消，可继续' }[result.status]}\n可重置进度再次观看聚焦动画。`;
                });
            } catch (error) {
                show.commit(() => {
                    this.lblOutput.string = `${String(error)}\n再次开始会从未完成的步骤继续。`;
                });
            } finally {
                presentation.close();
            }
        };
        show.listen(this.btnStart.node, Button.EventType.CLICK, start);
        show.listen(this.btnReset.node, Button.EventType.CLICK, async () => {
            this.guide?.cancel();
            await this.guide?.result.catch(() => {});
            show.signal.throwIfAborted();
            progress.reset('training');
            write({ trained: 0, claimed: false });
            list.scrollToIndex(0);
            this.lblOutput.string = '引导和演示状态已重置。点击开始观看圆形收拢与矩形变形过渡。';
        });
        display();
    }
    protected onHide(): void {
        this.guide = undefined;
        this.list = undefined;
        this.targets = undefined;
    }
}
