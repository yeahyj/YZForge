import { ClockDriver, foregroundDeadline } from '../core/clock-driver';
import { untilCancelled } from '../core/cancellation';
import { ErrorReporter, FrameworkError, invariant, OperationCancelled, reportError } from '../core/errors';
import { runTask, Scope, TaskContext } from '../core/scope';
import { add, calendar, CalendarOptions, CalendarPeriod, CalendarUnit, nextBoundary, options, parts, periodKey, startOf, validEpoch, validPeriod } from './calendar';

export interface ServerTimeReply { readonly requestId: string; readonly receivedAtMs: number; readonly sentAtMs: number; }
export interface ServerTimeSource { sample(requestId: string, task: TaskContext): Promise<ServerTimeReply>; }
export interface TimeSnapshot {
  readonly nowMs: number; readonly source: 'device' | 'server'; readonly quality: 'local' | 'synced' | 'stale';
  readonly sampleAgeMs: number | null; readonly estimatedErrorMs: number | null; readonly revision: number;
}
export interface TimePolicy { readonly maxAgeMs?: number; readonly maxErrorMs?: number; }
export interface TimeOptions extends TimePolicy { readonly source?: ServerTimeSource; readonly sampleCount?: number; readonly requestTimeoutMs?: number; readonly calendar?: CalendarOptions; }
export interface CalendarEvent {
  readonly occurrenceKey: string; readonly scheduledAtMs: number; readonly observedAtMs: number;
  readonly reason: 'due' | 'resume' | 'time-adjusted' | 'initial'; readonly missedCount: number | null;
}
export interface TimeHandle { readonly active: boolean; readonly nextAtMs: number | null; cancel(): void; }
export type CalendarCallback = (event: CalendarEvent, task: TaskContext) => void | Promise<void>;
export interface BoundaryOptions extends CalendarOptions { readonly emitCurrent?: boolean; }
export interface RepeatOptions { readonly offsetMinutes?: number; readonly anchorMs?: number; readonly emitLatestOnStart?: boolean; }
type Anchor = { utc: number; mono: number; epoch: number; error: number };
type Round = { scope: Scope; epoch: number; serial: number; waiters: number; promise: Promise<TimeSnapshot> };
type Plan = {
  scope: Scope; callback: CalendarCallback; active: boolean; busy: boolean; next: number | null;
  cursor: number | null; initialized: boolean; initial: boolean; anchored: boolean;
  candidate(now: number): { cursor: number; at: number; key: string; next: number | null };
};

