import test from 'node:test';
import assert from 'node:assert/strict';
import { calendar } from '../assets/framework/time/calendar';
import { TimeService } from '../assets/framework/time/time-service';
import { Scope } from '../assets/framework/core/scope';
import { deferred, FakeClock, flush } from './fake-clock';
const ms = calendar.parseISO;
test('calendar callbacks use project rules with explicit per-subscription overrides', async () => {
  const owner=new Scope('calendar-defaults'),clock=new FakeClock();clock.wall=ms('2026-01-01T23:00:00Z');
  const time=new TimeService(clock,owner,{calendar:{offsetMinutes:120,weekStartsOn:0,resetMinute:240}});
  const project=time.onBoundary('day',()=>{},owner), override=time.onBoundary('day',()=>{},owner,{offsetMinutes:0,resetMinute:0});
  assert.equal(project.nextAtMs,ms('2026-01-02T02:00:00Z'));
  assert.equal(override.nextAtMs,ms('2026-01-02T00:00:00Z'));
  await owner.close();assert.equal(clock.timerCount,0);
});
test('strict ISO parsing preserves offsets, milliseconds and years below 100', () => {
  assert.equal(calendar.toISO(ms('0001-01-01T00:00:00Z')), '0001-01-01T00:00:00.000Z');
  assert.equal(ms('2026-02-01T08:00:00.1+08:00'), ms('2026-02-01T00:00:00.100Z'));
  for (const text of ['2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T24:00:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00', '2026-01-01T00:00:00+14:30']) assert.throws(() => ms(text));
});
test('calendar months clamp while recurrence can retain the original day', () => {
  const anchor = ms('2028-01-31T12:34:56Z');
  assert.equal(calendar.toISO(calendar.add(anchor, { unit: 'month', count: 1 })), '2028-02-29T12:34:56.000Z');
  assert.equal(calendar.toISO(calendar.add(anchor, { unit: 'month', count: 2 })), '2028-03-31T12:34:56.000Z');
  const leap = ms('2028-02-29T12:00:00Z');
  assert.equal(calendar.toISO(calendar.add(leap, { unit: 'year', count: 4 })), '2032-02-29T12:00:00.000Z');
});
test('business reset time participates in day, week, month and year keys', () => {
  const early = ms('2027-01-01T03:00:00+08:00'), rules = { offsetMinutes: 480, resetMinute: 240 };
  assert.equal(calendar.format(calendar.startOf(early, 'year', rules), 'datetime', 480), '2026-01-01 04:00:00');
  assert.equal(calendar.format(calendar.nextBoundary(early, 'month', rules), 'datetime', 480), '2027-01-01 04:00:00');
  assert.equal(calendar.isSamePeriod(early, ms('2026-12-31T23:59:00+08:00'), 'day', rules), true);
  assert.equal(calendar.formatDuration(90001001), '25:00:02');
});
test('local time queries return independent dates without 32-bit epoch truncation', async () => {
  const clock = new FakeClock(), owner = new Scope('test'), time = new TimeService(clock, owner);
  clock.wall = ms('2100-01-01T00:00:00Z'); const date = time.nowDate(); date.setTime(0);
  assert.equal(time.nowSeconds(), clock.wall / 1000); assert.equal(time.snapshot().quality, 'local');
  assert.throws(() => time.requireNowMs(), { code: 'TIME_NOT_SYNCED' }); await owner.close(); assert.equal(clock.timerCount, 0);
});
test('at is an absolute one-shot and cancellation removes future callbacks', async () => {
  const clock = new FakeClock(), owner = new Scope('test'), time = new TimeService(clock, owner); let calls = 0;
  const handle = time.at(clock.wall + 1000, () => { calls++; }, owner);
  await flush(); clock.advance(999); await flush(); assert.equal(calls, 0);
  clock.advance(1); await flush(); assert.equal(calls, 1); assert.equal(handle.active, false);
  time.at(clock.wall + 500, () => { calls++; }, owner).cancel(); clock.advance(1000); await flush(); assert.equal(calls, 1); await owner.close();
});
test('boundary coalesces missed days and does not repeat on backward corrections', async () => {
  const clock = new FakeClock(), owner = new Scope('test'), time = new TimeService(clock, owner), seen: any[] = [];
  time.onBoundary('day', event => { seen.push(event); }, owner); await flush();
  clock.advance(86400000 * 4); await flush(); assert.equal(seen.length, 1); assert.equal(seen[0].missedCount, 3);
  clock.jump(-86400000 * 3); clock.advance(60000); await flush(); assert.equal(seen.length, 1);
  clock.advance(86400000 * 4); await flush(); assert.equal(seen.length, 2); await owner.close();
});
test('background skips callbacks then checks latest eligible period on resume', async () => {
  const clock = new FakeClock(), owner = new Scope('test'), time = new TimeService(clock, owner), seen: any[] = [];
  time.onBoundary('week', event => { seen.push(event); }, owner); await flush();
  clock.hide(); clock.advance(86400000 * 20); await flush(); assert.equal(seen.length, 0);
  clock.resume(); await flush(); assert.equal(seen.length, 1); assert.equal(seen[0].reason, 'resume'); await owner.close();
});
test('calendar handles serialize callbacks and owner cleanup waits for running work', async () => {
  const clock = new FakeClock(), owner = new Scope('test'), time = new TimeService(clock, owner), gate = deferred(); let calls = 0;
  time.onBoundary('day', async () => { calls++; await gate.promise; }, owner);
  clock.advance(86400000); await flush(); clock.advance(86400000 * 3); await flush(); assert.equal(calls, 1);
  let closed = false; const closing = owner.close().then(() => { closed = true; }); await flush(); assert.equal(closed, false);
  gate.resolve(); await closing; assert.equal(calls, 1);
});
test('monthly recurring targets always derive from original Jan 31 anchor', async () => {
  const clock = new FakeClock(); clock.wall = ms('2026-01-31T08:00:00Z');
  const owner = new Scope('test'), time = new TimeService(clock, owner); const seen: any[] = [];
  const handle = time.everyPeriod({ unit: 'month', count: 1 }, event => { seen.push(event); }, owner);
  assert.equal(handle.nextAtMs, ms('2026-02-28T08:00:00Z'));
  clock.advance(ms('2026-02-28T08:00:00Z') - clock.wall); await flush();
  assert.equal(seen.length, 1); assert.equal(handle.nextAtMs, ms('2026-03-31T08:00:00Z')); await owner.close();
});
test('startup emitCurrent is asynchronous and no callbacks survive process owners', async () => {
  const clock = new FakeClock(), owner = new Scope('test'), time = new TimeService(clock, owner); let calls = 0;
  time.onBoundary('day', event => { assert.equal(event.missedCount, null); assert.equal(event.reason, 'initial'); calls++; }, owner, { emitCurrent: true });
  assert.equal(calls, 0); await flush(); assert.equal(calls, 1); await owner.close();
});
test('server sync accounts for server processing and extrapolates selected sample at commit', async () => {
  const clock = new FakeClock(), owner = new Scope('test'); const origin = clock.wall; let requests = 0;
  const time = new TimeService(clock, owner, { source: { async sample(requestId) {
    requests++; const sent = origin + clock.mono + 1000; clock.advance(100);
    return { requestId, receivedAtMs: sent + 20, sentAtMs: sent + 80 };
  } } });
  const [one, two] = await Promise.all([time.sync(owner), time.sync(owner)]);
  assert.equal(requests, 3); assert.equal(one.nowMs, origin + 1300); assert.equal(two.nowMs, one.nowMs); assert.equal(one.sampleAgeMs, 200); assert.equal(one.estimatedErrorMs, 21.01);
  clock.jump(-999999); assert.equal(time.nowMs(), origin + 1300); await owner.close();
});
test('stale server mode never falls back to local callbacks', async () => {
  const clock = new FakeClock(), owner = new Scope('test'); let calls = 0;
  const time = new TimeService(clock, owner, { source: { async sample(requestId) { return { requestId, receivedAtMs: clock.wall, sentAtMs: clock.wall }; } }, maxAgeMs: 1000 });
  assert.throws(() => time.afterPeriod({ unit: 'day', count: 1 }, () => {}, owner), { code: 'TIME_NOT_READY' });
  time.at(clock.wall + 2000, () => { calls++; }, owner); await time.sync(owner); clock.advance(2000); await flush(); assert.equal(calls, 0);
  await time.sync(owner); await flush(); assert.equal(calls, 1); await owner.close();
});
test('cancelled/reset synchronization rounds cannot commit a late response', async () => {
  const clock = new FakeClock(), owner = new Scope('test'), caller = owner.child('caller'), gate = deferred<any>();
  const time = new TimeService(clock, owner, { sampleCount: 1, source: { sample: () => gate.promise } });
  const pending = time.sync(caller); await flush(); time.resetSync('logout');
  gate.resolve({ requestId: '1:0', receivedAtMs: clock.wall, sentAtMs: clock.wall });
  await assert.rejects(pending); assert.equal(time.snapshot().source, 'device'); await owner.close();
});
