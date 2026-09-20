import { CancellationSource, CancellationSignal } from './cancellation';
import { ErrorReporter, FrameworkError, OperationCancelled, reportError } from './errors';
type Cleanup = () => void | Promise<void>;
/** Cancellation is immediate; close resolves only after physical cleanup. */
export class Scope {
  readonly signal: CancellationSignal;
  private readonly source: CancellationSource;
  private readonly children = new Set<Scope>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly cleanups = new Set<Cleanup>();
  private closing?: Promise<void>;
  private ended = false;
  constructor(readonly label: string, private readonly report: ErrorReporter = reportError) {
    this.source = new CancellationSource(report);
    this.signal = this.source.signal;
  }
  get closed(): boolean { return this.ended; }
  /** @internal Used to reject module self-holds and initialization re-entry. */
  owns(other: Scope): boolean { return this === other || Array.from(this.children).some(child => child.owns(other)); }
  child(label: string): Scope {
    this.signal.throwIfAborted();
    const child = new Scope(`${this.label}/${label}`, this.report);
    this.children.add(child);
    child.defer(() => { this.children.delete(child); });
    return child;
  }
  defer(cleanup: Cleanup): () => void {
    this.signal.throwIfAborted(); this.cleanups.add(cleanup);
    return () => { this.cleanups.delete(cleanup); };
  }
  /** @internal */
  cancel(reason = new OperationCancelled(`Scope ended: ${this.label}`)): void {
    if (this.signal.aborted) return;
    this.source.cancel(reason);
    for (const child of Array.from(this.children)) child.cancel(reason);
  }
  /** @internal Register work through a captured task context. */
  track<T>(task: Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    this.tasks.add(task);
    task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    return task;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.cancel();
    void this.drain().then(resolve, reject);
    return this.closing;
  }
  private async drain(): Promise<void> {
    const failures: unknown[] = [];
    // Descendant resources remain pinned while ancestor tasks may still touch them.
    const tasks = await this.drainTasks();
    const settled = [...tasks, ...await Promise.allSettled(Array.from(this.children).map(child => child.close()))];
    for (const result of settled) if (result.status === 'rejected' && !(result.reason instanceof OperationCancelled)) failures.push(result.reason);
    for (const cleanup of Array.from(this.cleanups).reverse()) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    this.cleanups.clear();
    this.ended = true;
    if (failures.length) throw new FrameworkError('SCOPE_CLEANUP_FAILED', `Cleanup failed: ${this.label}`, { failures });
  }
  /** @internal Wait without releasing resources; UI hides only after this barrier. */
  async drainTasks(): Promise<PromiseSettledResult<unknown>[]> {
    const [own, nested] = await Promise.all([
      Promise.allSettled(Array.from(this.tasks)),
      Promise.all(Array.from(this.children).map(child => child.drainTasks())),
    ]);
    return [...own, ...nested.flat()];
  }
}
export interface TaskContext {
  readonly scope: Scope;
  readonly signal: CancellationSignal;
  commit(action: () => void): boolean;
}
export function taskContext(scope: Scope, isCurrent: () => boolean = () => true): TaskContext {
  return Object.freeze({ scope, signal: scope.signal, commit(action: () => void) {
    if (scope.signal.aborted || !isCurrent()) return false;
    const result: unknown = action();
    if (result && typeof (result as Promise<unknown>).then === 'function') throw new FrameworkError('ASYNC_COMMIT', 'commit accepts synchronous mutations only');
    return true;
  } });
}
export function runTask<T>(owner: Scope, task: (context: TaskContext) => T | Promise<T>, isCurrent?: () => boolean): Promise<T> {
  owner.signal.throwIfAborted();
  const context = taskContext(owner, isCurrent);
  return owner.track(Promise.resolve().then(() => { context.signal.throwIfAborted(); return task(context); }));
}