/** UTC/date/calendar service. Relative gameplay delays deliberately live outside this API. */
export class TimeService {
  readonly calendar = calendar;
  private anchor?: Anchor;
  private revision = 0;
  private syncSerial = 0;
  private round?: Round;
  private resumeStale = false;
  private lastEstimate = 0;
  private lastDevice: number;
  private lastMono: number;
  private quality = '';
  private queuedChange = false;
  private closed = false;
  private readonly scope: Scope;
  private readonly listeners = new Set<{ scope: Scope; callback: (value: TimeSnapshot) => void }>();
  private readonly plans = new Set<Plan>();
  private stopWake = () => {};
  private stopState: () => void;
  private dispatchReason: CalendarEvent['reason'] = 'due';
  constructor(readonly clock: ClockDriver, owner: Scope, private readonly settings: TimeOptions = {}, private readonly report: ErrorReporter = reportError) {
    options(settings.calendar);
    this.scope = owner.child('time');
    this.lastDevice = clock.deviceNowMs(); this.lastMono = clock.monotonicMs();
    this.stopState = clock.onStateChange(() => {
      this.invalidateRound('Host state changed');
      if (!clock.background) {
        this.resumeStale = !!settings.source; this.dispatchReason = 'resume';
        this.changed();
        if (settings.source) void this.sync(this.scope).catch(report);
      }
      this.pump();
    });
    this.scope.signal.onAbort(() => {
      this.closed = true; this.stopWake(); this.stopState(); this.invalidateRound('Time service closed');
      for (const plan of Array.from(this.plans)) this.cancelPlan(plan);
      this.listeners.clear();
    });
    this.pump();
  }
  nowMs(): number {
    if (!this.anchor) return validEpoch(Math.floor(this.clock.deviceNowMs()));
    if (this.anchor.epoch !== this.clock.epoch) return this.lastEstimate;
    this.lastEstimate = validEpoch(Math.floor(this.anchor.utc + Math.max(0, this.clock.monotonicMs() - this.anchor.mono)));
    return this.lastEstimate;
  }
  nowSeconds(): number { return Math.floor(this.nowMs() / 1000); }
  nowDate(): Date { return new Date(this.nowMs()); }
  deviceNowMs(): number { return this.clock.deviceNowMs(); }
  snapshot(): TimeSnapshot {
    const a = this.anchor;
    const age = a && a.epoch === this.clock.epoch ? Math.max(0, this.clock.monotonicMs() - a.mono) : null;
    const error = age === null ? null : a!.error + age * 0.00005;
    const synced = !!a && !this.resumeStale && age !== null && age <= (this.settings.maxAgeMs ?? 300000)
      && error !== null && error <= (this.settings.maxErrorMs ?? 5000);
    return Object.freeze({ nowMs: this.nowMs(), source: a ? 'server' : 'device', quality: synced ? 'synced' : this.settings.source ? 'stale' : 'local', sampleAgeMs: age, estimatedErrorMs: error, revision: this.revision });
  }
  requireNowMs(policy: TimePolicy = {}): number {
    const state = this.snapshot();
    invariant(state.quality === 'synced' && state.sampleAgeMs! <= (policy.maxAgeMs ?? Infinity) && state.estimatedErrorMs! <= (policy.maxErrorMs ?? Infinity), 'TIME_NOT_SYNCED', 'Fresh server time is required');
    return state.nowMs;
  }
  remainingMs(deadlineMs: number): number { return Math.max(0, validEpoch(deadlineMs) - this.nowMs()); }
  onChanged(callback: (value: TimeSnapshot) => void, scope: Scope): () => void {
    scope.signal.throwIfAborted();
    const item = { scope, callback }; this.listeners.add(item);
    let detach = () => {};
    const off = () => { this.listeners.delete(item); detach(); };
    detach = scope.signal.onAbort(off);
    return off;
  }
  resetSync(reason = 'Connection changed'): void {
    this.invalidateRound(reason); this.anchor = undefined; this.resumeStale = false;
    this.revision++; this.changed(); this.pump();
  }
  async sync(owner: Scope): Promise<TimeSnapshot> {
    owner.signal.throwIfAborted(); this.scope.signal.throwIfAborted();
    invariant(this.settings.source, 'TIME_SOURCE_MISSING', 'Install a ServerTimeSource for server synchronization');
    invariant(!this.clock.background, 'TIME_BACKGROUND', 'Synchronization is suspended in background');
    let round = this.round;
    if (!round) {
      const scope = this.scope.child('sync');
      round = { scope, epoch: this.clock.epoch, serial: ++this.syncSerial, waiters: 0, promise: Promise.resolve(null as unknown as TimeSnapshot) };
      this.round = round;
      const captured = round;
      round.promise = Promise.resolve().then(() => this.collect(captured)).finally(async () => {
        if (this.round === captured) this.round = undefined;
        await scope.close();
      });
    }
    round.waiters++;
    try { return await untilCancelled(round.promise, owner.signal); }
    finally { if (--round.waiters === 0 && this.round === round) this.invalidateRound('No synchronization waiters'); }
  }
  private invalidateRound(reason: string): void {
    if (this.round) { this.round.scope.cancel(new OperationCancelled(reason)); this.round = undefined; }
    this.syncSerial++;
  }
  private async collect(round: Round): Promise<TimeSnapshot> {
    const samples: Anchor[] = [];
    const count = this.settings.sampleCount ?? 3;
    invariant(Number.isInteger(count) && count >= 1 && count <= 8, 'INVALID_TIME_OPTIONS', 'sampleCount must be 1–8');
    for (let index = 0; index < count; index++) {
      round.scope.signal.throwIfAborted();
      const request = round.scope.child(`sample:${index}`);
      const stop = foregroundDeadline(this.clock, this.settings.requestTimeoutMs ?? 5000, () => request.cancel(new OperationCancelled('Time sample deadline')));
      try {
        const requestId = `${round.serial}:${index}`;
        const m0 = this.clock.monotonicMs();
        const reply = await untilCancelled(Promise.resolve().then(() => this.settings.source!.sample(requestId, {
          scope: request, signal: request.signal, commit: action => { if (request.signal.aborted) return false; action(); return true; },
        })), request.signal);
        const m3 = this.clock.monotonicMs();
        validEpoch(reply.receivedAtMs); validEpoch(reply.sentAtMs);
        const rtt = m3 - m0 - (reply.sentAtMs - reply.receivedAtMs);
        invariant(reply.requestId === requestId && reply.sentAtMs >= reply.receivedAtMs && rtt >= 0 && rtt <= 10000 && m3 >= m0 && round.epoch === this.clock.epoch, 'INVALID_TIME_SAMPLE', 'Invalid timestamp units, request identity, RTT or clock epoch');
        samples.push({ utc: reply.sentAtMs + rtt / 2, mono: m3, epoch: round.epoch, error: rtt / 2 + 1 });
      } catch (error) { if (!(error instanceof OperationCancelled)) this.report(error); }
      finally { stop(); await request.close(); }
    }
    round.scope.signal.throwIfAborted();
    invariant(samples.length > 0, 'TIME_SYNC_FAILED', 'No valid server time samples');
    const selected = samples.sort((a, b) => a.error - b.error)[0];
    const mono = this.clock.monotonicMs();
    const next = selected.utc + mono - selected.mono;
    if (Math.abs(next - this.nowMs()) > 300000) {
      invariant(samples.filter(sample => Math.abs(sample.utc + mono - sample.mono - next) <= Math.max(2000, sample.error + selected.error)).length >= 2, 'TIME_CORRECTION_UNCONFIRMED', 'Large clock corrections require two consistent samples');
    }
    invariant(this.round === round && round.serial === this.syncSerial && round.epoch === this.clock.epoch && !this.clock.background, 'TIME_SYNC_INVALIDATED', 'Synchronization round is no longer current');
    validEpoch(Math.floor(next));
    this.anchor = selected; this.lastEstimate = Math.floor(next);
    this.resumeStale = false; this.revision++; this.dispatchReason = 'time-adjusted';
    this.changed(); this.pump();
    return this.snapshot();
  }
  in(scope: Scope): ScopedTime { return new ScopedTime(this, scope); }
  private eligibleNow(): number | null {
    if (this.clock.background || this.closed) return null;
    const state = this.snapshot();
    return this.settings.source && state.quality !== 'synced' ? null : state.nowMs;
  }
  private captureAnchor(): number {
    const now = this.eligibleNow();
    invariant(now !== null, 'TIME_NOT_READY', 'Calendar anchor requires eligible foreground time'); return now;
  }
  at(epochMs: number, callback: CalendarCallback, owner: Scope): TimeHandle {
    validEpoch(epochMs);
    return this.plan(owner, callback, false, () => ({ cursor: 0, at: epochMs, key: `at:${epochMs}`, next: null }));
  }
  afterPeriod(period: CalendarPeriod, callback: CalendarCallback, owner: Scope, input: Pick<RepeatOptions, 'offsetMinutes'> = {}): TimeHandle {
    validPeriod(period, true);
    return this.at(add(this.captureAnchor(), period, input.offsetMinutes ?? this.settings.calendar?.offsetMinutes), callback, owner);
  }
  onBoundary(unit: CalendarUnit, callback: CalendarCallback, owner: Scope, input: BoundaryOptions = {}): TimeHandle {
    const o = options({ ...this.settings.calendar, ...input }); validPeriod({ unit, count: 1 });
    return this.plan(owner, callback, input.emitCurrent ?? false, now => {
      const at = startOf(now, unit, o);
      // Monotonic integer index allows exact missed counts and rollback suppression.
      const p = parts(at, o.offsetMinutes);
      const cursor = unit === 'day' ? Math.floor(at / 86400000) : unit === 'week' ? Math.floor(at / 604800000)
        : unit === 'month' ? p.year * 12 + p.month : p.year;
      return { cursor, at, key: periodKey(now, unit, o), next: nextBoundary(now, unit, o) };
    }, true);
  }
  everyPeriod(period: CalendarPeriod, callback: CalendarCallback, owner: Scope, input: RepeatOptions = {}): TimeHandle {
    validPeriod(period, true);
    const anchor = validEpoch(input.anchorMs ?? this.captureAnchor());
    const offset = options({ ...this.settings.calendar, ...input }).offsetMinutes;
    const origin = parts(anchor, offset);
    return this.plan(owner, callback, input.emitLatestOnStart ?? false, now => {
      const p = parts(now, offset);
      const elapsed = period.unit === 'month' ? (p.year - origin.year) * 12 + p.month - origin.month
        : period.unit === 'year' ? p.year - origin.year : (now - anchor) / (period.unit === 'week' ? 604800000 : 86400000);
      let index = Math.max(0, Math.floor(elapsed / period.count));
      const occurrence = (n: number) => add(anchor, { unit: period.unit, count: period.count * n }, offset);
      if (index > 0 && occurrence(index) > now) index--;
      const at = index > 0 ? occurrence(index) : occurrence(1);
      return { cursor: index, at, key: `period:${anchor}:${period.unit}:${period.count}:o${offset}:n${index}`, next: occurrence(index + 1) };
    }, true, true);
  }
  private plan(owner: Scope, callback: CalendarCallback, initial: boolean, candidate: Plan['candidate'], repeating = false, anchored = false): TimeHandle {
    owner.signal.throwIfAborted(); this.scope.signal.throwIfAborted();
    const scope = owner.child('calendar');
    const plan: Plan = { scope, callback, active: true, busy: false, next: null, cursor: null, initialized: !repeating, initial, anchored, candidate };
    this.plans.add(plan);
    scope.signal.onAbort(() => { plan.active = false; this.plans.delete(plan); this.scheduleWake(); });
    const now = this.eligibleNow();
    if (now !== null) this.initialize(plan, now);
    Promise.resolve().then(() => this.pump());
    return Object.freeze({ get active() { return plan.active; }, get nextAtMs() { return plan.active ? plan.next : null; }, cancel: () => this.cancelPlan(plan) });
  }
  private initialize(plan: Plan, now: number): void {
    const candidate = plan.candidate(now);
    if (!plan.initialized) {
      plan.initialized = true;
      if (!plan.initial || (plan.anchored && candidate.cursor === 0)) plan.cursor = candidate.cursor;
      plan.next = plan.cursor !== null && plan.cursor >= candidate.cursor ? candidate.next : candidate.at;
    } else if (plan.next === null && plan.cursor === null) plan.next = candidate.at;
  }
  private cancelPlan(plan: Plan): void {
    if (!plan.active && plan.scope.signal.aborted) return;
    plan.active = false; this.plans.delete(plan);
    void plan.scope.close().catch(this.report);
  }
  private pump(): void {
    this.stopWake();
    if (this.closed) return;
    const state = this.snapshot();
    const nowDevice = this.clock.deviceNowMs(), mono = this.clock.monotonicMs();
    const signature = `${state.source}:${state.quality}:${state.revision}`;
    if (signature !== this.quality || (!this.anchor && Math.abs((nowDevice - this.lastDevice) - (mono - this.lastMono)) > 2000)) {
      this.quality = signature; this.changed();
    }
    this.lastDevice = nowDevice; this.lastMono = mono;
    const now = this.eligibleNow();
    if (now !== null) for (const plan of Array.from(this.plans)) {
      if (!plan.active || plan.busy || plan.scope.signal.aborted) continue;
      try {
        this.initialize(plan, now);
        const occurrence = plan.candidate(now);
        if (occurrence.at > now || (plan.cursor !== null && occurrence.cursor <= plan.cursor)) {
          plan.next = occurrence.next ?? occurrence.at; continue;
        }
        const previous = plan.cursor;
        plan.cursor = occurrence.cursor; plan.next = occurrence.next; plan.busy = true;
        const event: CalendarEvent = Object.freeze({ occurrenceKey: occurrence.key, scheduledAtMs: occurrence.at, observedAtMs: now,
          reason: previous === null && plan.initial ? 'initial' : this.dispatchReason, missedCount: previous === null ? null : Math.max(0, occurrence.cursor - previous - 1) });
        void runTask(plan.scope, task => plan.callback(event, task)).then(() => {
          plan.busy = false;
          if (occurrence.next === null) this.cancelPlan(plan);
          this.pump();
        }, error => {
          plan.busy = false; this.cancelPlan(plan);
          if (!(error instanceof OperationCancelled)) this.report(error);
          this.pump();
        });
      } catch (error) { this.cancelPlan(plan); this.report(error); }
    }
    this.dispatchReason = 'due';
    this.scheduleWake();
  }
  private scheduleWake(): void {
    this.stopWake();
    if (this.closed || this.clock.background) return;
    const now = this.eligibleNow();
    let wait = 60000;
    if (now !== null) for (const plan of this.plans) if (!plan.busy && plan.next !== null) wait = Math.min(wait, Math.max(1, plan.next - now));
    this.stopWake = this.clock.wake(() => this.pump(), wait);
  }
  private changed(): void {
    if (this.queuedChange || this.closed) return;
    this.queuedChange = true;
    Promise.resolve().then(() => {
      this.queuedChange = false;
      if (this.closed) return;
      const value = this.snapshot();
      for (const item of Array.from(this.listeners)) if (!item.scope.signal.aborted) try { item.callback(value); } catch (error) { this.report(error); }
    });
  }
}

