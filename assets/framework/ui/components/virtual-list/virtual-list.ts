import { _decorator, Component, isValid, Layout, Node, ScrollView, UITransform, Vec2, Widget } from 'cc';
import type { ScopedAssets } from '../../../assets/asset-manager';
import type { AssetKey } from '../../../assets/asset-types';
import { GameComponent } from '../../../core/game-component';
import { type ErrorReporter, invariant, reportError } from '../../../core/errors';
import type { Lifetime } from '../../../core/scope';
import {
    VirtualListController,
    type VirtualListItemContext,
    type VirtualListSnapshot,
} from './virtual-list-controller';
import { FixedVirtualLayout, type VirtualListAlignment, type VirtualListLayout } from './virtual-list-layout';

const { ccclass, requireComponent, disallowMultiple } = _decorator;

/** 一次列表会话的装配参数；业务预制体、Part 类型及渲染逻辑均由调用方提供。 */
export interface VirtualListOptions<T, Part extends GameComponent> {
    /** 列表的使用期限，通常为 show.scope 或 activation.scope。 */
    readonly owner: Lifetime;
    /** 当前业务宿主的资源入口；内部重新绑定到每个实例的期限。 */
    readonly assets: ScopedAssets;
    /** 业务模块 dynamic 目录下生成的 Prefab Key；框架目录不存业务条目。 */
    readonly prefab: AssetKey<'Prefab'>;
    /** 预制体根节点上的业务 Part 类，通常继承自动生成的 Binding。 */
    readonly part: new () => Part;
    /** 固定尺寸、列数、间距、边距和预备行配置。 */
    readonly layout: VirtualListLayout;
    /**
     * 每次绑定和刷新时调用；须完整重置文本、颜色、按钮等业务显示状态。
     * @param part 可重复使用的 Part；不要把旧模型或旧上下文永久保存在节点监听中。
     * @param item 本次索引、模型及 Scope。订阅与图片持有使用 item.scope，异步工作使用 item.run。
     * @returns 可异步准备；完成后才激活 Part。长期更新应放在 item.run 中并用 task.commit 提交。
     */
    readonly render: (part: Part, item: VirtualListItemContext<T>) => void | Promise<void>;
    /** 可选同步错误上报器，不应抛错；失败条目保持隐藏，refresh 或重新进入窗口后重试。 */
    readonly onError?: ErrorReporter;
}

/** 一次挂载的类型化操作入口；结束后不能再更新数据，dispose 可重复调用。 */
export interface VirtualListHandle<T> {
    /** 当前数据数量。 */
    readonly count: number;
    /**
     * 替换数据并刷新窗口；复制数组但不深复制元素，默认保留像素偏移并夹紧边界。
     * @param items 新数据序列；追加、删除、排序后传入新的完整序列。
     * @param resetScroll 为 true 时回到顶部，默认 false。
     */
    setItems(items: readonly T[], resetScroll?: boolean): void;
    /**
     * 替换一个模型并仅刷新该索引。
     * @param index 要替换的零基索引；越界抛出 VIRTUAL_LIST_INDEX。
     * @param data 新模型引用；离屏时保存数据，进入窗口后再渲染。
     */
    updateItem(index: number, data: T): void;
    /**
     * 刷新指定索引；先完整校验再执行，重复索引只刷新一次。
     * @param indices 要刷新的索引集合；省略则刷新当前窗口，离屏项下次进入时读取最新数据。
     * @throws VIRTUAL_LIST_INDEX 集合中含越界或非整数索引，当前绑定不改变。
     */
    refresh(indices?: Iterable<number>): void;
    /**
     * 修改固定尺寸/列数配置并重新排布；仍可见条目不重新绑定数据。
     * @param layout 完整的新布局；列数不随屏幕宽度自动变化。
     * @throws VIRTUAL_LIST_LAYOUT 参数非法；VIRTUAL_LIST_SETUP 总列宽超过视口；原配置保留。
     */
    setLayout(layout: VirtualListLayout): void;
    /**
     * 滚动到指定零基索引；索引越界（含空列表）时抛错。
     * @param index 目标条目的零基索引。
     * @param alignment start/center/end/nearest，默认 start。
     * @param durationSeconds 动画秒数，默认 0（立即）；返回不代表动画结束。
     */
    scrollToIndex(index: number, alignment?: VirtualListAlignment, durationSeconds?: number): void;
    /**
     * 等待当前加载、渲染和回收完成；不等待滚动动画及仍在显示的条目的长期任务。
     * @returns 当前操作及其后续调度结束后兑现；业务渲染错误交给 onError，不通过此 Promise 重抛。
     */
    whenIdle(): Promise<void>;
    /** 获取冻结的数据量、窗口和实例数快照，供诊断及性能检查；不延长资源期限。 */
    inspect(): VirtualListSnapshot;
    /**
     * 同步取消并隐藏条目，等待任务、订阅及实例完整清理；父级结束时自动调用。
     * 不要在 item.run / render 中 await 自己列表的 dispose 或 whenIdle。
     * @returns 本会话的清理屏障；关闭期间清理失败时，在其余清理完成后以 SCOPE_CLEANUP_FAILED 拒绝。
     */
    dispose(): Promise<void>;
}

