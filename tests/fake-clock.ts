import type { ClockDriver } from '../assets/framework/core/clock-driver';
export class FakeClock implements ClockDriver {
  wall = Date.parse('2026-01-01T00:00:00Z'); mono = 0; epoch = 0; background = false; continuesInBackground = true;
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  private listeners = new Set<() => void>();
  deviceNowMs() { return this.wall; }
  monotonicMs() { return this.mono; }
  wake(callback: () => void, afterMs: number) {
    const id = ++this.nextId; this.timers.set(id, { at: this.mono + Math.max(0, afterMs), callback });
    return () => { this.timers.delete(id); };
  }
  onStateChange(callback: () => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  advance(ms: number) {
    this.mono += ms; this.wall += ms;
    const due = [...this.timers].filter(([, timer]) => timer.at <= this.mono);
    for (const [id, timer] of due) { if (this.timers.delete(id)) timer.callback(); }
  }
  jump(ms: number) { this.wall += ms; this.advance(0); }
  hide() { this.background = true; for (const cb of this.listeners) cb(); }
  resume() { this.background = false; if (!this.continuesInBackground) this.epoch++; for (const cb of this.listeners) cb(); }
  get timerCount() { return this.timers.size; }
}
export const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
export function deferred<T = void>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
