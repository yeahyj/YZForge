import { ErrorReporter, OperationCancelled, reportError } from './errors';
import { runTask, Scope, TaskContext } from './scope';
export interface EventKey<T> {
    readonly id: string;
    readonly __payload?: T;
}
export function eventKey<T>(id: string): EventKey<T> {
    return Object.freeze({ id });
}
type Subscription = { scope: Scope; invoke: (payload: unknown, task: TaskContext) => void | Promise<void> };
/** Events announce facts; commands and queries use module APIs. */
export class Events {
    private readonly listeners = new Map<string, Set<Subscription>>();
    constructor(private readonly report: ErrorReporter = reportError) {}
    on<T>(
        key: EventKey<T>,
        callback: (payload: T, task: TaskContext) => void | Promise<void>,
        scope: Scope,
    ): () => void {
        scope.signal.throwIfAborted();
        const item: Subscription = { scope, invoke: callback as Subscription['invoke'] };
        let group = this.listeners.get(key.id);
        if (!group) this.listeners.set(key.id, (group = new Set()));
        group.add(item);
        let detach = () => {};
        const off = () => {
            group!.delete(item);
            if (!group!.size) this.listeners.delete(key.id);
            detach();
        };
        detach = scope.signal.onAbort(off);
        return off;
    }
    emit<T>(key: EventKey<T>, payload: T): void {
        for (const item of Array.from(this.listeners.get(key.id) ?? [])) {
            if (!item.scope.signal.aborted)
                void runTask(item.scope, (task) => item.invoke(payload, task)).catch((error) => {
                    if (!(error instanceof OperationCancelled)) this.report(error);
                });
        }
    }
}
