import { _decorator, Component, isValid, Node, Sprite } from 'cc';
import type { AssetKey } from '../assets/asset-types';
import type { ModuleContext } from '../modules/module-manager';
import type { ScopedTime } from '../time/time-service';
import { invariant } from '../core/errors';
import { assertLifecycle, synchronous } from '../core/lifecycle';
import { Scope, TaskContext } from '../core/scope';
const { ccclass } = _decorator;
export interface ViewInstanceContext { readonly scope: Scope; readonly ctx: ModuleContext; }
type ReadonlyParams<P> = P extends object ? Readonly<P> : P;
export interface ViewShowContext<Params, Result> extends TaskContext {
  readonly showId: number; readonly params: ReadonlyParams<Params>; readonly time: ScopedTime;
  run<T>(task: (context: TaskContext) => T | Promise<T>): Promise<T>;
  listen(target: Node, event: string, callback: (...args: unknown[]) => void | Promise<void>): () => void;
  setSprite(target: Sprite, key: AssetKey<'SpriteFrame'> | string): Promise<void>;
  finish(value: Result): void;
}
export interface ViewHideContext { readonly reason: 'completed' | 'cancelled' | 'failed' | 'suspended'; readonly scope: Scope; }
@ccclass('yzforge.UIView')
export class UIView<Params = void, Result = void> extends Component {
  protected ctx!: ModuleContext;
  private show?: ViewShowContext<Params, Result>;
  private created = false;
  private disposed = false;
  private fault?: (error: unknown) => void;
  protected validateBindings(): void {}
  protected requireBinding<T extends Component | Node>(value: T | null, name: string): T {
    invariant(value && isValid(value, true), 'UI_BINDING_MISSING', `${this.name}: regenerate binding ${name}`); return value;
  }
  protected onCreate(_instance: ViewInstanceContext): void | Promise<void> {}
  protected onShow(_show: ViewShowContext<Params, Result>): void | Promise<void> {}
  protected onHide(_hide: ViewHideContext): void | Promise<void> {}
  protected onDispose(): void {}
  protected onTick(_dt: number, _show: ViewShowContext<Params, Result>): void {}
  protected onLateTick(_dt: number, _show: ViewShowContext<Params, Result>): void {}
  /** @internal All engine callbacks are reserved, including callbacks currently empty. */
  onLoad(): void {}
  onEnable(): void {}
  start(): void {}
  onDisable(): void { this.show = undefined; }
  onDestroy(): void { this.show = undefined; }
  update(dt: number): void { if (this.show && !this.show.signal.aborted) try { synchronous(this.onTick(dt, this.show), 'onTick'); } catch (error) { this.fault?.(error); } }
  lateUpdate(dt: number): void { if (this.show && !this.show.signal.aborted) try { synchronous(this.onLateTick(dt, this.show), 'onLateTick'); } catch (error) { this.fault?.(error); } }
  /** @internal */
  __bind(ctx: ModuleContext, fault: (error: unknown) => void): void { assertLifecycle(this, UIView.prototype); this.ctx = ctx; this.fault = fault; this.validateBindings(); }
  /** @internal Called after the complete active subtree's synchronous onLoad pass. */
  async __create(instance: ViewInstanceContext): Promise<void> { invariant(!this.created, 'UI_ALREADY_CREATED', this.name); this.created = true; await this.onCreate(instance); }
  /** @internal */
  async __show(context: ViewShowContext<Params, Result>): Promise<void> { await this.onShow(context); }
  /** @internal */
  __interactive(context: ViewShowContext<Params, Result> | undefined): void { this.show = context; }
  /** @internal */
  async __hide(context: ViewHideContext): Promise<void> { this.show = undefined; await this.onHide(context); }
  /** @internal */
  __dispose(): void { if (this.created && !this.disposed) { this.disposed = true; synchronous(this.onDispose(), 'onDispose'); } }
}
