import { game } from 'cc';
import { EventBus } from './event-bus';

export interface AppLifecycleEvents {
    readonly foreground: void;
    readonly background: void;
    readonly 'viewport-changed': void;
    readonly 'memory-warning': void;
}

export class AppLifecycle {
    private readonly event = new EventBus<AppLifecycleEvents>();
    private installed = false;

    private readonly emitForeground = (): void => {
        this.event.emit('foreground', undefined);
    };

    private readonly emitBackground = (): void => {
        this.event.emit('background', undefined);
    };

    public install(): void {
        if (this.installed) {
            return;
        }
        game.on(GameEventShow, this.emitForeground);
        game.on(GameEventHide, this.emitBackground);
        this.installed = true;
    }

    public dispose(): void {
        if (this.installed) {
            game.off(GameEventShow, this.emitForeground);
            game.off(GameEventHide, this.emitBackground);
            this.installed = false;
        }
        this.event.clear();
    }

    public on<TKey extends keyof AppLifecycleEvents>(
        event: TKey,
        handler: (payload: AppLifecycleEvents[TKey]) => void,
    ): () => void {
        return this.event.on(event, handler);
    }

    public emitViewportChanged(): void {
        this.event.emit('viewport-changed', undefined);
    }

    public emitMemoryWarning(): void {
        this.event.emit('memory-warning', undefined);
    }
}

const GameEventShow = 'show';
const GameEventHide = 'hide';