/** Fixed owner; safe to capture in a particular UI show or component activation. */
export class ScopedTime {
  constructor(private readonly service: TimeService, private readonly owner: Scope) {}
  get calendar() { return this.service.calendar; }
  nowMs(): number { return this.service.nowMs(); }
  nowSeconds(): number { return this.service.nowSeconds(); }
  nowDate(): Date { return this.service.nowDate(); }
  snapshot(): TimeSnapshot { return this.service.snapshot(); }
  requireNowMs(policy?: TimePolicy): number { return this.service.requireNowMs(policy); }
  remainingMs(deadline: number): number { return this.service.remainingMs(deadline); }
  sync(): Promise<TimeSnapshot> { return this.service.sync(this.owner); }
  onChanged(callback: (value: TimeSnapshot) => void): () => void { return this.service.onChanged(callback, this.owner); }
  at(epoch: number, callback: CalendarCallback): TimeHandle { return this.service.at(epoch, callback, this.owner); }
  onBoundary(unit: CalendarUnit, callback: CalendarCallback, input?: BoundaryOptions): TimeHandle { return this.service.onBoundary(unit, callback, this.owner, input); }
  afterPeriod(period: CalendarPeriod, callback: CalendarCallback, input?: Pick<RepeatOptions, 'offsetMinutes'>): TimeHandle { return this.service.afterPeriod(period, callback, this.owner, input); }
  everyPeriod(period: CalendarPeriod, callback: CalendarCallback, input?: RepeatOptions): TimeHandle { return this.service.everyPeriod(period, callback, this.owner, input); }
}
