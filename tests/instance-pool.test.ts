import test from 'node:test';
import assert from 'node:assert/strict';
import { InstancePool } from '../assets/framework/assets/instance-pool';
import { runTask, Scope, type Lifetime } from '../assets/framework/core/scope';
import { deferred, flush } from './fake-clock';

function fixture(options = {}) {
    const root = new Scope('pool-root'),
        player = new Scope('borrower');
    let created = 0,
        destroyed = 0;
    const pool = new InstancePool(
        root,
        {
            create: async (owner) => {
                const value = {
                    id: ++created,
                    live: true,
                    active: false,
                    data: '',
                    owner: undefined as Lifetime | undefined,
                };
                owner.defer(() => {
                    value.live = false;
                    destroyed++;
                });
                return value;
            },
            activate: (value, input: string, owner) => {
                value.active = true;
                value.data = input;
                value.owner = owner;
            },
            deactivate: async (value) => {
                value.active = false;
            },
            valid: (value) => value.live,
        },
        options,
    );
    return {
        root,
        player,
        pool,
        get created() {
            return created;
        },
        get destroyed() {
            return destroyed;
        },
    };
}
test('实例池预热不激活，归还复用节点但每次使用有独立 Scope', async () => {
    const f = fixture({ maxSize: 3, maxIdle: 2 });
    await f.pool.prewarm(2, f.player);
    assert.equal(f.created, 2);
    assert.equal(f.pool.inspect().idle, 2);
    const a = await f.pool.acquire('first', f.player),
        value = a.value;
    assert.equal(value.active, true);
    assert.equal(value.data, 'first');
    await a.release();
    assert.equal(value.active, false);
    assert.equal(a.scope.signal.aborted, true);
    assert.throws(() => a.value, { code: 'OPERATION_CANCELLED' });
    const b = await f.pool.acquire('second', f.player);
    assert.equal(b.value, value);
    assert.notEqual(a.scope, b.scope);
    await a.release();
    assert.equal(b.scope.signal.aborted, false);
    assert.equal(b.value.data, 'second');
    await f.player.close();
    assert.equal(f.pool.inspect().idle, 2);
    await f.root.close();
    assert.equal(f.destroyed, 2);
});
test('归还等待本次实际任务结束，期间不能重新借用或提前销毁', async () => {
    const f = fixture({ maxSize: 1, maxIdle: 1 }),
        gate = deferred();
    const a = await f.pool.acquire('one', f.player),
        value = a.value;
    const running = runTask(a.scope, async () => {
        await gate.promise;
        assert.equal(value.live, true);
    });
    await flush();
    const returned = a.release();
    await flush();
    assert.equal(f.pool.inspect().idle, 0);
    assert.equal(value.live, true);
    await assert.rejects(f.pool.acquire('two', f.player), { code: 'POOL_FULL' });
    const closing = f.pool.close();
    await flush();
    assert.equal(f.destroyed, 0);
    gate.resolve();
    await running;
    await returned;
    await closing;
    assert.equal(f.destroyed, 1);
    await f.player.close();
    await f.root.close();
});
test('关池取消外部借用，空闲上限控制回收且容量包含创建中的实例', async () => {
    const root = new Scope('root'),
        owner = new Scope('other'),
        gate = deferred();
    let disposed = 0;
    const pool = new InstancePool(
        root,
        {
            create: async (scope) => {
                scope.defer(() => {
                    disposed++;
                });
                await gate.promise;
                return {};
            },
            activate: () => {},
            deactivate: async () => {},
            valid: () => true,
        },
        { maxSize: 1, maxIdle: 0 },
    );
    const first = pool.acquire(undefined, owner);
    await flush();
    await assert.rejects(pool.acquire(undefined, owner), { code: 'POOL_FULL' });
    const stopped = assert.rejects(first, { code: 'OPERATION_CANCELLED' });
    const closing = pool.close();
    gate.resolve();
    await stopped;
    await closing;
    assert.equal(disposed, 1);
    await owner.close();
    await root.close();
    const f = fixture({ maxSize: 2, maxIdle: 1 });
    await f.pool.acquire('one', f.player);
    await f.pool.acquire('two', f.player);
    await f.pool.close();
    assert.equal(f.destroyed, 2);
    await f.player.close();
    await f.root.close();
});
test('配置或停用失败的实例被销毁，池仍可创建下一代', async () => {
    const root = new Scope('root'),
        owner = new Scope('owner');
    let destroyed = 0,
        fail = true;
    const pool = new InstancePool(
        root,
        {
            create: async (scope) => {
                scope.defer(() => {
                    destroyed++;
                });
                return {};
            },
            activate: (_value, input: string) => {
                if (input === 'fail') throw Error('prepare');
            },
            deactivate: async () => {
                if (fail) {
                    fail = false;
                    throw Error('deactivate');
                }
            },
            valid: () => true,
        },
        { maxSize: 1 },
    );
    await assert.rejects(pool.acquire('fail', owner), { code: 'POOL_ACQUIRE_CLEANUP_FAILED' });
    assert.equal(destroyed, 1);
    assert.equal(pool.inspect().size, 0);
    const next = await pool.acquire('ok', owner);
    await next.release();
    assert.equal(pool.inspect().idle, 1);
    await pool.close();
    assert.equal(destroyed, 2);
    await owner.close();
    await root.close();
});
test('借用尚未进入微任务即取消时，不创建实例且回收等待 Scope', async () => {
    const f = fixture();
    const pending = f.pool.acquire('cancelled', f.player);
    f.player.cancel();
    await assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
    assert.equal(f.created, 0);
    assert.equal(f.player.inspect().children.length, 0);
    await f.pool.close();
    await f.player.close();
    await f.root.close();
});

