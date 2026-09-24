import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAssetBatch } from '../assets/framework/assets/asset-batch';
import { LeaseCache } from '../assets/framework/assets/lease-cache';
import { Scope } from '../assets/framework/core/scope';
import { deferred, flush } from './fake-clock';

const keys = {
    a: { id: 'a', type: 'JsonAsset' },
    b: { id: 'b', type: 'JsonAsset' },
    c: { id: 'c', type: 'JsonAsset' },
} as const;
test('资源批量准备限制并发，保留命名结果，进度按完成条目递增', async () => {
    const owner = new Scope('batch'),
        gates = [deferred<any>(), deferred<any>(), deferred<any>()];
    const started: string[] = [],
        progress: number[] = [];
    const pending = loadAssetBatch(
        keys,
        owner,
        async (key) => {
            started.push(key.id);
            return await gates['abc'.indexOf(key.id)].promise;
        },
        {
            concurrency: 2,
            onProgress: (value) => {
                progress.push(value.completed);
                assert.equal(value.total, 3);
            },
        },
    );
    await flush();
    assert.deepEqual(started, ['a', 'b']);
    gates[1].resolve({ id: 'b' });
    await flush();
    assert.deepEqual(started, ['a', 'b', 'c']);
    gates[2].resolve({ id: 'c' });
    gates[0].resolve({ id: 'a' });
    const values = await pending;
    assert.deepEqual(values.a, { id: 'a' });
    assert.deepEqual(values.b, { id: 'b' });
    assert.deepEqual(progress, [0, 1, 2, 3]);
    assert.equal(Object.isFrozen(values), true);
    await owner.close();
});
test('资源批量失败回收本批持有，共享加载及其他所有者不受影响', async () => {
    const owner = new Scope('batch'),
        other = new Scope('other'),
        late = deferred<any>();
    const released: string[] = [];
    const cache = new LeaseCache<any>(
        async (id) => {
            if (id === 'b') throw Error('broken');
            if (id === 'c') return late.promise;
            return { id };
        },
        () => {},
        (value) => {
            released.push(value.id);
        },
    );
    await cache.acquire('a', other);
    await assert.rejects(
        loadAssetBatch(keys, owner, (key, scope) => cache.acquire(key.id, scope), { concurrency: 3 }),
        /broken/,
    );
    assert.equal(owner.inspect().children.length, 0);
    assert.deepEqual(released, []);
    late.resolve({ id: 'c' });
    await flush();
    assert.deepEqual(released, ['c']);
    await other.close();
    assert.deepEqual(released, ['c', 'a']);
    await owner.close();
});
test('批量取消不启动排队项、不交付迟到结果，进度异常也完整回收', async () => {
    const owner = new Scope('batch'),
        gate = deferred<any>();
    const started: string[] = [],
        progress: number[] = [];
    const pending = loadAssetBatch(
        keys,
        owner,
        async (key) => {
            started.push(key.id);
            return gate.promise;
        },
        {
            concurrency: 1,
            onProgress: (value) => {
                progress.push(value.completed);
            },
        },
    );
    await flush();
    owner.cancel();
    await assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
    gate.resolve({});
    await flush();
    assert.deepEqual(started, ['a']);
    assert.deepEqual(progress, [0]);
    await owner.close();
    const next = new Scope('progress');
    let released = false;
    await assert.rejects(
        loadAssetBatch(
            { a: keys.a },
            next,
            async (_key, scope) => {
                scope.defer(() => {
                    released = true;
                });
                return {} as any;
            },
            {
                onProgress: (value) => {
                    if (value.completed) throw Error('progress');
                },
            },
        ),
        /progress/,
    );
    assert.equal(released, true);
    assert.equal(next.inspect().children.length, 0);
    await next.close();
});
test('空批次不遗留 Scope，无效并发数不启动加载', async () => {
    const owner = new Scope('empty');
    let calls = 0;
    const loader = async () => {
        calls++;
        return {} as any;
    };
    assert.deepEqual(Object.keys(await loadAssetBatch({}, owner, loader)), []);
    for (const concurrency of [0, -1, 1.5, NaN])
        await assert.rejects(loadAssetBatch(keys, owner, loader, { concurrency }), { code: 'ASSET_BATCH_LIMIT' });
    assert.equal(calls, 0);
    assert.equal(owner.inspect().children.length, 0);
    await owner.close();
});
