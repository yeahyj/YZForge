import { _decorator, Component, isValid, Node, Toggle, ToggleContainer, UITransform, Widget } from 'cc';
import type { ActivationContext } from '../../../core/game-component';
import { destroyNode } from '../../../assets/asset-manager';
import { type ErrorReporter, invariant, OperationCancelled, reportError } from '../../../core/errors';
import type { Lifetime, Scope, TaskContext } from '../../../core/scope';
import { ScopedComponent } from '../scoped-component';
import { TabController } from './tab-controller';
const { ccclass, property, requireComponent, disallowMultiple, menu } = _decorator;
/** Inspector 中的一项页签，只需拖 Toggle 和对应内容节点。 */
@ccclass('yzforge.TabPage')
export class TabPage {
    /** 本组直接子节点上的 Toggle。 */
    @property({ type: Toggle, displayName: '页签按钮' }) toggle: Toggle | null = null;
    /** 业务预制体中已放置的内容节点；普通用法不需要动态实例化。 */
    @property({ type: Node, displayName: '内容节点' }) content: Node | null = null;
}

/** 页签准备上下文；parent 为本次选择独有的内容容器，结束时同步隐藏、排空后销毁。 */
export interface TabContext extends TaskContext {
    /** 实例化业务 Part 的父节点；不要把外部已有节点移动进来。 */
    readonly parent: Node;
}
/** 业务定义的页签；预制体、数据和 Part 初始化留在业务模块。 */
export interface TabDefinition {
    /** 本组唯一的稳定 ID。 */ readonly id: string;
    /** 本 ToggleContainer 的直接子节点上的 Toggle。 */ readonly toggle: Toggle;
    /** 按需准备内容；使用 task.scope 加载和实例化，完成后整个 parent 才显示。每次重新进入重新调用。 */
    open(task: TabContext): void | Promise<void>;
}
/** 页签绑定操作；首个页签由调用方显式 select。 */
export interface TabGroupHandle {
    /** 快速切换取消过期准备，旧清理完成后打开最后选择；错误由调用方处理。 */ select(id: string): Promise<void>;
    /** 当前选择，准备中也返回 ID；失败或取消后为空。 */ readonly selected: string | undefined;
    /** 关闭全部内容并解绑 Toggles；只影响本次绑定。 */ dispose(): Promise<void>;
}
/** 页签组：默认按 Inspector 配置切换已有节点；高级 bind 支持进入创建、离开销毁。 */
@ccclass('yzforge.TabGroup')
@menu('YZForge/UI/页签切换')
@requireComponent(ToggleContainer)
@disallowMultiple
export class TabGroup extends ScopedComponent {
    /** 默认使用这些现有节点直接切换；高级动态模式才需要 bind 和 contentRoot。 */
    @property({ type: [TabPage], displayName: '页签与内容' }) pages: TabPage[] = [];
    /** 从 0 开始，每次激活恢复该项。 */
    @property({ displayName: '默认页签索引', min: 0, step: 1 }) initialIndex = 0;
    /** 同步切换通知，第一个参数为索引。 */
    @property({ type: [Component.EventHandler], displayName: '切换事件' }) changedEvents: InstanceType<
        typeof Component.EventHandler
    >[] = [];
    private simple?: { scope: Scope; select: (index: number) => void };
    private index = -1;
    /** 编辑器配置模式当前索引；未激活或动态模式为 -1。 */
    get selectedIndex(): number {
        return this.simple && this.current(this.simple.scope) ? this.index : -1;
    }
    /** 切换已配置的内容，不需要 Scope。 */
    selectIndex(index: number): void {
        invariant(
            this.simple && this.current(this.simple.scope),
            'TAB_STATIC_SETUP',
            '请先在 Inspector 配置页签与内容',
        );
        this.simple.select(index);
    }
    /** 循环到下一项，可直接连接 Button.clickEvents。 */
    next(): void {
        this.selectIndex((this.selectedIndex + 1) % this.pages.length);
    }
    /** 循环到上一项，可直接连接 Button.clickEvents。 */
    previous(): void {
        this.selectIndex((this.selectedIndex + this.pages.length - 1) % this.pages.length);
    }
    protected onAutomaticActivate(activation: ActivationContext): void {
        if (!this.pages.length) return;
        const pages = this.pages.map((page) => ({ toggle: page.toggle, content: page.content })),
            container = this.getComponent(ToggleContainer)!;
        invariant(
            pages.every(
                (page) =>
                    page.toggle &&
                    isValid(page.toggle, true) &&
                    page.toggle.enabled &&
                    page.toggle.node.parent === this.node &&
                    page.content &&
                    isValid(page.content, true) &&
                    page.content !== this.node &&
                    !this.node.isChildOf(page.content) &&
                    !pages.some(
                        (other) =>
                            other.toggle &&
                            (page.content === other.toggle.node ||
                                other.toggle.node.isChildOf(page.content) ||
                                page.content!.isChildOf(other.toggle.node)),
                    ),
            ) &&
                new Set(pages.map((page) => page.content)).size === pages.length &&
                new Set(pages.map((page) => page.toggle)).size === pages.length &&
                container.toggleItems.length === pages.length,
            'TAB_STATIC_SETUP',
            '须配置本组唯一的 Toggle 和不同内容节点；内容不能包含页签按钮',
        );
        invariant(
            !pages.some((a) => pages.some((b) => a !== b && a.content!.isChildOf(b.content!))),
            'TAB_STATIC_SETUP',
            '内容节点不能互为祖先',
        );
        invariant(
            Number.isInteger(this.initialIndex) && this.initialIndex >= 0 && this.initialIndex < pages.length,
            'TAB_ID_INVALID',
            '默认页签索引越界',
        );
        const originalAllow = container.allowSwitchOff,
            checked = pages.map((page) => page.toggle!.isChecked),
            off: (() => void)[] = [];
        const scope = this.beginBinding(activation.scope, 'tab-group:configured', () => {
            off.forEach((fn) => fn());
            pages.forEach((page) => {
                if (isValid(page.content, true)) page.content!.active = false;
            });
            if (isValid(container, true)) {
                container.allowSwitchOff = true;
                pages.forEach((page, i) => {
                    if (isValid(page.toggle, true)) page.toggle!.setIsCheckedWithoutNotify(checked[i]);
                });
                container.allowSwitchOff = originalAllow;
            }
            this.index = -1;
        });
        const select = (index: number) => {
            scope.signal.throwIfAborted();
            invariant(Number.isInteger(index) && index >= 0 && index < pages.length, 'TAB_ID_INVALID', '页签索引越界');
            if (this.index === index) return;
            this.index = index;
            container.allowSwitchOff = true;
            pages.forEach((page, i) => {
                page.toggle!.setIsCheckedWithoutNotify(i === index);
                page.content!.active = i === index;
            });
            container.allowSwitchOff = false;
            Component.EventHandler.emitEvents(this.changedEvents, index, this);
        };
        this.simple = { scope, select };
        this.index = -1;
        pages.forEach((page, index) => {
            const node = page.toggle!.node,
                clicked = () => {
                    if (!scope.signal.aborted && page.toggle!.isChecked) select(index);
                };
            node.on(Toggle.EventType.TOGGLE, clicked);
            off.push(() => node.off(Toggle.EventType.TOGGLE, clicked));
        });
        select(this.initialIndex);
    }
    /** 承载内容容器的业务节点，须为空且有 UITransform；不能处于本组 Toggle 的子树。 */
    @property({
        type: Node,
        displayName: '高级：动态内容根节点',
        tooltip: '只有 bind 动态页签时使用；普通页签直接配置上方页签与内容。',
    })
    contentRoot: Node | null = null;
    /**
     * 绑定页签列表并清除选择；接管 Toggle 选中状态和 ToggleContainer.allowSwitchOff。
     * @param owner 本组的显示期限，通常为 show.scope。
     * @param definitions 本组全部启用的 Toggle 和准备函数；绑定时复制定义。
     * @param onError 用户点击产生的非取消错误上报器；select 的错误由调用方处理。
     * @throws TAB_SETUP 根节点不为空、定义重复或 Toggle 不属于本组；重绑前须 await 旧 dispose。
     */
    bind(owner: Lifetime, definitions: readonly TabDefinition[], onError: ErrorReporter = reportError): TabGroupHandle {
        const tabs = definitions.map((tab) => ({ ...tab })),
            root = this.contentRoot;
        invariant(
            root && isValid(root, true) && root.getComponent(UITransform) && root.children.length === 0,
            'TAB_SETUP',
            '内容根节点须为空且有 UITransform；重新绑定前须等待旧 dispose',
        );
        invariant(
            tabs.length > 0 &&
                new Set(tabs.map((tab) => tab.id)).size === tabs.length &&
                new Set(tabs.map((tab) => tab.toggle)).size === tabs.length &&
                tabs.every(
                    (tab) =>
                        tab.id.trim() &&
                        isValid(tab.toggle, true) &&
                        tab.toggle.node.parent === this.node &&
                        !root.isChildOf(tab.toggle.node) &&
                        root !== tab.toggle.node &&
                        typeof tab.open === 'function',
                ),
            'TAB_SETUP',
            '页签 ID / Toggle 须唯一且属于本组',
        );
        const container = this.getComponent(ToggleContainer)!;
        invariant(container.toggleItems.length === tabs.length, 'TAB_SETUP', '定义须覆盖本 ToggleContainer 的所有页签');
        const originalAllow = container.allowSwitchOff,
            checked = tabs.map((tab) => tab.toggle.isChecked);
        const listeners: (() => void)[] = [];
        const scope = this.beginBinding(owner, 'tab-group', () => {
            listeners.forEach((off) => off());
            if (isValid(container, true)) container.allowSwitchOff = originalAllow;
            tabs.forEach((tab, index) => {
                if (isValid(tab.toggle, true)) tab.toggle.setIsCheckedWithoutNotify(checked[index]);
            });
        });
        container.allowSwitchOff = true;
        const controller = new TabController(
            scope,
            new Set(tabs.map((tab) => tab.id)),
            async (id, task) => {
                const panel = new Node(`Tab:${id}`);
                panel.layer = root.layer;
                panel.active = false;
                panel.addComponent(UITransform);
                root.addChild(panel);
                const widget = panel.addComponent(Widget);
                widget.isAlignLeft = widget.isAlignRight = widget.isAlignTop = widget.isAlignBottom = true;
                widget.left = widget.right = widget.top = widget.bottom = 0;
                widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
                widget.updateAlignment();
                task.signal.onAbort(() => {
                    if (isValid(panel, true)) panel.active = false;
                });
                task.scope.defer(() => destroyNode(panel));
                await tabs.find((tab) => tab.id === id)!.open(Object.freeze({ ...task, parent: panel }));
                task.commit(() => {
                    panel.active = true;
                    widget.updateAlignment();
                });
            },
            (id) => {
                if (this.current(scope)) {
                    container.allowSwitchOff = true;
                    tabs.forEach((tab) => tab.toggle.setIsCheckedWithoutNotify(tab.id === id));
                    container.allowSwitchOff = id === undefined;
                }
            },
        );
        tabs.forEach((tab) => {
            tab.toggle.setIsCheckedWithoutNotify(false);
            const clicked = () => {
                if (tab.toggle.isChecked && !scope.signal.aborted)
                    void controller.select(tab.id).catch((error: unknown) => {
                        if (!(error instanceof OperationCancelled)) onError(error);
                    });
            };
            tab.toggle.node.on(Toggle.EventType.TOGGLE, clicked);
            listeners.push(() => {
                if (isValid(tab.toggle, true)) tab.toggle.node.off(Toggle.EventType.TOGGLE, clicked);
            });
        });
        return Object.freeze({
            select: (id: string) => controller.select(id),
            get selected() {
                return controller.selected;
            },
            dispose: () => scope.close(),
        });
    }
}
