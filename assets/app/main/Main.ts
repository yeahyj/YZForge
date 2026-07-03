import { _decorator, Component } from 'cc';
import { createApp, type App } from '../../yzforge/runtime';
import { HomeRef } from '../registry/modules/Home.ref.generated';
import { installGeneratedExtensions } from '../bootstrap/install.generated';

const { ccclass } = _decorator;

@ccclass('Main')
export class Main extends Component {
    private app?: App;

    protected onLoad(): void {
        void this.startApp();
    }

    private async startApp(): Promise<void> {
        this.app = createApp();
        await installGeneratedExtensions(this.app);
        await this.app.start();
        await this.app.enterModule(HomeRef, {
            from: 'main',
        });
    }
}
