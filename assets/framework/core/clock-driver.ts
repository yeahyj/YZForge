import { FrameworkError } from './errors';
export interface ClockDriver {
  deviceNowMs(): number;
  monotonicMs(): number;
  readonly epoch: number;
  readonly background: boolean;
  readonly continuesInBackground: boolean;
  wake(callback: () => void, afterMs: number): () => void;
  onStateChange(callback: () => void): () => void;
}
/** Never silently substitutes Date.now for monotonic measurements. */
export class SystemClockDriver implements ClockDriver {
  private hidden = false;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly readMonotonic: () => number;
  constructor(readonly continuesInBackground = false, readMonotonic?: () => number) {
    if (readMonotonic) this.readMonotonic = readMonotonic;
    else {
      if (typeof performance === 'undefined' || typeof performance.now !== 'function' || performance.now === Date.now) throw new FrameworkError('MONOTONIC_CLOCK_UNAVAILABLE', 'Supply a platform ClockDriver; a Date.now shim is not a monotonic clock');
      this.readMonotonic = performance.now.bind(performance);
    }
    if (!Number.isFinite(this.readMonotonic())) throw new FrameworkError('MONOTONIC_CLOCK_INVALID', 'Clock source must return finite milliseconds');
  }
  get epoch(): number { return this.generation; }
  get background(): boolean { return this.hidden; }
  deviceNowMs(): number { return Date.now(); }
  monotonicMs(): number { return this.readMonotonic(); }
  wake(callback: () => void, afterMs: number): () => void {
    const timer = setTimeout(callback, Math.min(60000, Math.max(0, afterMs)));
    return () => clearTimeout(timer);
  }
  setBackground(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (!hidden && !this.continuesInBackground) this.generation++;
    for (const callback of Array.from(this.listeners)) callback();
  }
  onStateChange(callback: () => void): () => void { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
}
/** Foreground cleanup deadline, independent of UTC and TimeService shutdown. */
export function foregroundDeadline(clock: ClockDriver, durationMs: number, callback: () => void): () => void {
  let remaining = durationMs;
  let last = clock.monotonicMs();
  let wasHidden = clock.background;
  let epoch = clock.epoch;
  let cancelled = false;
  let stopWake = () => {};
  let stopState = () => {};
  const cancel = () => { cancelled = true; stopWake(); stopState(); };
  const tick = () => {
    if (cancelled) return;
    stopWake();
    const now = clock.monotonicMs();
    if (!wasHidden && epoch === clock.epoch) remaining -= Math.max(0, now - last);
    last = now; wasHidden = clock.background; epoch = clock.epoch;
    if (remaining <= 0) { cancel(); callback(); }
    else if (!clock.background) stopWake = clock.wake(tick, remaining);
  };
  stopState = clock.onStateChange(tick);
  tick();
  return cancel;
}
