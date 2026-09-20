import { _decorator, Component, director } from 'cc';
import { App, AppOptions } from './app';
import { assertLifecycle } from './lifecycle';
import { reportError } from './errors';
const { ccclass } = _decorator;
/** Host adapter for the persistent bootstrap root. Business boot logic uses onBoot. */
@ccclass('yzforge.AppEntry')
export class AppEntry extends Component {
  protected app?: App;
  protected appOptions(): AppOptions { throw Error('Provide AppOptions in the game composition root'); }
  protected onBoot(_app: App): void | Promise<void> {}
  protected onBootFailed(error: unknown): void { reportError(error); }
  onLoad(): void { assertLifecycle(this, AppEntry.prototype); }
  onEnable(): void {}
  onDisable(): void {}
  start(): void {
    director.addPersistRootNode(this.node);
    try {
      this.app = new App(this.appOptions());
      void Promise.resolve(this.onBoot(this.app)).catch(error => this.onBootFailed(error));
    } catch (error) { this.onBootFailed(error); }
  }
  onDestroy(): void { if (this.app) void this.app.close().catch(reportError); }
}
