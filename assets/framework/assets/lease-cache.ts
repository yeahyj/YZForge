import { untilCancelled } from '../core/cancellation';
import { Scope } from '../core/scope';
import { ErrorReporter, reportError } from '../core/errors';
type Entry<V> = { users: number; value?: V; ready: Promise<V>; released: boolean };

/** One physical pin per shared entry, independent logical leases for each owner. */
export class LeaseCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly owners = new WeakMap<Scope, Map<string, Promise<V>>>();
  constructor(private readonly load: (key: string) => Promise<V>, private readonly retain: (value: V) => void,
    private readonly release: (value: V) => void, private readonly report: ErrorReporter = reportError) {}
  acquire(key: string, scope: Scope): Promise<V> {
    scope.signal.throwIfAborted();
    let owned = this.owners.get(scope);
    if (!owned) this.owners.set(scope, owned = new Map());
    const previous = owned.get(key);
    if (previous) return previous;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { users: 0, ready: Promise.resolve(undefined as V), released: false };
      const captured = entry;
      this.entries.set(key, captured);
      captured.ready = Promise.resolve().then(() => this.load(key)).then(value => {
        this.retain(value); captured.value = value;
        if (captured.users === 0) this.drop(key, captured);
        return value;
      }, error => { if (this.entries.get(key) === captured) this.entries.delete(key); throw error; });
    }
    const captured = entry;
    captured.users++;
    let returned = false, unown = () => {};
    const giveBack = () => {
      if (returned) return;
      returned = true; owned!.delete(key); unown();
      if (--captured.users === 0 && captured.value !== undefined) this.drop(key, captured);
    };
    // Pending caller cancellation can return demand early. A delivered lease lives until cleanup.
    const off = scope.signal.onAbort(() => { if (!captured.value) giveBack(); });
    unown = scope.defer(() => { off(); giveBack(); });
    const result = untilCancelled(captured.ready, scope.signal).catch(error => { off(); giveBack(); throw error; });
    owned.set(key, result);
    return result;
  }
  private drop(key: string, entry: Entry<V>): void {
    if (entry.released) return;
    entry.released = true;
    if (this.entries.get(key) === entry) this.entries.delete(key);
    try { this.release(entry.value!); } catch (error) { this.report(error); }
  }
  get retainedCount(): number { return this.entries.size; }
}
