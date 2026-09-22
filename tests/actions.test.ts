import test from 'node:test';
import assert from 'node:assert/strict';
import { Actions } from '../assets/framework/core/actions';
import { Scope, taskContext } from '../assets/framework/core/scope';
import { deferred, flush } from './fake-clock';

test('borrowed lifetimes cannot close their host and still own independent child work', async () => {
    const owner = new Scope('host');
    const borrowed = taskContext(owner).scope;
    assert.equal('close' in borrowed, false);
    assert.equal('cancel' in borrowed, false);
    assert.equal(taskContext(owner).scope, borrowed);
    const child = borrowed.child('local');
    assert.equal(owner.owns(child.lifetime), true);
    await child.close();
    assert.equal(owner.signal.aborted, false);
    await owner.close();
    assert.equal(borrowed.signal.aborted, true);
});

test('latest cancels stale delivery immediately but retains resources until physical work ends', async () => {
    const owner = new Scope('view'),
        actions = new Actions(owner.lifetime),
        gate = deferred();
    let rendered = '',
        released = false;
    const first = actions.latest('search', async (task) => {
        task.scope.defer(() => {
            released = true;
        });
        await gate.promise;
        assert.equal(
            task.commit(() => {
                rendered = 'old';
            }),
            false,
        );
        return 'old';
    });
    const rejected = assert.rejects(first, { code: 'OPERATION_CANCELLED' });
    await flush();
    const second = actions.latest('search', (task) => {
        task.commit(() => {
            rendered = 'new';
        });
        return 'new';
    });
    await rejected;
    assert.equal(await second, 'new');
    assert.equal(released, false);
    let closed = false;
    const closing = owner.close().then(() => {
        closed = true;
    });
    await flush();
    assert.equal(closed, false);
    gate.resolve();
    await closing;
    assert.equal(released, true);
    assert.equal(rendered, 'new');
});

test('exclusive ignores duplicate work and serial bounds and cancels queued work', async () => {
    const owner = new Scope('view'),
        actions = new Actions(owner),
        gate = deferred();
    let calls = 0;
    const first = actions.exclusive('submit', async () => {
        calls++;
        await gate.promise;
    });
    await flush();
    assert.equal(
        await actions.exclusive('submit', () => {
            calls++;
        }),
        undefined,
    );
    assert.equal(calls, 1);
    gate.resolve();
    await first;
    await flush();
    const order: number[] = [];
    await Promise.all(
        [1, 2, 3].map((n) =>
            actions.serial('save', () => {
                order.push(n);
            }),
        ),
    );
    assert.deepEqual(order, [1, 2, 3]);
    const blocked = deferred();
    const active = actions.serial('wait', () => blocked.promise, 2);
    const queued = actions.serial(
        'wait',
        () => {
            calls++;
        },
        2,
    );
    const cancelled = [
        assert.rejects(active, { code: 'OPERATION_CANCELLED' }),
        assert.rejects(queued, { code: 'OPERATION_CANCELLED' }),
    ];
    assert.throws(() => actions.serial('wait', () => {}, 2), { code: 'ACTION_QUEUE_FULL' });
    assert.throws(() => actions.latest('save', () => {}), { code: 'ACTION_POLICY_MISMATCH' });
    await flush();
    const closing = owner.close();
    await Promise.all(cancelled);
    assert.equal(calls, 1);
    blocked.resolve();
    await closing;
});
