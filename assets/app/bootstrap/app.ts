import { createApp, type App, type AppOptions } from '../../yzforge/runtime';
import { installGeneratedExtensions } from './install.generated';

export async function createYZForgeApp(options: AppOptions = {}): Promise<App> {
    const app = createApp(options);
    await installGeneratedExtensions(app);
    return app;
}