test('页面池关闭等待父级任务，任务结束前只停用、不销毁实例', async () => {
    const root = new Scope('page'),
        gate = deferred();
    const pool = new InstancePool(root, {
        create: async (owner) => {
            const value = { live: true, active: false };
            owner.defer(() => {
                value.live = false;
            });
            return value;
        },
        activate: (value) => {
            value.active = true;
        },
        deactivate: async (value) => {
            value.active = false;
        },
        valid: (value) => value.live,
    });
    const lease = await pool.acquire(undefined, root),
        value = lease.value;
    const work = runTask(root, async () => {
        await gate.promise;
        return value.live;
    });
    await flush();
    const closing = root.close();
    await flush();
    try {
        assert.equal(root.closed, false);
        assert.equal(value.active, false);
        assert.equal(value.live, true);
        assert.equal(pool.inspect().idle, 0);
    } finally {
        gate.resolve();
        await closing;
    }
    assert.equal(await work, true);
    assert.equal(value.live, false);
    assert.equal(pool.inspect().closed, true);
});

test('共享池等待借用方的祖先任务，关页期间不能把同一实例交给下一页', async () => {
    const f = fixture({ maxSize: 1 }),
        gate = deferred();
    const group = f.player.child('effects');
    const first = await f.pool.acquire('first', group),
        value = first.value;
    const work = runTask(f.player, async () => {
        await gate.promise;
        return value.data;
    });
    await flush();
    const closing = f.player.close();
    await flush();
    try {
        assert.equal(first.scope.signal.aborted, true);
        assert.equal(value.active, false);
        assert.equal(f.pool.inspect().idle, 0);
        await assert.rejects(f.pool.acquire('early', f.root), { code: 'POOL_FULL' });
    } finally {
        gate.resolve();
        await closing;
    }
    assert.equal(await work, 'first');
    const next = await f.pool.acquire('next', f.root);
    assert.equal(next.value, value);
    await next.release();
    await f.root.close();
});

test('自动回收等待期间，父级任务可在 finally 显式归还或关闭池而不等待自身', async () => {
    for (const action of ['release', 'close'] as const) {
        const f = fixture({ maxSize: 1 }),
            gate = deferred();
        const lease = await f.pool.acquire('one', f.player),
            value = lease.value;
        const owner = action === 'release' ? f.player : f.root;
        const work = runTask(owner, async () => {
            try {
                await gate.promise;
            } finally {
                assert.equal(value.live, true);
                if (action === 'release') await lease.release();
                else await f.pool.close();
            }
        });
        await flush();
        const closing = owner.close();
        await flush();
        assert.equal(value.active, false);
        assert.equal(value.live, true);
        gate.resolve();
        await work;
        await closing;
        assert.equal(owner.closed, true);
        assert.equal(f.pool.inspect().borrowed, 0);
        await f.player.close();
        await f.root.close();
        assert.equal(f.destroyed, 1);
    }
});

test('池所有者自动关闭也等待其祖先任务，即使借用方仍然有效', async () => {
    const f = fixture({ maxSize: 1 }),
        gate = deferred();
    const lease = await f.pool.acquire('one', f.player),
        value = lease.value;
    const work = runTask(f.root, async () => {
        await gate.promise;
        return value.live;
    });
    await flush();
    const closing = f.root.close();
    await flush();
    try {
        assert.equal(f.player.signal.aborted, false);
        assert.equal(lease.scope.signal.aborted, true);
        assert.equal(value.active, false);
        assert.equal(value.live, true);
    } finally {
        gate.resolve();
        await closing;
    }
    assert.equal(await work, true);
    assert.equal(value.live, false);
    await f.player.close();
});

test('配置过程中同步取消借用方，失败回收不等待当前 acquire 任务', async () => {
    const root = new Scope('root'),
        owner = new Scope('borrower');
    let destroyed = 0;
    const pool = new InstancePool(root, {
        create: async (scope) => {
            scope.defer(() => {
                destroyed++;
            });
            return {};
        },
        activate: () => {
            owner.cancel();
        },
        deactivate: async () => {},
        valid: () => true,
    });
    await assert.rejects(pool.acquire(undefined, owner), { code: 'OPERATION_CANCELLED' });
    assert.equal(destroyed, 1);
    assert.equal(pool.inspect().size, 0);
    assert.equal(pool.inspect().borrowed, 0);
    await owner.close();
    await root.close();
});

test('自动归还的停用失败由 close 汇总，仍销毁实例且不丢失清理错误', async (t) => {
    t.mock.method(console, 'error', () => {});
    for (const closePool of [false, true]) {
        const root = new Scope('root'),
            owner = new Scope('borrower');
        let destroyed = 0;
        const pool = new InstancePool(root, {
            create: async (scope) => {
                scope.defer(() => {
                    destroyed++;
                });
                return {};
            },
            activate: () => {},
            deactivate: async () => {
                throw Error('stop failed');
            },
            valid: () => true,
        });
        await pool.acquire(undefined, owner);
        const cancelled = closePool ? root : owner,
            remaining = closePool ? owner : root;
        const closing = cancelled.close();
        await assert.rejects(closing, { code: 'SCOPE_CLEANUP_FAILED' });
        assert.equal(cancelled.closed, true);
        assert.equal(destroyed, 1);
        assert.equal(pool.inspect().size, 0);
        assert.equal(pool.inspect().borrowed, 0);
        await remaining.close();
    }
});
