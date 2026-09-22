import type { BootContext } from '../../framework/core/boot';
import { _decorator, Label, Node } from 'cc';
import { App } from '../../framework/core/app';
import { AppEntry } from '../../framework/core/app-entry';
import { modules, views } from '../app/generated/assembly';
import { release } from '../app/generated/release';
import { runtimeOptions } from '../app/generated/options';
import { startGame } from '../app/start-game';
const { ccclass, property } = _decorator;
/**
 * 项目启动根节点：装配框架、调用业务入口并显示启动状态。
 * 业务启动流程写在 app/start-game.ts；设计分辨率由 Creator 项目设置管理。
 */
@ccclass('game.GameRoot')
export class GameRoot extends AppEntry {
    @property(Node) private uiRoot: Node | null = null;
    @property(Label) private bootStatus: Label | null = null;
    /**
     * 组合场景 UI 根节点、生成的模块/路由和项目选项；也支持没有业务模块的项目。
     * @returns 交给框架创建 App 的装配参数。
     */
    protected appOptions() {
        if (!this.uiRoot) throw Error('Bootstrap scene is missing its Canvas UI root');
        return { ...runtimeOptions, root: this.node, uiRoot: this.uiRoot, release, modules, views };
    }
    /**
     * 调用业务入口。入口为空时显示就绪状态；业务已打开界面时收起启动提示。
     * @param app - 已装配的应用服务；首屏打开时才初始化对应模块业务。
     * @param boot - 本次启动尝试；失败重试时重新传入，页面和会话应由 boot.scope 持有。
     */
    protected async onBoot(app: App, boot: BootContext): Promise<void> {
        boot.commit(() => {
            if (this.bootStatus) {
                this.bootStatus.node.active = true;
                this.bootStatus.string = '正在启动…';
            }
        });
        // 业务入口既可以同步完成，也可以返回首屏/登录流程的 Promise。
        await Promise.resolve(startGame(app, boot));
        boot.commit(() => {
            if (this.bootStatus) {
                this.bootStatus.string = 'YZForge\n启动完成';
                this.bootStatus.node.active = app.ui.inspect().views.length === 0;
            }
        });
        console.info('[YZForge] Bootstrap ready');
    }
    /**
     * 把启动错误写入日志并显示到启动标签。
     * @param error - 原始启动错误。
     */
    protected onBootFailed(error: unknown): void {
        console.error('[YZForge] Bootstrap failed', error);
        if (this.bootStatus) {
            this.bootStatus.node.active = true;
            this.bootStatus.string = `启动失败\n${error instanceof Error ? error.message : String(error)}`;
        }
    }
}
