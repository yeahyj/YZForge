import test from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../assets/framework/core/scope';
import { BadgeStore, badgeKey } from '../assets/framework/badges/badge-store';

test('红点：嵌套求和与 any 聚合、动态移除、旧句柄不可写入同名新来源', async () => {
    const root = new Scope('badges'),
        store = new BadgeStore(root);
    const top = badgeKey('top'),
        category = badgeKey('category'),
        item = badgeKey('item');
    store.group(top, 'sum', root);
    const group = store.group(category, 'any', root, top);
    const source = store.source(item, root, category, 8);
    assert.equal(store.get(top), 1);
    group.dispose();
    assert.equal(store.get(top), 0);
    store.group(category, 'sum', root, top);
    store.source(item, root, category, 2);
    assert.throws(() => source.set(5), { code: 'BADGE_SOURCE_ENDED' });
    source.dispose();
    assert.equal(store.get(top), 2);
    await root.close();
    assert.deepEqual(store.inspect(), { nodes: 0, subscriptions: 0, ended: true });
});

test('红点：可提前订阅，批量净值合并，重复写入不通知', async () => {
    const root = new Scope('badges'),
        store = new BadgeStore(root),
        key = badgeKey('task');
    const values: number[] = [];
    const observer = root.child('page');
    store.subscribe(key, observer, (value) => values.push(value));
    const item = store.source(key, root, undefined, 1);
    store.batch(() => {
        item.set(2);
        item.set(3);
        item.set(1);
    });
    store.batch(() => {
        item.set(2);
        item.set(3);
    });
    item.set(3);
    assert.deepEqual(values, [0, 1, 3]);
    await observer.close();
    item.set(4);
    assert.equal(store.inspect().subscriptions, 0);
    assert.deepEqual(values, [0, 1, 3]);
    await root.close();
});

test('红点：列表式反复解绑重绑只接收当前业务 Key，源所有者取消立即归零', async () => {
    const root = new Scope('badges'),
        store = new BadgeStore(root),
        sourceOwner = root.child('account');
    const a = store.source(badgeKey('a'), sourceOwner, undefined, 1);
    const b = store.source(badgeKey('b'), sourceOwner, undefined, 2);
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
        const item = root.child('item');
        store.subscribe(i % 2 ? a.key : b.key, item, (n) => seen.push(n));
        assert.equal(store.inspect().subscriptions, 1);
        await item.close();
    }
    const last = root.child('last');
    store.subscribe(b.key, last, (n) => seen.push(n));
    a.set(8);
    b.set(9);
    sourceOwner.cancel();
    assert.deepEqual(seen.slice(-3), [2, 9, 0]);
    assert.equal(store.inspect().nodes, 0);
    await root.close();
});

test('红点：验证输入与父级、通知抛错隔离、批处理抛错仍发布已写入状态', async () => {
    const errors: unknown[] = [],
        root = new Scope('badges'),
        store = new BadgeStore(root, (e) => errors.push(e));
    const key = badgeKey('a'),
        source = store.source(key, root);
    assert.throws(() => store.source(key, root), { code: 'BADGE_DUPLICATE' });
    assert.throws(() => store.source(badgeKey('b'), root, key), { code: 'BADGE_PARENT_INVALID' });
    for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => source.set(value));
    assert.throws(() =>
        store.subscribe(key, root, () => {
            throw Error('initial');
        }),
    );
    assert.equal(store.inspect().subscriptions, 0);
    store.subscribe(key, root, (n) => {
        if (n) throw Error('listener');
    });
    let last = 0;
    store.subscribe(key, root, (n) => {
        last = n;
    });
    assert.throws(() =>
        store.batch(() => {
            source.set(7);
            throw Error('batch');
        }),
    );
    assert.equal(last, 7);
    assert.equal(errors.length, 1);
    await root.close();
});

test('红点：通知期间可以重入写入或取消其他订阅', async () => {
    const root = new Scope('badges'),
        store = new BadgeStore(root),
        key = badgeKey('a');
    const source = store.source(key, root),
        observer = root.child('observer');
    const values: number[] = [];
    store.subscribe(key, root, (n) => {
        if (n === 1) {
            observer.cancel();
            source.set(2);
        }
        values.push(n);
    });
    store.subscribe(key, observer, (n) => {
        assert.equal(n, 0);
    });
    source.set(1);
    assert.deepEqual(values, [0, 1, 2]);
    await root.close();
});

test('红点：批处理中首次订阅只通知一次，外部可变 Key 不影响注册和解绑', async () => {
    const root = new Scope('badges'),
        store = new BadgeStore(root);
    const key = { id: 'original' },
        values: number[] = [];
    const source = store.source(key, root);
    let off = () => {};
    store.batch(() => {
        source.set(2);
        off = store.subscribe(key, root, (n) => values.push(n));
    });
    assert.deepEqual(values, [2]);
    key.id = 'changed';
    source.set(3);
    assert.deepEqual(values, [2, 3]);
    off();
    assert.equal(store.inspect().subscriptions, 0);
    source.dispose();
    assert.equal(store.get({ id: 'original' }), 0);
    assert.equal(store.inspect().nodes, 0);
    await root.close();
});
