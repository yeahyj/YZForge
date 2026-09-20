import { untilCancelled } from '../core/cancellation';
import { ClockDriver, foregroundDeadline } from '../core/clock-driver';
import { ErrorReporter, FrameworkError, invariant, reportError } from '../core/errors';
import { Scope } from '../core/scope';
import type { ScopedAssets } from '../assets/asset-manager';
import type { ScopedConfig } from '../config/config-manager';
import type { Events } from '../core/events';
import type { ScopedTime } from '../time/time-service';
import type { AudioManager } from '../audio/audio-manager';
import type { UIManager } from '../ui/ui-manager';

export interface ModuleRef<Api> { readonly id: string; readonly __api?: Api; }
export interface ModuleContext {
  readonly id: string; readonly scope: Scope; readonly assets: ScopedAssets; readonly config: ScopedConfig;
  readonly events: Events; readonly time: ScopedTime; readonly ui: UIManager; readonly audio: AudioManager;
  createSession(owner: Scope, label: string): Scope;
}
export type ModuleFactory<Api = unknown> = (ctx: ModuleContext, dependencies: Readonly<Record<string, unknown>>) => { api: Api } | Promise<{ api: Api }>;
export interface ModuleDefinition {
  readonly id: string; readonly dependencies: readonly string[];
  readonly factory?: ModuleFactory;
  readonly codeBundle?: string; readonly entryPath?: string;
}
export interface ModuleHandle<Api> { readonly api: Api; readonly active: boolean; release(): Promise<void>; }
type ModuleRecord = {
  definition: ModuleDefinition; scope: Scope; context: ModuleContext; demand: number;
  state: 'initializing' | 'ready' | 'stopping'; codeReady: boolean; cleanupPending: boolean;
  ready: Promise<unknown>; api?: unknown; stop?: Promise<void>;
  faultHolds: number; stopTimedOut: boolean;
};

