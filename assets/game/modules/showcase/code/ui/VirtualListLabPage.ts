import { _decorator, Button, Node, ScrollView } from 'cc';
import {
    VirtualList,
    type VirtualListHandle,
    type VirtualListLayout,
} from '../../../../../framework/ui/components/virtual-list';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import { VirtualListItemPart, VirtualListDemoPulse, type VirtualListDemoRow } from '../components/VirtualListItemPart';
import { ShowcaseRes } from '../../contracts/generated/resources-default';
import { VirtualListLabPageBinding } from './generated/VirtualListLabPageBinding';
const { ccclass } = _decorator;
/** 一万条业务数据的列表/网格示例，演示局部刷新、定位、订阅与异步清理。 */
@ccclass('showcase.VirtualListLabPage')
export class VirtualListLabPage extends VirtualListLabPageBinding {
    private list?: VirtualListHandle<VirtualListDemoRow>;
    protected onShow(show: ViewShowContext<void, void>): void {
        const rows = Array.from({ length: 10000 }, (_, index) => ({
            id: index + 1,
            title: `条目 #${index + 1}`,
            revision: 0,
        }));
        let grid = false;
        let pulse = 0;
        const scroll = this.nodeList.getComponent(ScrollView)!;
        const layout = (): VirtualListLayout => {
            const width = scroll.view!.width;
            return {
                itemWidth: grid ? (width - 24) / 3 : width,
                itemHeight: 88,
                columns: grid ? 3 : 1,
                spacingX: 12,
                spacingY: 8,
                overscanRows: 1,
            };
        };
        const component = this.nodeList.getComponent(VirtualList)!;
        const list = component.mount<VirtualListDemoRow, VirtualListItemPart>({
            owner: show.scope,
            assets: show.assets,
            prefab: ShowcaseRes.prefab.prefabsVirtualListItemPart,
            part: VirtualListItemPart,
            layout: layout(),
            render: (part, item) => part.render(item),
        });
        this.list = list;
        list.setItems(rows, true);
        // 列表本身固定尺寸；示例页面在视口变化时明确重新计算三列的宽度。
        show.listen(scroll.view!.node, Node.EventType.SIZE_CHANGED, () => list.setLayout(layout()));
        const bind = (button: Button, action: () => void) => show.listen(button.node, Button.EventType.CLICK, action);
        bind(this.btnBack, () => show.ui.back());
        bind(this.btnMode, () => {
            grid = !grid;
            list.setLayout(layout());
        });
        bind(this.btnJump, () => {
            if (list.count) list.scrollToIndex(Math.min(4999, list.count - 1), 'center', 0.25);
        });
        bind(this.btnTop, () => {
            if (list.count) list.scrollToIndex(0);
        });
        bind(this.btnData, () => list.setItems(list.count ? [] : rows, true));
        bind(this.btnRefresh, () => {
            const { start, end } = list.inspect().range;
            for (let index = start; index < end; index++) {
                rows[index] = { ...rows[index], revision: rows[index].revision + 1 };
                list.updateItem(index, rows[index]);
            }
        });
        bind(this.btnEvent, () => this.ctx.events.emit(VirtualListDemoPulse, ++pulse));
    }
    protected onTick(): void {
        if (!this.list) return;
        const state = this.list.inspect();
        const window = state.count ? `${state.range.start + 1}–${state.range.end}` : '空';
        this.lblOutput.string = `数据 ${state.count} 条 · 实例 ${state.slots} 个\n窗口 ${window} · 待处理 ${state.pending}`;
    }
    protected onHide(): void {
        this.list = undefined;
    }
}
