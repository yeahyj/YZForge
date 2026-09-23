import { _decorator, Button, Component, Enum, isValid, Node } from 'cc';
import type { ActivationContext } from '../../../core/game-component';
import { Actions } from '../../../core/actions';
import { type ErrorReporter, invariant, OperationCancelled, reportError } from '../../../core/errors';
import type { Lifetime, Scope, TaskContext } from '../../../core/scope';
import { ScopedComponent } from '../scoped-component';
const { ccclass, property, disallowMultiple, menu } = _decorator;
/** 编辑器初始状态。 */
export enum InitialViewState {
    Content,
    Loading,
    Empty,
    Error,
}
const initialNames: ViewStateName[] = ['content', 'loading', 'empty', 'error'];
const InitialStateOptions = Enum({
    内容: InitialViewState.Content,
    加载中: InitialViewState.Loading,
    空数据: InitialViewState.Empty,
    失败: InitialViewState.Error,
});
/** 一个区域的四种互斥显示状态。 */
export type ViewStateName = 'loading' | 'content' | 'empty' | 'error';
/** 异步区域的一次绑定；reload 只接受最新结果。 */
export interface ViewStateHandle {
    /** 再次加载，旧请求取消；返回内容/空状态，失败显示 error 并拒绝 Promise。 */
    reload(): Promise<'content' | 'empty'>;
    /** 当前显示状态。 */
    readonly state: ViewStateName;
    /** 隐藏状态区域、解绑重试，等待旧工作退出。 */
    dispose(): Promise<void>;
}
/** 四态容器：只控制业务提供的四个直接子节点；retryButton 不得另绑业务加载事件。 */
@ccclass('yzforge.ViewState')
@menu('YZForge/UI/区域四态')
@disallowMultiple
export class ViewState extends ScopedComponent {
    /** 普通用法激活后自动显示的状态。 */
    @property({ type: InitialStateOptions, displayName: '初始状态' }) initialState = InitialViewState.Content;
    /** 拖入业务回调或本组件的 showContent 等方法；不需要 bind。 */
    @property({ type: [Component.EventHandler], displayName: '重试事件' }) retryEvents: InstanceType<
        typeof Component.EventHandler
    >[] = [];
    /** 加载中的业务显示根节点。 */ @property({ type: Node, displayName: '加载中节点' }) loading: Node | null = null;
    /** 正常内容根节点。 */ @property({ type: Node, displayName: '内容节点' }) content: Node | null = null;
    /** 无数据时的业务显示根节点。 */ @property({ type: Node, displayName: '空数据节点' }) empty: Node | null = null;
    /** 失败时的业务显示根节点。 */ @property({ type: Node, displayName: '失败节点' }) error: Node | null = null;
    /** 可选重试按钮，必须在 error 子树下；每次失败后仍可重试。 */ @property({ type: Button, displayName: '重试按钮' })
    retryButton: Button | null = null;
    private simpleScope?: Scope;
    private pendingState?: ViewStateName;
    protected onAutomaticActivate(activation: ActivationContext): void {
        const roots = this.roots(),
            retry = this.retryButton;
        invariant(
            !retry || (isValid(retry, true) && retry.node.isChildOf(this.error!)),
            'VIEW_STATE_SETUP',
            '重试按钮须在失败区域中',
        );
        const scope = this.beginBinding(activation.scope, 'view-state:configured', () => {
            if (isValid(retry, true)) retry!.node.off(Button.EventType.CLICK, clicked);
            this.apply(roots);
        });
        this.simpleScope = scope;
        const clicked = () => {
            if (this.current(scope)) Component.EventHandler.emitEvents(this.retryEvents, this);
        };
        retry?.node.on(Button.EventType.CLICK, clicked);
        invariant(initialNames[this.initialState], 'VIEW_STATE_INVALID', '未知初始状态');
        this.apply(roots, this.pendingState ?? initialNames[this.initialState]);
        this.pendingState = undefined;
    }
    /** 显示加载中，可直接连接 Button.clickEvents。 */
    showLoading(): void {
        this.show('loading');
    }
    /** 显示正常内容，可直接连接 Button.clickEvents。 */
    showContent(): void {
        this.show('content');
    }
    /** 显示空数据，可直接连接 Button.clickEvents。 */
    showEmpty(): void {
        this.show('empty');
    }
    /** 显示错误，可直接连接 Button.clickEvents。 */
    showError(): void {
        this.show('error');
    }
    private roots(): Node[] {
        const roots = [this.loading, this.content, this.empty, this.error];
        invariant(
            roots.every((node) => node && isValid(node, true) && node.parent === this.node) &&
                new Set(roots).size === 4,
            'VIEW_STATE_SETUP',
            '四种状态必须配置不同的有效直接子节点',
        );
        return roots as Node[];
    }
    private apply(roots: Node[], state?: ViewStateName): void {
        roots.forEach((node, index) => {
            if (isValid(node, true)) node.active = ['loading', 'content', 'empty', 'error'][index] === state;
        });
    }
    /** 手动显示一种状态，同时结束旧异步绑定；适合业务自己控制加载流程的区域。 */
    show(state: ViewStateName): void {
        invariant(['loading', 'content', 'empty', 'error'].includes(state), 'VIEW_STATE_INVALID', '未知区域状态');
        const roots = this.roots();
        if (!this.activationContext) this.pendingState = state;
        if (!this.simpleScope || !this.current(this.simpleScope)) {
            void this.clear().catch(reportError);
            if (this.activationContext) this.onAutomaticActivate(this.activationContext);
        }
        this.apply(roots, state);
    }
    /**
     * 绑定异步加载；初始显示 loading，由调用方首次调用 reload。
     * @param owner 区域显示期限。
     * @param load 返回 content 或 empty；界面写入用 task.commit，长期显示资源用外部 show/item Scope。
     * @param onError 重试按钮触发失败时同步上报；程序 reload 的错误由调用方处理。
     */
    bind(
        owner: Lifetime,
        load: (task: TaskContext) => 'content' | 'empty' | Promise<'content' | 'empty'>,
        onError: ErrorReporter = reportError,
    ): ViewStateHandle {
        const roots = this.roots(),
            retry = this.retryButton;
        invariant(
            !retry || (isValid(retry, true) && retry.node.isChildOf(this.error!)),
            'VIEW_STATE_SETUP',
            '重试按钮须在失败区域中',
        );
        let state: ViewStateName = 'loading';
        const scope = this.beginBinding(owner, 'view-state', () => {
            if (isValid(retry, true)) retry!.node.off(Button.EventType.CLICK, clicked);
            this.apply(roots);
        });
        const actions = new Actions(scope);
        const reload = () => {
            scope.signal.throwIfAborted();
            state = 'loading';
            this.apply(roots, state);
            return actions.latest('load', async (task) => {
                try {
                    const result = await load(task);
                    invariant(
                        result === 'content' || result === 'empty',
                        'VIEW_STATE_RESULT',
                        '加载须返回 content 或 empty',
                    );
                    task.commit(() => {
                        state = result;
                        this.apply(roots, result);
                    });
                    return result;
                } catch (failure) {
                    task.commit(() => {
                        state = 'error';
                        this.apply(roots, state);
                    });
                    throw failure;
                }
            });
        };
        const clicked = () => {
            if (state === 'error' && !scope.signal.aborted)
                void reload().catch((failure: unknown) => {
                    if (!(failure instanceof OperationCancelled)) onError(failure);
                });
        };
        retry?.node.on(Button.EventType.CLICK, clicked);
        this.apply(roots, state);
        return Object.freeze({
            reload,
            get state() {
                return state;
            },
            dispose: () => scope.close(),
        });
    }
}
