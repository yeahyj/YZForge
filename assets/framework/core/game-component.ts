import { _decorator, Component } from 'cc';
import type { ModuleContext } from '../modules/module-manager';
import type { ScopedTime, TimeService } from '../time/time-service';
import { invariant, reportError } from './errors';
import { assertLifecycle, synchronous } from './lifecycle';
import { runTask, Scope, taskContext, TaskContext } from './scope';
const { ccclass } = _decorator;
export interface ActivationContext extends TaskContext {
    readonly time: ScopedTime;
    run<T>(task: (context: TaskContext) => T | Promise<T>): Promise<T>;
}
@ccclass('yzforge.GameComponent')
export class GameComponent extends Component {
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
    protected requireBinding<T>(value: T | null, nodeName: string): T {
        invariant(value, 'BINDING_MISSING', `${this.name}: ${nodeName}`);
        return value;
    }
    protected validateBindings(): void {}
    protected onInit(): void {}
    protected onActivate(_activation: ActivationContext): void {}
    protected onReady(): void {}
    protected onTick(_dt: number): void {}
    protected onLateTick(_dt: number): void {}
    protected onDeactivate(): void {}
    protected onDispose(): void {}
    /** @internal Inject before the first engine activation. */
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
    /** @internal An explicit business gate, separate from engine enabled/active. */
    __allow(owner: Scope | undefined): void {
        this.owner = owner;
        this.allowed = !!owner;
        if (!owner) {
            void this.__deactivate().catch(reportError);
            return;
        }
        if (this.enabledInHierarchy && this.initialized && !this.draining) this.activate();
    }
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
    onEnable(): void {
        if (this.allowed && this.initialized && !this.draining) this.activate();
    }
    start(): void {
        /* Readiness is dispatched immediately before the first business frame. */
    }
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
    onDisable(): void {
        void this.__deactivate().catch(reportError);
    }
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
    /** @internal Old activations drain before another one can run. */
    __deactivate(): Promise<void> {
        if (this.draining) return this.draining;
        const activation = this.activation;
        if (!activation) return Promise.resolve();
        this.activation = undefined;
        activation.scope.cancel();
        let error: unknown;
        try {
            synchronous(this.onDeactivate(), 'onDeactivate');
        } catch (failure) {
            error = failure;
        }
        this.draining = activation.scope.close().finally(() => {
            this.draining = undefined;
        });
        return this.draining.then(() => {
            if (error) throw error;
            if (this.allowed && this.enabledInHierarchy) this.activate();
        });
    }
    /** @internal */
    __dispose(): void {
        if (this.disposed || !this.initialized) return;
        this.disposed = true;
        synchronous(this.onDispose(), 'onDispose');
    }
}
