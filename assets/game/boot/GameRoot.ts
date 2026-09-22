import type { BootContext } from '../../framework/core/boot';
import { _decorator, Label, Node, ResolutionPolicy, view } from 'cc';
import { App } from '../../framework/core/app';
import { AppEntry } from '../../framework/core/app-entry';
import { modules, views } from '../app/generated/assembly';
import { release } from '../app/generated/release';
import { runtimeOptions } from '../app/generated/options';
const { ccclass, property } = _decorator;
/**
 * 可替换的演示应用启动脚本；通用框架并不固定大厅、分辨率或首屏内容。
 */
@ccclass('game.GameRoot')
export class GameRoot extends AppEntry {
    @property(Node) private uiRoot: Node | null = null;
    @property(Label) private bootStatus: Label | null = null;
    /**
     * 组合演示 UI 根节点、生成的路由和项目选项；720×1280 是此演示选择，项目可自行调整。
     * @returns 交给框架创建 App 的装配参数。
     */
    protected appOptions() {
        if (!this.uiRoot) throw Error('Bootstrap scene is missing its Canvas UI root');
        view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
        return { ...runtimeOptions, root: this.node, uiRoot: this.uiRoot, release, modules, views };
    }
    /**
     * 启动演示首屏，使用 boot.scope 持有页面，使它覆盖整个导航期间。
     * @param app - 已装配的应用服务；首屏打开时才初始化对应模块业务。
     */
    protected async onBoot(app: App, boot: BootContext): Promise<void> {
        await app.ui.pushPage({ id: 'lobby.dashboard' }, { title: 'YZForge' }, boot.scope);
        boot.commit(() => {
            if (this.bootStatus) this.bootStatus.node.active = false;
        });
        console.info('[YZForge] Bootstrap ready: lobby.dashboard');
    }
    /**
     * 把启动错误写入日志并显示到演示启动标签。
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
