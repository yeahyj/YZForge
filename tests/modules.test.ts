import test from 'node:test';
import assert from 'node:assert/strict';
import { ModuleManager } from '../assets/framework/modules/module-manager';
import { Scope } from '../assets/framework/core/scope';
import { FakeClock, deferred, flush } from './fake-clock';
const context = (id: string, scope: Scope, createSession: (owner: Scope, label: string) => Scope) =>
    ({ id, scope, createSession }) as any;
test('concurrent module users share initialization and have independent cancellation', async () => {
    const gate = deferred(),
        a = new Scope('a'),
        b = new Scope('b');
    let factories = 0,
        stopped = 0;
    const manager = new ModuleManager(
        [
            {
                id: 'battle',
                dependencies: [],
                factory: async (ctx) => {
                    factories++;
                    ctx.scope.defer(() => {
                        stopped++;
                    });
                    await gate.promise;
                    return { api: { answer: () => 42 } };
                },
            },
        ],
        new FakeClock(),
        context,
    );
    const first = manager.use<any>({ id: 'battle' }, a),
        second = manager.use<any>({ id: 'battle' }, b);
    await flush();
    void a.close();
    await assert.rejects(first, { code: 'OPERATION_CANCELLED' });
    gate.resolve();
    const handle = await second;
    assert.equal(handle.api.answer(), 42);
    assert.equal(factories, 1);
    assert.equal(stopped, 0);
    const escaped = handle.api.answer;
    await b.close();
    assert.equal(stopped, 1);
    assert.throws(escaped, { code: 'MODULE_HANDLE_ENDED' });
    await manager.close();
});
test('external session holds a module after the originating handle releases', async () => {
    const owner = new Scope('flow');
    let stopped = false;
    const manager = new ModuleManager(
        [
            {
                id: 'battle',
                dependencies: [],
                factory: (ctx) => {
                    ctx.scope.defer(() => {
                        stopped = true;
                    });
                    return { api: { session: (scope: Scope) => ctx.createSession(scope, 'battle-session') } };
                },
            },
        ],
        new FakeClock(),
        context,
    );
    const handle = await manager.use<any>({ id: 'battle' }, owner);
    const session = handle.api.session(owner);
    await handle.release();
    assert.equal(stopped, false);
    await session.close();
    assert.equal(stopped, true);
    await owner.close();
});
test('idle UI cache eviction precedes service shutdown and dependencies stop last', async () => {
    const order: string[] = [],
        owner = new Scope('flow');
    const manager = new ModuleManager(
        [
            {
                id: 'profile',
                dependencies: [],
                factory: (ctx) => {
                    ctx.scope.defer(() => {
                        order.push('profile');
                    });
                    return { api: {} };
                },
            },
            {
                id: 'battle',
                dependencies: ['profile'],
                factory: (ctx, deps) => {
                    assert.ok(deps.profile);
                    ctx.scope.defer(() => {
                        order.push('battle');
                    });
                    return { api: {} };
                },
            },
        ],
        new FakeClock(),
        context,
    );
    manager.evictIdleViews = async (id) => {
        order.push(`cache:${id}`);
    };
    await manager.use({ id: 'battle' }, owner);
    await owner.close();
    assert.deepEqual(order, ['cache:battle', 'battle', 'cache:profile', 'profile']);
});
test('module factory failure releases its dependencies and explicit retry starts a new generation', async () => {
    const owner = new Scope('flow');
    let attempts = 0;
    const manager = new ModuleManager(
        [
            {
                id: 'battle',
                dependencies: [],
                factory: () => {
                    if (++attempts === 1) throw Error('offline');
                    return { api: 7 };
                },
            },
        ],
        new FakeClock(),
        context,
        () => {},
    );
    await assert.rejects(manager.use({ id: 'battle' }, owner), /offline/);
    await flush();
    const handle = await manager.use({ id: 'battle' }, owner);
    assert.equal(handle.api, 7);
    assert.equal(attempts, 2);
    await owner.close();
});
test('module cycles and factory UI reentry are rejected before waiting', async () => {
    assert.throws(
        () =>
            new ModuleManager(
                [
                    { id: 'a', dependencies: ['b'] },
                    { id: 'b', dependencies: ['a'] },
                ],
                new FakeClock(),
                context,
            ),
        { code: 'MODULE_DEPENDENCY_INVALID' },
    );
    const owner = new Scope('flow');
    const manager: ModuleManager = new ModuleManager(
        [
            {
                id: 'a',
                dependencies: [],
                factory: (ctx) => {
                    assert.throws(() => manager.assertCanOpen('a', ctx.scope.child('nested')), {
                        code: 'MODULE_INIT_REENTRY',
                    });
                    return { api: {} };
                },
            },
        ],
        new FakeClock(),
        context,
    );
    await manager.use({ id: 'a' }, owner);
    await owner.close();
});
test('fault cleanup blocks new users until the retained instance actually drains', async () => {
    const clock = new FakeClock(),
        owner = new Scope('flow'),
        gate = deferred();
    const manager = new ModuleManager([{ id: 'a', dependencies: [], factory: () => ({ api: {} }) }], clock, context);
    await manager.use({ id: 'a' }, owner);
    manager.quarantine('a', gate.promise);
    await assert.rejects(manager.use({ id: 'a' }, owner), { code: 'MODULE_CLEANUP_PENDING' });
    gate.resolve();
    await flush();
    await manager.use({ id: 'a' }, owner);
    await owner.close();
});