export class ModuleManager {
  private readonly definitions = new Map<string, ModuleDefinition>();
  private readonly records = new Map<string, ModuleRecord>();
  private accepting = true;
  private readonly dependencyOrder: string[] = [];
  evictIdleViews: (moduleId: string) => Promise<void> = async () => {};
  loadFactory: (definition: ModuleDefinition, scope: Scope) => Promise<ModuleFactory> = async definition => {
    invariant(definition.factory, 'MODULE_LOADER_MISSING', `No code bundle adapter for ${definition.id}`); return definition.factory;
  };
  constructor(definitions: readonly ModuleDefinition[], private readonly clock: ClockDriver,
    private readonly makeContext: (id: string, scope: Scope, createSession: (owner: Scope, label: string) => Scope) => ModuleContext,
    private readonly report: ErrorReporter = reportError, private readonly cleanupTimeoutMs = 10000) {
    for (const definition of definitions) {
      invariant(!this.definitions.has(definition.id), 'MODULE_DUPLICATE', definition.id);
      this.definitions.set(definition.id, definition);
    }
    const visiting = new Set<string>(), ready = new Set<string>();
    const visit = (id: string) => {
      if (ready.has(id)) return;
      const definition = this.definitions.get(id);
      invariant(definition && !visiting.has(id), 'MODULE_DEPENDENCY_INVALID', `Missing or cyclic module: ${id}`);
      visiting.add(id); for (const dependency of definition.dependencies) visit(dependency);
      visiting.delete(id); ready.add(id);
    };
    for (const id of this.definitions.keys()) visit(id);
    this.dependencyOrder = Array.from(ready);
  }
  isCodeReady(id: string): boolean { return this.records.get(id)?.codeReady ?? !!this.definitions.get(id)?.factory; }
  isReady(id: string): boolean { return this.records.get(id)?.state === 'ready'; }
  isInternalOwner(id: string, owner: Scope): boolean { return this.records.get(id)?.scope.owns(owner) ?? false; }
  /** @internal Injection is permitted for inactive factory prewarming; activation still requires ready. */
  contextForBinding(id: string): ModuleContext {
    const record = this.records.get(id);
    invariant(record && record.state !== 'stopping', 'MODULE_NOT_READY', id); return record.context;
  }
  assertCanOpen(id: string, owner: Scope): void {
    const record = this.records.get(id);
    invariant(!(record?.state === 'initializing' && record.scope.owns(owner)), 'MODULE_INIT_REENTRY', `Factory cannot await its own UI: ${id}`);
  }
  /** @internal A timed-out UI isolates its module generation until its instance actually drains. */
  quarantine(id: string, untilDrained: Promise<void>): void {
    const record = this.records.get(id);
    if (!record) return;
    record.faultHolds++; record.cleanupPending = true;
    void untilDrained.then(() => {}, this.report).finally(() => {
      record.faultHolds--; record.cleanupPending = record.faultHolds > 0 || record.stopTimedOut;
    });
  }
  context(id: string): ModuleContext {
    const record = this.records.get(id);
    invariant(record?.state === 'ready', 'MODULE_NOT_READY', id); return record.context;
  }
  /** Supplying the requesting module makes self-initialization errors deterministic. */
  async use<Api>(ref: ModuleRef<Api>, owner: Scope, requester?: string): Promise<ModuleHandle<Api>> {
    owner.signal.throwIfAborted(); invariant(this.accepting, 'APP_STOPPING', 'Modules are shutting down');
    const definition = this.definitions.get(ref.id);
    invariant(definition, 'MODULE_UNKNOWN', ref.id);
    invariant(!(requester === ref.id && this.records.get(ref.id)?.state === 'initializing'), 'MODULE_INIT_REENTRY', `Factory cannot await itself: ${ref.id}`);
    let record = this.records.get(ref.id);
    if (record?.cleanupPending) throw new FrameworkError('MODULE_CLEANUP_PENDING', `Previous module generation is still draining: ${ref.id}`);
    if (record?.state === 'stopping') {
      await untilCancelled(record.stop!, owner.signal);
      return this.use(ref, owner, requester);
    }
    if (!record) {
      const scope = new Scope(`module:${ref.id}`, this.report);
      record = { definition, scope, context: undefined as unknown as ModuleContext, demand: 0, state: 'initializing', codeReady: !!definition.factory,
        cleanupPending: false, faultHolds: 0, stopTimedOut: false, ready: Promise.resolve(undefined) };
      const current = record;
      current.context = this.makeContext(ref.id, scope, (parent, label) => this.createSession(current, parent, label));
      this.records.set(ref.id, current);
      current.ready = Promise.resolve().then(async () => {
        const factory = await this.loadFactory(definition, scope); current.codeReady = true;
        scope.signal.throwIfAborted();
        const dependencies: Record<string, unknown> = {};
        for (const dependency of definition.dependencies) dependencies[dependency] = (await this.use({ id: dependency }, scope, ref.id)).api;
        const pending = Promise.resolve().then(() => factory(current.context, Object.freeze(dependencies)));
        const result = await scope.track(pending);
        scope.signal.throwIfAborted();
        invariant(result && 'api' in result, 'MODULE_FACTORY_INVALID', `${ref.id} factory must return { api }`);
        current.api = result.api; current.state = 'ready'; return result.api;
      });
      void current.ready.catch(() => {}).finally(() => { if (current.demand === 0) void this.stopRecord(current).catch(this.report); });
    }
    const current = record;
    current.demand++;
    let released = false, delivered = false, unown = () => {};
    let releasing: Promise<void> | undefined;
    const release = (): Promise<void> => {
      if (released) return releasing ?? Promise.resolve();
      released = true; detach(); unown();
      current.demand--;
      if (current.demand === 0) {
        if (current.state === 'initializing') current.scope.cancel();
        releasing = current.ready.then(() => {}, () => {}).then(() => this.stopRecord(current));
      }
      return releasing ?? Promise.resolve();
    };
    const detach = owner.signal.onAbort(() => { if (!delivered) void release().catch(this.report); });
    unown = owner.defer(release);
    try {
      const api = await untilCancelled(current.ready, owner.signal) as Api;
      owner.signal.throwIfAborted(); delivered = true;
      const check = () => invariant(!released && !owner.signal.aborted && current.state === 'ready', 'MODULE_HANDLE_ENDED', ref.id);
      const guarded = api && typeof api === 'object' ? new Proxy(api as object, { get(target, property) {
        check(); const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? (...args: unknown[]) => { check(); return Reflect.apply(value, target, args); } : value;
      } }) as Api : api;
      return Object.freeze({ get api() { check(); return guarded; },
        get active() { return !released && !owner.signal.aborted && current.state === 'ready'; }, release });
    } catch (error) { void release().catch(this.report); throw error; }
  }
  private createSession(record: ModuleRecord, owner: Scope, label: string): Scope {
    invariant(record.state === 'ready', 'MODULE_NOT_READY', 'Sessions require a published module API');
    invariant(!record.scope.owns(owner), 'MODULE_SELF_HOLD', 'Internal module work must not create an external session hold');
    const session = owner.child(label); record.demand++;
    session.defer(async () => { if (--record.demand === 0) await this.stopRecord(record); });
    return session;
  }
  private stopRecord(record: ModuleRecord): Promise<void> {
    if (record.stop) return record.stop;
    record.state = 'stopping';
    const stopDeadline = foregroundDeadline(this.clock, this.cleanupTimeoutMs, () => {
      record.stopTimedOut = true; record.cleanupPending = true;
      this.report(new FrameworkError('MODULE_CLEANUP_PENDING', `Module is retaining resources until tasks settle: ${record.definition.id}`));
    });
    record.stop = Promise.resolve().then(async () => {
      try { await this.evictIdleViews(record.definition.id); }
      finally { await record.scope.close(); }
    }).finally(() => {
      stopDeadline(); record.cleanupPending = false;
      if (this.records.get(record.definition.id) === record) this.records.delete(record.definition.id);
    });
    return record.stop;
  }
  async close(): Promise<void> {
    this.accepting = false;
    // Callers must close their UI/flow owners first; dependencies drain via module scopes.
    const failures: unknown[] = [];
    for (const id of [...this.dependencyOrder].reverse()) {
      const record = this.records.get(id); if (!record) continue;
      try { record.scope.cancel(); await record.ready.catch(() => {}); await this.stopRecord(record); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new FrameworkError('MODULE_SHUTDOWN_FAILED', 'Some module cleanups failed', { failures });
  }
}
