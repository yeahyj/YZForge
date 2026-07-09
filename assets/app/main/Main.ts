import { _decorator, Component } from 'cc';
import type { App } from 'yzforge';
import { clearYZForgeApp, createYZForgeApp } from '../bootstrap/app';
import { AppBootSettings } from './AppBootSettings';

const { ccclass } = _decorator;

@ccclass('Main')
export class Main extends Component {
    private app?: App;
    private startTask?: Promise<void>;
    private destroyed = false;

    protected onLoad(): void {
        this.destroyed = false;
        this.startTask = this.startApp();
        void this.startTask.catch((error) => {
            console.error('[YZForge] App start failed.', error);
        });
    }

    private async startApp(): Promise<void> {
        const bootSettings = this.node.getComponent(AppBootSettings);
        const app = await createYZForgeApp({ boot: bootSettings?.toProfile() });
        if (this.destroyed) {
            await this.disposeAppInstance(app, { type: 'main_destroy_before_start' });
            return;
        }

        this.app = app;
        try {
            await app.start({ mainRoot: this.node });
        } catch (error) {
            if (this.app === app) {
                this.app = undefined;
            }
            await this.disposeAppInstance(app, { type: 'main_start_failed' });
            throw error;
        }

        if (this.destroyed) {
            await this.disposeCurrentApp({ type: 'main_destroy' });
        }
    }

    protected onDestroy(): void {
        this.destroyed = true;
        void this.disposeAfterStart({ type: 'main_destroy' });
    }

    private async disposeAfterStart(reason: unknown): Promise<void> {
        try {
            await this.startTask;
        } catch (_error) {
            return;
        }
        await this.disposeCurrentApp(reason);
    }

    private async disposeCurrentApp(reason: unknown): Promise<void> {
        const app = this.app;
        if (!app) {
            return;
        }
        this.app = undefined;
        await this.disposeAppInstance(app, reason);
    }

    private async disposeAppInstance(app: App, reason: unknown): Promise<void> {
        clearYZForgeApp(app);
        try {
            await app.dispose(reason);
        } catch (error) {
            console.error('[YZForge] App dispose failed.', error);
        } finally {
            clearYZForgeApp(app);
        }
    }
}
