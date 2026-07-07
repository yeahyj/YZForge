import { _decorator, Component } from 'cc';
import type { App } from 'yzforge';
import { clearYZForgeApp, createYZForgeApp } from '../bootstrap/app';

const { ccclass } = _decorator;

@ccclass('Main')
export class Main extends Component {
    private app?: App;

    protected onLoad(): void {
        void this.startApp();
    }

    private async startApp(): Promise<void> {
        this.app = await createYZForgeApp();
        await this.app.start({ mainRoot: this.node });
    }

    protected onDestroy(): void {
        clearYZForgeApp(this.app);
        this.app = undefined;
    }
}
