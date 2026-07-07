import type { App } from './app';
import { EventBus } from './event-bus';

export class GlobalRoot {
    public readonly event = new EventBus();

    public constructor(public readonly app: App) {}

    public async initialize(): Promise<void> {}

    public async dispose(): Promise<void> {
        this.event.clear();
    }
}
