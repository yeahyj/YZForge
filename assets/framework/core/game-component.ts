import { _decorator, Component, isValid, Node } from 'cc';
import type { ScopedAssets } from '../assets/asset-manager';
import type { ScopedConfig } from '../config/config-manager';
import type { ScopedAudio } from '../audio/audio-manager';
import { Actions } from './actions';
import type { ModuleContext } from '../modules/module-manager';
import type { ScopedTime, TimeService } from '../time/time-service';
import { invariant, reportError } from './errors';
import { assertLifecycle, synchronous } from './lifecycle';
import { runTask, Scope, taskContext, TaskContext, scopeOwner } from './scope';
const { ccclass } = _decorator;
/**
 * 组件或 Part 的一次业务激活上下文；禁用或宿主结束时取消，重新激活得到新上下文。
 */
export interface ActivationContext extends TaskContext {
    /** 本次激活的资源入口；禁用后归还，重新激活使用新的入口。 */
    readonly assets: ScopedAssets;
    /** 本次激活的配置入口，跨模块公开表同样按合同加载。 */
    readonly config: ScopedConfig;
    /** 本次激活的音频入口，停用时自动结束持有。 */
    readonly audio: ScopedAudio;
    /** 最新查询、防重复触发和顺序执行入口。 */
    readonly actions: Actions;
    /**
     * 跟随此次激活的时间接口，取消激活后自动移除日历订阅。
     */
    readonly time: ScopedTime;
    /**
     * 登记此次激活的工作，停用时等待它退出。
     * @param task 通过 signal 响应取消，异步完成后用 task.commit 同步更新。
     * @returns 任务结果或错误，调用方应处理 Promise。
     */
    run<T>(task: (context: TaskContext) => T | Promise<T>): Promise<T>;
}
/**
 * 普通节点组件和 Part 的框架基类，使用 onInit/onActivate/onTick 等钩子。
 * 必须经框架实例化或 app.bindScene 注入宿主后才开始业务，不覆盖 Cocos 生命周期。
 */
