import { _decorator } from 'cc';
import { eventKey } from '../../../../../framework/core/events';
import { OperationCancelled, reportError } from '../../../../../framework/core/errors';
import type { VirtualListItemContext } from '../../../../../framework/ui/components/virtual-list';
import { VirtualListItemPartBinding } from './generated/VirtualListItemPartBinding';
import { badgeKey } from '../../../../../framework/badges/badge-store';
import { Badge } from '../../../../../framework/ui/components/badge/badge';
const { ccclass } = _decorator;

/** 示例业务模型，与通用虚拟列表无关。 */
export interface VirtualListDemoRow {
    /** 稳定业务 ID，区别于会随排序改变的列表索引。 */
    readonly id: number;
    /** 显示标题。 */
    readonly title: string;
    /** 局部更新次数。 */
    readonly revision: number;
}
/** 示例广播：每个当前绑定应只收到一次，移出窗口即退订。 */
export const VirtualListDemoPulse = eventKey<number>('showcase/virtual-list-pulse');
/** 示例行红点使用稳定业务 ID；排序和节点复用不改变 Key。 */
export const virtualRowBadge = (id: number) => badgeKey(`showcase/list/${id}`);
/** 示例列表的红点汇总入口。 */
export const VirtualListBadges = badgeKey('showcase/list');

/** 业务条目继承现有自动 Binding；每次数据绑定持有独立订阅和异步任务。 */
@ccclass('showcase.VirtualListItemPart')
export class VirtualListItemPart extends VirtualListItemPartBinding {
    /**
     * 完整重置旧显示，并捕获本次 item；不要在 await 后读取被下一次绑定覆盖的成员字段。
     * @param item 本次业务模型、索引和期限，由 VirtualList.mount 的 render 转交。
     */
    render(item: VirtualListItemContext<VirtualListDemoRow>): void {
        this.nodeBadge.getComponent(Badge)!.bind(this.ctx.badges, virtualRowBadge(item.data.id), item.scope);
        this.lblTitle.string = `${item.data.title} · v${item.data.revision}`;
        this.lblDetail.string = '等待异步详情…';
        this.ctx.events.on(
            VirtualListDemoPulse,
            (pulse, task) => {
                task.commit(() => {
                    this.lblDetail.string = `条目 ${item.data.id} · 广播 ${pulse}`;
                });
            },
            item.scope,
        );
        void item
            .run(async (task) => {
                // 模拟一个可取消请求；生产代码可在此使用响应 task.signal 的网络适配器。
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(
                        () => {
                            detach();
                            resolve();
                        },
                        250 + (item.data.id % 5) * 80,
                    );
                    const detach = task.signal.onAbort(() => {
                        clearTimeout(timer);
                        resolve();
                    });
                });
                task.commit(() => {
                    this.lblDetail.string = `条目 ${item.data.id} · 详情已就绪`;
                });
            })
            .catch((error) => {
                if (!(error instanceof OperationCancelled)) reportError(error);
            });
    }
}