/**
 * 固定尺寸纵向虚拟列表/网格。挂在 ScrollView 同一节点，使用标准 View/Mask/Content 结构。
 * Content 必须为空且不受 Layout/Widget 驱动；本组件管理其锚点、尺寸和条目位置，ScrollView 管滚动。
 * 页面每次 onShow 用 mount 创建会话；禁用、销毁或 owner 结束时取消会话，重新启用须重新 mount。
 */
@ccclass('yzforge.VirtualList')
@requireComponent(ScrollView)
@disallowMultiple
export class VirtualList extends Component {
    private session?: { dispose(): Promise<void> };

    /**
     * 装配业务 Part 工厂并建立列表会话，之后通过返回的 handle 传入数据。
     * @param options 本次所有者、资源入口、业务条目与固定布局。
     * @returns 仅属于本次挂载的类型化入口，不能跨页面展示复用。
     * @throws VIRTUAL_LIST_SETUP 结构、布局所有权或尺寸非法；VIRTUAL_LIST_MOUNTED 旧会话尚未清理。
     */
    mount<T, Part extends GameComponent>(options: VirtualListOptions<T, Part>): VirtualListHandle<T> {
        options.owner.signal.throwIfAborted();
        invariant(!this.session, 'VIRTUAL_LIST_MOUNTED', '旧列表会话必须完整清理后才能重新挂载');
        invariant(this.enabledInHierarchy, 'VIRTUAL_LIST_SETUP', '列表组件必须已启用');
        const scroll = this.getComponent(ScrollView);
        const content = scroll?.content;
        const view = scroll?.view;
        const transform = content?.getComponent(UITransform);
        invariant(
            scroll && content && view && transform && content.parent === view.node,
            'VIRTUAL_LIST_SETUP',
            '需要 ScrollView / View / Content 及 UITransform',
        );
        invariant(content.children.length === 0, 'VIRTUAL_LIST_SETUP', 'Content 必须为空，条目由列表创建');
        this.assertManualLayout(content);
        invariant(
            content.scale.x === 1 && content.scale.y === 1 && content.eulerAngles.z === 0,
            'VIRTUAL_LIST_SETUP',
            'Content 必须使用单位缩放且不旋转',
        );
        type Cell = { node: Node; part: Part };
        const report = options.onError ?? reportError;
        const controller = new VirtualListController<T, Cell>(
            options.owner,
            options.layout,
            {
                create: async (owner) => {
                    const node = await options.assets.in(owner).instantiate(options.prefab, content, { active: false });
                    const part = node.getComponent(options.part);
                    invariant(
                        part && node.getComponent(UITransform),
                        'VIRTUAL_LIST_SETUP',
                        '条目根节点缺少指定 Part 或 UITransform',
                    );
                    this.assertManualLayout(node);
                    return { node, part };
                },
                place: (cell, index, layout) => {
                    const itemTransform = cell.node.getComponent(UITransform)!;
                    const { itemWidth, itemHeight } = layout.options;
                    if (itemTransform.width !== itemWidth || itemTransform.height !== itemHeight) {
                        itemTransform.setContentSize(itemWidth, itemHeight);
                        // ON_WINDOW_RESIZE 不会响应复用时的根尺寸变化；仅在尺寸改变时立即对齐子 Widget。
                        for (const widget of cell.node.getComponentsInChildren(Widget))
                            if (widget.node !== cell.node && widget.enabled) widget.updateAlignment();
                    }
                    const position = layout.position(index);
                    cell.node.setPosition(
                        position.x + itemWidth * itemTransform.anchorX,
                        -position.y - itemHeight * (1 - itemTransform.anchorY),
                        0,
                    );
                },
                render: (cell, context) => options.render(cell.part, context),
                activate: (cell) => options.assets.activate(cell.node),
                deactivate: (cell) => {
                    const parts = cell.node.getComponentsInChildren(GameComponent);
                    for (const part of parts) part.__allow(undefined);
                    cell.node.active = false;
                    return Promise.all(parts.map((part) => part.__deactivate())).then(() => {});
                },
            },
            report,
        );
        this.session = controller;
        let syncing = false;
        const assertActive = () => controller.scope.signal.throwIfAborted();
        const checkWidth = (layout: typeof controller.layout) =>
            invariant(
                layout.width <= view.width + 0.01,
                'VIRTUAL_LIST_SETUP',
                '固定列宽和边距超过视口，请缩小条目或减少列数',
            );
        const sync = (reset = false) => {
            if (syncing || controller.scope.signal.aborted) return;
            syncing = true;
            try {
                const offset = reset ? 0 : scroll.getScrollOffset().y;
                controller.setViewport(view.height, offset);
                transform.setContentSize(view.width, controller.contentHeight);
                scroll.stopAutoScroll();
                scroll.scrollToOffset(new Vec2(0, controller.scrollOffset));
                controller.setViewport(view.height, scroll.getScrollOffset().y);
            } finally {
                syncing = false;
            }
        };
        const scrolling = () => {
            if (!syncing && !controller.scope.signal.aborted)
                controller.setViewport(view.height, scroll.getScrollOffset().y);
        };
        const resized = () => {
            try {
                sync();
            } catch (error) {
                report(error);
                void controller.dispose().catch(report);
            }
        };
        const detach = controller.scope.signal.onAbort(() => {
            scroll.node.off(ScrollView.EventType.SCROLLING, scrolling);
            view.node.off(Node.EventType.SIZE_CHANGED, resized);
            if (isValid(scroll, true)) scroll.stopAutoScroll();
        });
        controller.scope.defer(() => {
            detach();
            if (this.session === controller) this.session = undefined;
        });
        try {
            checkWidth(controller.layout);
            scroll.horizontal = false;
            scroll.vertical = true;
            transform.setAnchorPoint(0, 1);
            content.setPosition(-view.anchorX * view.width, (1 - view.anchorY) * view.height, 0);
            sync(true);
            scroll.node.on(ScrollView.EventType.SCROLLING, scrolling);
            view.node.on(Node.EventType.SIZE_CHANGED, resized);
        } catch (error) {
            void controller.dispose().catch(report);
            throw error;
        }
        return Object.freeze({
            get count() {
                return controller.count;
            },
            setItems: (items: readonly T[], resetScroll = false) => {
                assertActive();
                controller.setItems(items);
                sync(resetScroll);
            },
            updateItem: (index: number, data: T) => controller.updateItem(index, data),
            refresh: (indices?: Iterable<number>) => controller.refresh(indices),
            setLayout: (layout: VirtualListLayout) => {
                assertActive();
                // 先校验，不让失败配置破坏当前可用列表。
                const candidate = new FixedVirtualLayout(layout);
                checkWidth(candidate);
                controller.setLayout(layout);
                sync();
            },
            scrollToIndex: (index: number, alignment: VirtualListAlignment = 'start', durationSeconds = 0) => {
                assertActive();
                invariant(
                    Number.isFinite(durationSeconds) && durationSeconds >= 0,
                    'VIRTUAL_LIST_DURATION',
                    '滚动时长必须为有限非负秒数',
                );
                const target = controller.scrollTarget(index, alignment);
                scroll.stopAutoScroll();
                scroll.scrollToOffset(new Vec2(0, target), durationSeconds);
                scrolling();
            },
            whenIdle: () => controller.whenIdle(),
            inspect: () => controller.inspect(),
            dispose: () => controller.dispose(),
        });
    }
    private assertManualLayout(node: Node): void {
        invariant(
            !node.getComponent(Layout)?.enabled && !node.getComponent(Widget)?.enabled,
            'VIRTUAL_LIST_SETUP',
            `${node.name} 不得由 Layout/Widget 驱动`,
        );
    }
    /** @internal 引擎禁用时结束列表，清理完成后可以重新 mount。 */
    onDisable(): void {
        void this.session?.dispose().catch(reportError);
    }
    /** @internal 引擎销毁时再次保证会话结束，dispose 保持幂等。 */
    onDestroy(): void {
        void this.session?.dispose().catch(reportError);
    }
}