@ccclass('yzforge.GameComponent')
export class GameComponent extends Component {
    /**
     * onInit 前注入的业务宿主上下文；跨模块 Part 通常使用调用方宿主。
     */
    protected ctx!: ModuleContext;
    private instance?: Scope;
    private time?: TimeService;
    private owner?: Scope;
    private activation?: ActivationContext;
    private draining?: Promise<void>;
    private initialized = false;
    private ready = false;
    private disposed = false;
    private allowed = false;
    private engineLoaded = false;
    /**
     * 读取生成 Binding 中的必需引用，同时检查非空与 Cocos 对象有效性。
     * @param value - 由 Creator 自动写入的引用。
     * @param nodeName - 原节点名，用于错误定位。
     * @returns 当前仍有效、未请求销毁的节点或组件引用。
     * @throws FrameworkError 引用缺失、已销毁或已请求销毁时抛 BINDING_MISSING。
     */
    protected requireBinding<T extends Component | Node>(value: T | null, nodeName: string): T {
        invariant(value && isValid(value, true), 'BINDING_MISSING', `${this.name}: ${nodeName}`);
        return value;
    }
    /**
     * 生成 Binding 在 onInit 前执行的同步校验；通过面板扫描更新。
     */
    protected validateBindings(): void {}
    /**
     * 引擎已加载且宿主已注入后，进行一次同步实例初始化；业务激活由后续 onActivate 处理。
     */
    protected onInit(): void {}
    /**
     * 每次组件启用且宿主允许业务运行时同步调用。
     * @param _activation 本次激活的 Scope、signal、time、run 和 commit；异步工作放在 run 中并处理错误。
     */
    protected onActivate(_activation: ActivationContext): void {}
    /**
     * 实例第一次有效业务帧中，在 onTick 前同步调用一次；再次激活不会重复调用。
     */
    protected onReady(): void {}
    /**
     * 业务激活期间每帧同步更新，禁用或宿主取消后停止。
     * @param _dt 引擎帧间隔，单位为秒；业务日期通过时间服务获取。
     */
    protected onTick(_dt: number): void {}
    /**
     * 激活且 onReady 已完成后，在引擎 lateUpdate 阶段同步调用。
     * @param _dt 引擎帧间隔，单位为秒。
     */
    protected onLateTick(_dt: number): void {}
    /**
     * 此次激活结束时同步调用；上下文已取消，登记工作随后排空，下次激活会等待旧工作退出。
     */
    protected onDeactivate(): void {}
    /**
     * 已执行 onInit 的实例最终销毁时同步调用一次，普通禁用不会触发。
     */
    protected onDispose(): void {}
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    __bind(ctx: ModuleContext, instance: Scope, time: TimeService): void {
        assertLifecycle(this, GameComponent.prototype);
        invariant(!this.instance, 'COMPONENT_ALREADY_BOUND', this.name);
        this.ctx = ctx;
        this.instance = instance;
        this.time = time;
        instance.signal.onAbort(() => {
            this.allowed = false;
            void this.__deactivate().catch(reportError);
        });
        instance.defer(async () => {
            await this.__deactivate();
            this.__dispose();
        });
        if (this.engineLoaded) this.initialize();
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    __allow(owner: Scope | undefined): void {
        this.owner = owner;
        this.allowed = !!owner;
        if (!owner) {
            void this.__deactivate().catch(reportError);
            return;
        }
        if (this.enabledInHierarchy && this.initialized && !this.draining) this.activate();
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onLoad(): void {
        this.engineLoaded = true;
        // Scene hosts may bind after engine onLoad. No business hook runs before injection.
        if (this.instance) this.initialize();
    }
    private initialize(): void {
        if (this.initialized) return;
        this.validateBindings();
        this.initialized = true;
        synchronous(this.onInit(), 'onInit');
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onEnable(): void {
        if (this.allowed && this.initialized && !this.draining) this.activate();
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    start(): void {
        /* Readiness is dispatched immediately before the first business frame. */
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    update(dt: number): void {
        if (!this.activation || this.activation.signal.aborted) return;
        try {
            if (!this.ready) {
                this.ready = true;
                synchronous(this.onReady(), 'onReady');
            }
            synchronous(this.onTick(dt), 'onTick');
        } catch (error) {
            this.allowed = false;
            void this.__deactivate().catch(reportError);
            reportError(error);
        }
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    lateUpdate(dt: number): void {
        if (!this.activation || this.activation.signal.aborted || !this.ready) return;
        try {
            synchronous(this.onLateTick(dt), 'onLateTick');
        } catch (error) {
            this.allowed = false;
            void this.__deactivate().catch(reportError);
            reportError(error);
        }
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onDisable(): void {
        void this.__deactivate().catch(reportError);
    }
    /**
     * @internal
     * 引擎生命周期适配入口，由框架调用；业务请重写对应的 onShow、onActivate、onTick 等框架钩子。
     */
    onDestroy(): void {
        void this.__deactivate()
            .then(() => this.__dispose())
            .catch(reportError);
    }
    private activate(): void {
        if (this.activation || !this.owner || this.owner.signal.aborted || this.disposed) return;
        const scope = this.owner.child(`activation:${this.name}`);
        const current = () => this.activation === activation;
        const activation: ActivationContext = Object.freeze({
            ...taskContext(scope, current),
            assets: this.ctx.assets.in(scope.lifetime),
            config: this.ctx.config.in(scope.lifetime),
            audio: this.ctx.audio.in(scope.lifetime),
            actions: new Actions(scope.lifetime, current),
            time: this.time!.in(scope),
            run: <T>(task: (context: TaskContext) => T | Promise<T>) => runTask(scope, task, current),
        });
        this.activation = activation;
        try {
            synchronous(this.onActivate(activation), 'onActivate');
        } catch (error) {
            this.allowed = false;
            void this.__deactivate().catch(reportError);
            throw error;
        }
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    __deactivate(): Promise<void> {
        if (this.draining) return this.draining;
        const activation = this.activation;
        if (!activation) return Promise.resolve();
        this.activation = undefined;
        scopeOwner(activation.scope).cancel();
        let error: unknown;
        try {
            synchronous(this.onDeactivate(), 'onDeactivate');
        } catch (failure) {
            error = failure;
        }
        this.draining = scopeOwner(activation.scope)
            .close()
            .finally(() => {
                this.draining = undefined;
            });
        return this.draining.then(() => {
            if (error) throw error;
            if (this.allowed && this.enabledInHierarchy) this.activate();
        });
    }
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    __dispose(): void {
        if (this.disposed || !this.initialized) return;
        this.disposed = true;
        synchronous(this.onDispose(), 'onDispose');
    }
}
