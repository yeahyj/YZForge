import { _decorator, Component, isValid, Node, Sprite } from 'cc';
import type { AssetKey } from '../assets/asset-types';
import type { ScopedAssets } from '../assets/asset-manager';
import type { ScopedConfig } from '../config/config-manager';
import type { ScopedAudio } from '../audio/audio-manager';
import type { ModuleContext } from '../modules/module-manager';
import type { ScopedTime } from '../time/time-service';
import { invariant } from '../core/errors';
import { assertLifecycle, synchronous } from '../core/lifecycle';
import { Lifetime, TaskContext } from '../core/scope';
import type { Actions } from '../core/actions';
import type { ViewUI } from './ui-manager';
const { ccclass } = _decorator;
/**
 * UI 实例创建上下文。同一缓存实例可经历多次显示，instance.scope 通常长于 show.scope。
 */
export interface ViewInstanceContext {
    /**
     * 整个 UI 实例的期限；缓存隐藏时可以保留，最终销毁时清理。
     */
    readonly scope: Lifetime;
    /**
     * 界面所属模块的上下文，包含资源、配置、时间和事件等入口。
     */
    readonly ctx: ModuleContext;
}
type ReadonlyParams<P> = P extends object ? Readonly<P> : P;
/**
 * 一次 UI 显示的上下文；每次显示有独立 showId、Scope 和取消信号，关闭或导航挂起后失效。
 * 异步任务应捕获这一次 show，不要在完成时再读取另一轮显示的上下文。
 */
export interface ViewShowContext<Params, Result> extends TaskContext {
    /** 当前显示的 UI 入口：局部弹窗跟随 show，页面导航继承外部会话；旧显示不能再次使用。 */
    readonly ui: ViewUI;
    /** 本次展示的命名操作：latest 查询、exclusive 防重复、serial 顺序执行。 */
    readonly actions: Actions;
    /** 本次显示使用的资源入口；load/instantiate 的资源自动随本次显示释放。 */
    readonly assets: ScopedAssets;
    /** 本次显示使用的配置入口；load(Table) 无需再传 show.scope。 */
    readonly config: ScopedConfig;
    /** 本次显示使用的音频入口；play(Key) 无需再传 show.scope。 */
    readonly audio: ScopedAudio;
    /**
     * 本次运行中递增的显示序号，区分同一预制体实例的不同显示代次。
     */
    readonly showId: number;
    /**
     * 打开界面时传入的参数；普通对象和数组会递归复制并冻结，函数与服务引用保留身份。
     * 业务按只读使用，避免通过参数修改共享服务之外的调用方状态。
     */
    readonly params: ReadonlyParams<Params>;
    /**
     * 归属于本次显示的时间接口；日历订阅、校时等待随 show.scope 结束而取消。
     */
    readonly time: ScopedTime;
    /**
     * 登记本次显示的工作，关闭时等待其退出。
     * @param task 通过 signal 响应取消，异步完成后用 task.commit 同步更新界面。
     * @returns 工作结果或错误，应 await 或处理失败。
     * @example
     * await show.run(async task => { const data = await readProfile(task.signal); task.commit(() => render(data)); });
     */
    run<T>(task: (context: TaskContext) => T | Promise<T>): Promise<T>;
    /**
     * 监听节点事件，显示关闭或挂起时自动解绑；异步监听器自动登记到本次 Scope。
     * @param target 发出事件的节点，例如 this.btnConfirm.node。
     * @param event 事件名，例如 Button.EventType.CLICK。
     * @param callback 同步或异步回调，异步写界面使用 show.commit。
     * @param onError 可选的业务失败处理；默认只上报，不因一次按钮操作失败关闭整个页面。取消不进入此回调。
     * @returns 可提前取消监听的函数。
     * @example
     * show.listen(this.btnConfirm.node, Button.EventType.CLICK, () => show.finish({ confirmed: true }));
     */
    listen(
        target: Node,
        event: string,
        callback: (...args: unknown[]) => void | Promise<void>,
        onError?: (error: unknown) => void,
    ): () => void;
    /**
     * 异步设置本次显示的图片，管理资源持有并阻止同一 Sprite 的旧请求覆盖新请求。
     * @param target 目标 Sprite。
     * @param key 生成的 SpriteFrame Key，或当前模块默认包内唯一的相对名称。
     * @returns 设置完成；显示结束、目标失效或请求被替换时可能失败。
     */
    setSprite(target: Sprite, key: AssetKey<'SpriteFrame'> | string): Promise<void>;
    /**
     * 请求成功结束本次界面，结果交给打开方 handle.result；失效显示上的调用会被忽略。
     * @param value 返回的业务结果，类型由 Result 确定。
     * @example
     * show.finish({ claimed: true, amount: 100 });
     */
    finish(value: Result): void;
    /** 请求取消本次界面；按钮或 onShow 中可直接调用，由打开方等待 handle.result。旧显示上的调用被忽略。 */
    dismiss(): void;
}
/**
 * 隐藏或结束时的清理上下文；此时原 show 已取消，不能用旧 show 提交界面更新。
 */
