import { _decorator, Component, director } from 'cc';
import { App, AppOptions } from './app';
import { assertLifecycle } from './lifecycle';
import { reportError } from './errors';
const { ccclass } = _decorator;
/**
 * 常驻启动根节点的适配基类；重写 appOptions 和 onBoot，框架创建 App 并设置根节点常驻。
 */
@ccclass('yzforge.AppEntry')
export class AppEntry extends Component {
    /**
     * 启动后创建的应用实例，启动前为 undefined；日常业务优先使用模块/UI 上下文。
     */
    protected app?: App;
    /**
     * 项目启动脚本必须重写，提供模块清单、发布清单、UI 根节点等装配参数。
     * @returns 创建 App 的配置。
     */
    protected appOptions(): AppOptions {
        throw Error('Provide AppOptions in the game composition root');
    }
    /**
     * App 创建后执行一次启动流程，允许返回 Promise；在这里选择首屏或开始账号流程。
     * @param _app 已装配的应用服务，模块业务需通过 use 或打开 UI 才启动。
     */
    protected onBoot(_app: App): void | Promise<void> {}
    /**
     * 应用创建或 onBoot 失败时调用，默认记录错误，可重写显示失败页。
     * @param error 原始启动错误。
     */
    protected onBootFailed(error: unknown): void {
        reportError(error);
    }
    /**
     * @internal
     * 引擎入口：检查业务启动类是否错误覆盖保留生命周期；业务使用 appOptions/onBoot。
     */
    onLoad(): void {
        assertLifecycle(this, AppEntry.prototype);
    }
    /**
     * @internal
     * 框架保留的引擎启用入口；应用启动逻辑写在 onBoot。
     */
    onEnable(): void {}
    /**
     * @internal
     * 框架保留的引擎停用入口；不在业务启动类中覆盖。
     */
    onDisable(): void {}
    /**
     * @internal
     * 设置根节点常驻，读取 appOptions 创建 App，然后调用 onBoot 并转交启动错误。
     */
    start(): void {
        director.addPersistRootNode(this.node);
        try {
            this.app = new App(this.appOptions());
            void Promise.resolve(this.onBoot(this.app)).catch((error) => this.onBootFailed(error));
        } catch (error) {
            this.onBootFailed(error);
        }
    }
    /**
     * @internal
     * 启动节点被销毁时请求 App.close，清理应用服务。
     */
    onDestroy(): void {
        if (this.app) void this.app.close().catch(reportError);
    }
}
