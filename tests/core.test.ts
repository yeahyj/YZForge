import test from 'node:test';
import assert from 'node:assert/strict';
import { CancellationSource, untilCancelled } from '../assets/framework/core/cancellation';
import { Scope, runTask } from '../assets/framework/core/scope';
import { Events, eventKey } from '../assets/framework/core/events';
import { foregroundDeadline } from '../assets/framework/core/clock-driver';
import { LeaseCache } from '../assets/framework/assets/lease-cache';
import { logicalKey, resolveIndex, validateIndex } from '../assets/framework/assets/catalog';
import { deferred, FakeClock, flush } from './fake-clock';

test('cancellation is immediate, repeatable and listener failures are isolated', () => {
  const errors: unknown[] = [], seen: unknown[] = [];
  const source = new CancellationSource(error => errors.push(error));
  source.signal.onAbort(() => { throw Error('listener'); });
  source.signal.onAbort(reason => seen.push(reason));
  source.cancel(); source.cancel(); source.signal.onAbort(reason => seen.push(reason));
  assert.equal(errors.length, 1); assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]);
});
test('cancel one shared wait without cancelling other callers', async () => {
  const task = deferred<number>(), a = new CancellationSource(), b = new CancellationSource();
  const first = untilCancelled(task.promise, a.signal), second = untilCancelled(task.promise, b.signal);
  a.cancel(); await assert.rejects(first, { code: 'OPERATION_CANCELLED' }); task.resolve(42); assert.equal(await second, 42);
});
test('Scope keeps descendant resources until ancestor asynchronous work drains', async () => {
  const scope = new Scope('root'), child = scope.child('resource'), gate = deferred();
  const order: string[] = []; child.defer(() => { order.push('resource'); }); scope.defer(() => { order.push('root'); });
  void runTask(scope, async task => { await gate.promise; assert.equal(task.commit(() => order.push('stale write')), false); order.push('task'); });
  await flush(); const closing = scope.close(); assert.equal(scope.signal.aborted, true); await flush(); assert.deepEqual(order, []);
  gate.resolve(); await closing; assert.deepEqual(order, ['task', 'resource', 'root']); assert.equal(scope.close(), closing);
});
test('Scope executes all cleanups after failure and handles reentrant close', async () => {
  const scope = new Scope('root'), order: string[] = [];
  scope.defer(() => { order.push('last'); }); scope.defer(() => { throw Error('cleanup'); });
  let closing: Promise<void> | undefined;
  // A second isolated cancellation listener observes a reserved close promise.
  const s = new Scope('reentrant'); let nested: Promise<void> | undefined; s.signal.onAbort(() => { nested = s.close(); });
  const p = s.close(); assert.equal(nested, p); await p;
  closing = scope.close(); await assert.rejects(closing, { code: 'SCOPE_CLEANUP_FAILED' }); assert.deepEqual(order, ['last']);
});
test('typed event work participates in owner cleanup and unsubscribes immediately', async () => {
  const owner = new Scope('listener'), events = new Events(), key = eventKey<number>('coins.changed'), gate = deferred(); let calls = 0;
  events.on(key, async value => { calls += value; await gate.promise; }, owner);
  events.emit(key, 2); await flush(); const close = owner.close(); events.emit(key, 4); await flush(); assert.equal(calls, 2);
  gate.resolve(); await close;
});
test('cleanup deadlines ignore background and wall-clock jumps', () => {
  const clock = new FakeClock(); let fired = 0;
  foregroundDeadline(clock, 1000, () => fired++); clock.advance(400); clock.hide(); clock.advance(500000); clock.jump(-900000); clock.resume(); clock.advance(599);
  assert.equal(fired, 0); clock.advance(1); assert.equal(fired, 1);
});
test('late resource completion after all callers cancel returns the physical pin', async () => {
  const gate = deferred<object>(); let pins = 0, loads = 0;
  const pool = new LeaseCache(async () => { loads++; return gate.promise; }, () => { pins++; }, () => { pins--; });
  const a = new Scope('a'), b = new Scope('b');
  const first = pool.acquire('coin', a), second = pool.acquire('coin', b);
  await Promise.all([a.close(), b.close()]); await assert.rejects(first); await assert.rejects(second);
  gate.resolve({}); await flush(); assert.equal(loads, 1); assert.equal(pins, 0); assert.equal(pool.retainedCount, 0);
});
test('shared assets stay pinned until every owner releases and reuse owner leases', async () => {
  let pins = 0, loads = 0;
  const pool = new LeaseCache(async () => { loads++; return { name: 'coin' }; }, () => pins++, () => pins--);
  const a = new Scope('a'), b = new Scope('b');
  assert.equal(pool.acquire('x', a), pool.acquire('x', a));
  const [one, two] = await Promise.all([pool.acquire('x', a), pool.acquire('x', b)]);
  assert.equal(one, two); assert.equal(loads, 1); await a.close(); assert.equal(pins, 1); await b.close(); assert.equal(pins, 0);
});
test('resource short names are resolved only in the selected namespace and kind', () => {
  assert.deepEqual(logicalKey('coin', 'SpriteFrame', 'battle/forest'), { id: 'battle/forest/sprite/coin', type: 'SpriteFrame' });
  assert.throws(() => logicalKey('coin', 'SpriteFrame'), { code: 'ASSET_ID_INVALID' });
  const index = validateIndex({ formatVersion: 1, namespace: 'battle/forest', assets: { 'battle/forest/sprite/coin': { type: 'SpriteFrame', bundle: 'forest', path: 'icons/coin/spriteFrame' } } }, 'battle/forest');
  assert.equal(resolveIndex(index, logicalKey('coin', 'SpriteFrame', 'battle/forest')).bundle, 'forest');
  assert.throws(() => resolveIndex(index, logicalKey('coin', 'Texture2D', 'battle/forest')), { code: 'ASSET_NOT_REGISTERED' });
});
