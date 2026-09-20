import { _decorator, Label, Node, ResolutionPolicy, view } from 'cc';
import { App } from '../../framework/core/app';
import { AppEntry } from '../../framework/core/app-entry';
import { modules, views } from '../app/generated/assembly';
import { release } from '../app/generated/release';
import { runtimeOptions } from '../app/generated/options';
const { ccclass, property } = _decorator;
@ccclass('game.GameRoot')
export class GameRoot extends AppEntry {
    @property(Node) private uiRoot: Node | null = null;
    @property(Label) private bootStatus: Label | null = null;
    protected appOptions() {
        if (!this.uiRoot) throw Error('Bootstrap scene is missing its Canvas UI root');
        view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
        return { ...runtimeOptions, root: this.node, uiRoot: this.uiRoot, release, modules, views };
    }
    protected async onBoot(app: App): Promise<void> {
        try {
            await app.ui.pushPage({ id: 'lobby.dashboard' }, { title: 'YZForge' }, app.flows);
            if (this.bootStatus) this.bootStatus.node.active = false;
            console.info('[YZForge] Bootstrap ready: lobby.dashboard');
        } catch (error) {
            this.onBootFailed(error);
        }
    }
    protected onBootFailed(error: unknown): void {
        console.error('[YZForge] Bootstrap failed', error);
        if (this.bootStatus)
            this.bootStatus.string = `启动失败\n${error instanceof Error ? error.message : String(error)}`;
    }
}
