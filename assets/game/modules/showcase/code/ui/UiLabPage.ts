import { _decorator, Button, Node } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { LabParams } from '../../contracts/demo-navigation';
import { ShowcaseViews } from '../../contracts/generated/views';
import { ShowcaseRes } from '../../contracts/generated/resources-default';
import { BadgePart } from '../components/BadgePart';
import { UiLabPageBinding } from './generated/UiLabPageBinding';
const { ccclass } = _decorator;
/** 五种 UI 层、结果、缓存、重复策略与 Part 组合实验；简单输入无需额外 Presenter。 */
@ccclass('showcase.UiLabPage')
export class UiLabPage extends UiLabPageBinding {
    protected onShow(show: ViewShowContext<LabParams, void>): void {
        let part: Node | undefined;
        const output = (text: string) =>
            show.commit(() => {
                this.lblOutput.string = text;
            });
        const bind = (button: Button, work: () => void | Promise<void>) =>
            show.listen(button.node, Button.EventType.CLICK, work, (error) => output(String(error)));
        bind(this.btnBack, () => show.back());
        const confirm = async (cached: boolean) => {
            const handle = await this.ctx.ui.open(
                ShowcaseViews.confirmPopup,
                {
                    title: cached ? '实例缓存实验' : '类型化弹窗',
                    detail: '确认返回 completed / true；取消返回 cancelled。\n此弹窗采用 keep-one，重新打开会复用闲置节点。',
                },
                show.scope,
            );
            const result = await handle.result;
            output(
                `弹窗结果：${result.status}\n${result.status === 'completed' ? result.value : '没有业务值'}\n下次打开观察“实例展示次数”和 showId。`,
            );
        };
        bind(this.btnPopup, () => confirm(false));
        bind(this.btnCached, () => confirm(true));
        bind(this.btnOverlay, async () => {
            const state = show.params.navigation.inspect();
            await this.ctx.ui.open(
                ShowcaseViews.inspectOverlay,
                {
                    title: 'Overlay / 运行快照',
                    detail: `页面 ${state.pages.length} · 资源 ${state.resourceCount}\n配置 ${state.configCount} · 已准备包 ${state.bundles.length}\nOverlay 默认不阻挡下层输入。`,
                },
                show.scope,
            );
            output('覆盖层已打开，可继续操作下层；点击覆盖层按钮关闭。');
        });
        bind(this.btnToast, async () => {
            await this.ctx.ui.open(
                ShowcaseViews.noticeToast,
                { title: 'Toast 提示', detail: 'onTick 累计 1.8 秒后自动结束。' },
                show.scope,
            );
            output('Toast 属于当前 show，退出页面会一起关闭。');
        });
        bind(this.btnLoading, async () => {
            const handle = await this.ctx.ui.open(
                ShowcaseViews.progressLoading,
                {
                    title: 'Loading / 模拟准备',
                    detail: '加载层阻挡下层输入。\n点确认模拟准备完成；点取消结束本次等待。',
                },
                show.scope,
            );
            const result = await handle.result;
            output(`加载层已结束：${result.status}\n这里是手动控制的准备实验，不假装发起网络请求。`);
        });
        bind(this.btnPart, async () => {
            if (part) {
                const previous = part;
                part = undefined;
                await show.assets.destroyInstance(previous);
                output('动态 Part 已销毁；引用和激活期监听一起清理。');
            } else {
                const node = await show.assets.instantiate(ShowcaseRes.prefab.prefabsBadgePart, this.nodeContent, {
                    active: false,
                });
                show.commit(() => {
                    part = node;
                    node.setSiblingIndex(0);
                    node.getComponent(BadgePart)!.render('父页面传入数据 · 独立 Part · 点击按钮移除');
                    show.assets.activate(node);
                });
                output('Part 已插入列表顶部；有独立激活期，不进入页面栈。');
            }
        });
        bind(this.btnDuplicate, async () => {
            const first = await this.ctx.ui.open(
                ShowcaseViews.confirmPopup,
                { title: '重复打开检查', detail: '第一个弹窗正常打开；第二次同名打开被 reject。' },
                show.scope,
            );
            try {
                await this.ctx.ui.open(ShowcaseViews.confirmPopup, { title: '重复', detail: '' }, show.scope);
                output('异常：重复打开未被拒绝。');
            } catch (error) {
                output(`预期拒绝：${String(error)}\n第一个弹窗仍可正常结束。`);
            }
            await first.result;
        });
        bind(this.btnPage, async () => {
            await show.params.navigation.open('guide');
        });
        output(
            `本次 showId：${show.showId}\n页面 → 弹窗 → 覆盖层 → 提示 → 加载层\n压入指南页后返回，onShow 会重新执行。\nPart 用父对象组合，UI 用类型化参数与结果通信。`,
        );
    }
}
