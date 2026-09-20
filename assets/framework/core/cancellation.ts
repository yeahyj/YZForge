import { ErrorReporter, OperationCancelled, reportError } from './errors';
export interface CancellationSignal {
    readonly aborted: boolean;
    readonly reason: OperationCancelled | undefined;
    throwIfAborted(): void;
    onAbort(listener: (reason: OperationCancelled) => void): () => void;
}
/** Framework cancellation has no browser AbortController dependency. */
export class CancellationSource {
    readonly signal: CancellationSignal;
    private reason?: OperationCancelled;
    private readonly listeners = new Set<(reason: OperationCancelled) => void>();
    constructor(private readonly report: ErrorReporter = reportError) {
        // Signal getters execute with the public signal as this, so capture its source explicitly.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const owner = this;
        this.signal = Object.freeze({
            get aborted() {
                return owner.reason !== undefined;
            },
            get reason() {
                return owner.reason;
            },
            throwIfAborted() {
                if (owner.reason) throw owner.reason;
            },
            onAbort(listener: (reason: OperationCancelled) => void) {
                if (owner.reason) {
                    owner.notify(listener, owner.reason);
                    return () => {};
                }
                owner.listeners.add(listener);
                return () => {
                    owner.listeners.delete(listener);
                };
            },
        });
    }
    cancel(reason = new OperationCancelled()): void {
        if (this.reason) return;
        this.reason = reason;
        const listeners = Array.from(this.listeners);
        this.listeners.clear();
        for (const listener of listeners) this.notify(listener, reason);
    }
    private notify(listener: (reason: OperationCancelled) => void, reason: OperationCancelled): void {
        try {
            listener(reason);
        } catch (error) {
            this.report(error);
        }
    }
}
/** Cancels this wait, while the shared operation retains responsibility for late results. */
export function untilCancelled<T>(pending: Promise<T>, signal: CancellationSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const off = signal.onAbort(reject);
        pending.then(
            (value) => {
                off();
                if (signal.aborted) reject(signal.reason);
                else resolve(value);
            },
            (error) => {
                off();
                reject(error);
            },
        );
    });
}
