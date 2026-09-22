import test from 'node:test';
import assert from 'node:assert/strict';
import { BootFlow } from '../assets/framework/core/boot';
import { Scope } from '../assets/framework/core/scope';
import { deferred, flush } from './fake-clock';

test('failed startup reclaims its attempt and leaves the host available for retry', async () => {
    const root = new Scope('app'),
        boot = new BootFlow(root.lifetime);
    const calls: number[] = [];
    let cleaned = 0;
    await assert.rejects(
        boot.start(async (attempt) => {
            calls.push(attempt.attempt);
            attempt.scope.defer(() => {
                cleaned++;
            });
            throw Error('offline');
        }),
        /offline/,
    );
    assert.equal(cleaned, 1);
    assert.equal(root.signal.aborted, false);
    assert.equal(boot.inspect().state, 'failed');
    const gate = deferred();
    const retry = boot.start(async (attempt) => {
        calls.push(attempt.attempt);
        attempt.scope.defer(() => {
            cleaned++;
        });
        await gate.promise;
    });
    assert.equal(
        boot.start(() => {
            throw Error('duplicate');
        }),
        retry,
    );
    await flush();
    gate.resolve();
    await retry;
    assert.deepEqual(calls, [1, 2]);
    assert.equal(boot.inspect().state, 'ready');
    assert.throws(() => boot.start(() => {}), { code: 'BOOT_ALREADY_READY' });
    await root.close();
    assert.equal(cleaned, 2);
});
