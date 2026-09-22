import test from 'node:test';
import assert from 'node:assert/strict';
import { TimeService } from '../assets/framework/time/time-service';
import { calendar } from '../assets/framework/time/calendar';
import { Scope, runTask } from '../assets/framework/core/scope';
import { LeaseCache } from '../assets/framework/assets/lease-cache';
import {
    defineModule,
    moduleServices,
    ModuleManager,
    type ModuleRef,
} from '../assets/framework/modules/module-manager';
import { FakeClock, flush, deferred } from './fake-clock';

async function settled() {
    for (let i = 0; i < 6; i++) await flush();
}

test('business calendar inherits project rules while standalone calendar stays UTC', async () => {
    const owner = new Scope('calendar'),
        clock = new FakeClock();
    clock.wall = Date.parse('2026-01-01T20:00:00Z');
    const time = new TimeService(clock, owner, { calendar: { offsetMinutes: 480, weekStartsOn: 0, resetMinute: 240 } });
    let key = '';
    time.onBoundary(
        'day',
        (event) => {
            key = event.occurrenceKey;
        },
        owner,
        { emitCurrent: true },
    );
    await settled();
    assert.equal(time.calendar.format(clock.wall, 'date'), '2026-01-02');
    assert.equal(time.calendar.format(clock.wall, 'date', 0), '2026-01-01');
    assert.equal(calendar.format(clock.wall, 'date'), '2026-01-01');
    assert.equal(time.calendar.dayKey(clock.wall), key);
    assert.equal(time.calendar.parts(clock.wall).hour, 4);
    assert.equal(time.calendar.startOf(clock.wall, 'day'), clock.wall);
    assert.ok(Object.isFrozen(time.calendar.rules));
    await owner.close();
});

test('server time refreshes in foreground and due tasks survive beyond the original sample lifetime', async () => {
    const owner = new Scope('online'),
        clock = new FakeClock();
    let samples = 0,
        called = 0;
    const time = new TimeService(clock, owner, {
        sampleCount: 1,
        source: {
            async sample(requestId) {
                samples++;
                return { requestId, receivedAtMs: clock.wall, sentAtMs: clock.wall };
            },
        },
    });
    time.at(
        clock.wall + 360000,
        () => {
            called++;
        },
        owner,
    );
    await settled();
    assert.equal(samples, 1);
    for (let i = 0; i < 7; i++) {
        clock.advance(60000);
        await settled();
    }
    assert.equal(called, 1);
    assert.equal(samples, 2);
    assert.equal(time.snapshot().quality, 'synced');
    await owner.close();
    assert.equal(clock.timerCount, 0);
});

test('automatic sync backs off, suspends in background and recovers a due callback once', async () => {
    const owner = new Scope('offline'),
        clock = new FakeClock();
    let online = false,
        samples = 0,
        called = 0;
    const errors: unknown[] = [];
    const time = new TimeService(
        clock,
        owner,
        {
            sampleCount: 1,
            autoSync: { retryDelayMs: 1000, maxRetryDelayMs: 4000 },
            source: {
                async sample(requestId) {
                    samples++;
                    if (!online) throw Error('offline');
                    return { requestId, receivedAtMs: clock.wall, sentAtMs: clock.wall };
                },
            },
        },
        (error) => errors.push(error),
    );
    time.at(
        clock.wall + 1000,
        () => {
            called++;
        },
        owner,
    );
    await settled();
    assert.equal(samples, 1);
    clock.advance(999);
    await settled();
    assert.equal(samples, 1);
    clock.advance(1);
    await settled();
    assert.equal(samples, 2);
    clock.advance(1999);
    await settled();
    assert.equal(samples, 2);
    clock.advance(1);
    await settled();
    assert.equal(samples, 3);
    assert.equal(called, 0);
    clock.hide();
    clock.advance(86400000);
    await settled();
    assert.equal(samples, 3);
    online = true;
    clock.resume();
    await settled();
    assert.equal(samples, 4);
    assert.equal(time.snapshot().quality, 'synced');
    assert.equal(called, 1);
    assert.ok(errors.length > 0);
    await owner.close();
    clock.advance(86400000);
    await settled();
    assert.equal(samples, 4);
});

test('manual time mode never samples automatically and policy options reject invalid values', async () => {
    const owner = new Scope('manual'),
        clock = new FakeClock();
    let calls = 0;
    const time = new TimeService(clock, owner, {
        autoSync: false,
        sampleCount: 1,
        source: {
            async sample(requestId) {
                calls++;
                return { requestId, receivedAtMs: clock.wall, sentAtMs: clock.wall };
            },
        },
    });
    await settled();
    assert.equal(calls, 0);
    await time.sync(owner);
    assert.equal(calls, 1);
    clock.hide();
    clock.resume();
    clock.advance(600000);
    await settled();
    assert.equal(calls, 1);
    assert.equal(time.snapshot().quality, 'stale');
    assert.throws(() => new TimeService(clock, owner, { maxAgeMs: 0 }), { code: 'INVALID_TIME_OPTIONS' });
    await owner.close();
});

test('services are scoped to the ready host generation and typed dependencies resolve by alias', async () => {
    const owner = new Scope('flow'),
        clock = new FakeClock();
    const profile: ModuleRef<{ name: string }> = { id: 'profile' };
    const inventory: ModuleRef<{ count(): number }> = { id: 'inventory' };
    const services = moduleServices<{ counter: { value: number } }>('inventory');
    const factory = defineModule(inventory, { services, dependencies: { player: profile } }, (ctx, deps) => {
        assert.equal(deps.player.name, 'Ada');
        assert.throws(() => ctx.services(services), { code: 'MODULE_NOT_READY' });
        const counter = { value: 3 };
        return { services: { counter }, api: { count: () => counter.value } };
    });
    const manager = new ModuleManager(
        [
            { id: 'profile', dependencies: [], factory: () => ({ api: { name: 'Ada' } }) },
            { id: 'inventory', dependencies: ['profile'], factory },
        ],
        clock,
        (id, scope, createSession) => ({ id, scope, createSession }) as any,
    );
    const handle = await manager.use(inventory, owner);
    const oldContext = manager.context('inventory');
    oldContext.services(services).counter.value++;
    assert.equal(handle.api.count(), 4);
    assert.throws(() => manager.context('profile').services(services), { code: 'MODULE_SERVICES_HOST' });
    await handle.release();
    await manager.use(inventory, owner);
    assert.throws(() => oldContext.services(services), { code: 'MODULE_NOT_READY' });
    assert.equal(manager.context('inventory').services(services).counter.value, 3);
    await owner.close();
});

test('diagnostics identify pending work and resource owners without extending their lifetime', async () => {
    const scope = new Scope('page'),
        gate = deferred();
    const cache = new LeaseCache(
        async () => ({ texture: true }),
        () => {},
        () => {},
    );
    await cache.acquire('icon', scope);
    const task = runTask(scope, () => gate.promise, undefined, 'load-details');
    await flush();
    const closing = scope.close();
    const snapshot = cache.inspect();
    assert.equal(snapshot[0].owners[0].label, 'page');
    assert.equal(snapshot[0].owners[0].state, 'closing');
    assert.deepEqual(snapshot[0].owners[0].tasks, ['load-details']);
    assert.ok(Object.isFrozen(snapshot[0].owners[0].tasks));
    gate.resolve();
    await task;
    await closing;
    assert.equal(cache.inspect().length, 0);
    assert.equal(scope.inspect().state, 'closed');
});
