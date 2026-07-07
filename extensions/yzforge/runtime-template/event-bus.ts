export type EventName = string | symbol;
export type EventHandler<TPayload = unknown> = (payload: TPayload) => void;
export type EventDisposer = () => void;

export class EventBus<TEvents extends object = Record<string, unknown>> {
    private readonly handlers = new Map<EventName, Set<EventHandler>>();

    public on<TKey extends keyof TEvents & EventName>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>,
    ): EventDisposer {
        let list = this.handlers.get(event);
        if (!list) {
            list = new Set();
            this.handlers.set(event, list);
        }
        list.add(handler as EventHandler);
        return () => this.off(event, handler);
    }

    public once<TKey extends keyof TEvents & EventName>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>,
    ): EventDisposer {
        const dispose = this.on(event, (payload) => {
            dispose();
            handler(payload);
        });
        return dispose;
    }

    public off<TKey extends keyof TEvents & EventName>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>,
    ): void {
        const list = this.handlers.get(event);
        if (!list) {
            return;
        }
        list.delete(handler as EventHandler);
        if (list.size === 0) {
            this.handlers.delete(event);
        }
    }

    public emit<TKey extends keyof TEvents & EventName>(event: TKey, payload: TEvents[TKey]): void {
        const list = this.handlers.get(event);
        if (!list) {
            return;
        }
        for (const handler of Array.from(list)) {
            handler(payload);
        }
    }

    public clear(event?: EventName): void {
        if (event === undefined) {
            this.handlers.clear();
            return;
        }
        this.handlers.delete(event);
    }
}