export interface ViewHideContext {
    /**
     * completed 成功结束；cancelled 取消；failed 失败；suspended 被新页面临时挂起。
     */
    readonly reason: 'completed' | 'cancelled' | 'failed' | 'suspended';
    /**
     * 此次 onHide 阶段的期限，用于短暂清理工作；钩子完成后关闭。
     */
    readonly scope: Lifetime;
}
/**
 * UIManager 管理的界面基类，业务通常继承自动生成的 XxxBinding。
 * 只重写 onCreate/onShow/onHide/onDispose/onTick/onLateTick，Cocos 生命周期由框架保留。
 */
@ccclass('yzforge.UIView')
export class UIView<Params = void, Result = void> extends Component {
    /**
     * onCreate 前注入的模块上下文；默认资源/配置期限为模块级，本次显示的工作显式使用 show.scope。
     */
    protected ctx!: ModuleContext;
    private show?: ViewShowContext<Params, Result>;
    private created = false;
    private disposed = false;
    private fault?: (error: unknown) => void;
    /**
     * 生成 Binding 的同步校验钩子，在业务生命周期前检查必需引用；节点改变后通过面板重新生成。
     */
    protected validateBindings(): void {}
    /**
     * 读取并验证必需绑定。
     * @param value 编辑器自动写入的序列化引用。
     * @param name 原节点名，用于错误定位。
     * @returns 有效引用。
     * @throws UI_BINDING_MISSING：引用缺失或已失效，请检查节点并重新生成绑定。
     */
    protected requireBinding<T extends Component | Node>(value: T | null, name: string): T {
        invariant(value && isValid(value, true), 'UI_BINDING_MISSING', `${this.name}: regenerate binding ${name}`);
        return value;
    }
    /**
     * 实例首次创建时执行一次，节点同步 onLoad 已完成且模块已注入；可返回 Promise。
     * @param _instance 整个实例的期限和模块上下文；每次显示的事件与任务应放在 onShow。
     */
    protected onCreate(_instance: ViewInstanceContext): void | Promise<void> {}
    /**
     * 每次显示时调用，可异步准备配置与资源；成功结束后才进入可交互状态并开始 onTick。
     * @param _show 本次显示的参数、资源期限、时间与提交入口。
     * @example
     * protected async onShow(show: ViewShowContext<Params, Result>): Promise<void> {
     *     const table = await show.config.load(ItemsTable);
     *     show.commit(() => { this.lblTitle.string = table.require(1).name; });
     * }
     */
    protected onShow(_show: ViewShowContext<Params, Result>): void | Promise<void> {}
    /**
     * 关闭或导航挂起时调用，可返回 Promise；框架先取消原 show、等待登记工作，再执行本钩子。
     * 不要在这里 await 同一界面的 result/close，以免等待自己。
     * @param _hide 隐藏原因和清理阶段 Scope。
     */
    protected onHide(_hide: ViewHideContext): void | Promise<void> {}
    /**
     * 已创建实例最终销毁时同步调用一次，缓存暂时隐藏不会调用。异步清理放在 onHide 或 Scope 清理函数中。
     */
    protected onDispose(): void {}
    /**
     * 界面可交互期间每帧同步调用；关闭、挂起后停止。
     * @param _dt 当前帧间隔，单位为秒，60 FPS 时通常约 0.0167。
     * @param _show 本次有效显示的上下文。
     * @example
     * this.elapsed += dt;
     * if (this.elapsed >= 1) { this.elapsed %= 1; this.refreshClock(show); }
     */
    protected onTick(_dt: number, _show: ViewShowContext<Params, Result>): void {}
    /**
     * 界面可交互期间在引擎 lateUpdate 阶段同步调用，适合依赖本帧其他更新的处理。
     * @param _dt 当前帧间隔，单位为秒。
     * @param _show 本次显示上下文。
     */
    protected onLateTick(_dt: number, _show: ViewShowContext<Params, Result>): void {}
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onLoad(): void {}
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onEnable(): void {}
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    start(): void {}
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onDisable(): void {
        this.show = undefined;
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onDestroy(): void {
        this.show = undefined;
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    update(dt: number): void {
        if (this.show && !this.show.signal.aborted)
            try {
                synchronous(this.onTick(dt, this.show), 'onTick');
            } catch (error) {
                this.fault?.(error);
            }
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    lateUpdate(dt: number): void {
        if (this.show && !this.show.signal.aborted)
            try {
                synchronous(this.onLateTick(dt, this.show), 'onLateTick');
            } catch (error) {
                this.fault?.(error);
            }
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    __bind(ctx: ModuleContext, fault: (error: unknown) => void): void {
        assertLifecycle(this, UIView.prototype);
        this.ctx = ctx;
        this.fault = fault;
        this.validateBindings();
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    async __create(instance: ViewInstanceContext): Promise<void> {
        invariant(!this.created, 'UI_ALREADY_CREATED', this.name);
        this.created = true;
        await this.onCreate(instance);
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    async __show(context: ViewShowContext<Params, Result>): Promise<void> {
        await this.onShow(context);
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    __interactive(context: ViewShowContext<Params, Result> | undefined): void {
        this.show = context;
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    async __hide(context: ViewHideContext): Promise<void> {
        this.show = undefined;
        await this.onHide(context);
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    __dispose(): void {
        if (this.created && !this.disposed) {
            this.disposed = true;
            synchronous(this.onDispose(), 'onDispose');
        }
    }
}
