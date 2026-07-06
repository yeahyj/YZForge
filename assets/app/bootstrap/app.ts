import { createApp, type App, type AppOptions } from '../../yzforge/runtime';
import { installGeneratedExtensions } from './install.generated';

const RUNTIME_APP_KEY = '__YZFORGE_APP__';

type YZForgeGlobal = typeof globalThis & {
    __YZFORGE_APP__?: App;
};

export async function createYZForgeApp(options: AppOptions = {}): Promise<App> {
    const app = createApp(options);
    await installGeneratedExtensions(app);
    exposeYZForgeApp(app);
    return app;
}

export function exposeYZForgeApp(app: App): void {
    (globalThis as YZForgeGlobal)[RUNTIME_APP_KEY] = app;
}

export function clearYZForgeApp(app?: App): void {
    const runtime = globalThis as YZForgeGlobal;
    if (!app || runtime[RUNTIME_APP_KEY] === app) {
        delete runtime[RUNTIME_APP_KEY];
    }
}
