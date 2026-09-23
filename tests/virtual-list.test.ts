import test from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../assets/framework/core/scope';
import { Events, eventKey } from '../assets/framework/core/events';
import {
    VirtualListController,
    type VirtualListItemContext,
} from '../assets/framework/ui/components/virtual-list/virtual-list-controller';
import { FixedVirtualLayout } from '../assets/framework/ui/components/virtual-list/virtual-list-layout';
import { deferred, flush } from './fake-clock';

type Cell = { id: number; active: boolean; text: string; disposed: boolean };
function fixture(
    input: {
        render?: (cell: Cell, item: VirtualListItemContext<number>) => void | Promise<void>;
        create?: () => Promise<void>;
        deactivate?: () => Promise<void>;
    } = {},
) {
    const errors: unknown[] = [];
    const owner = new Scope('test', (error) => errors.push(error));
    const cells: Cell[] = [];
    const renders: { cell: Cell; item: VirtualListItemContext<number> }[] = [];
    const list = new VirtualListController<number, Cell>(
        owner,
        { itemWidth: 100, itemHeight: 20, overscanRows: 0 },
        {
            create: async (scope) => {
                await input.create?.();
                scope.signal.throwIfAborted();
                const cell = { id: cells.length, active: false, text: '', disposed: false };
                cells.push(cell);
                // 与 ScopedAssets.instantiate 一致：资源实例是 slot 下独立子 Scope。
                scope.child('asset-instance').defer(() => {
                    cell.disposed = true;
                    cell.active = false;
                });
                return cell;
            },
            place: () => {},
            render: (cell, item) => {
                renders.push({ cell, item });
                cell.text = String(item.data);
                return input.render?.(cell, item);
            },
            activate: (cell) => {
                cell.active = true;
            },
            deactivate: (cell) => {
                cell.active = false;
                return input.deactivate?.() ?? Promise.resolve();
            },
        },
        (error) => errors.push(error),
    );
    return { owner, list, cells, renders, errors };
}
const data = (count: number) => Array.from({ length: count }, (_, i) => i);

test('固定列表、网格的尺寸、锚点无关位置和末行计算', () => {
    const layout = new FixedVirtualLayout({
        itemWidth: 40,
        itemHeight: 20,
        columns: 3,
        spacingX: 5,
        spacingY: 4,
        paddingTop: 10,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 2,
        overscanRows: 0,
    });
    assert.equal(layout.width, 140);
    assert.equal(layout.height(0), 16);
    assert.equal(layout.height(7), 84);
    assert.deepEqual(layout.position(4), { x: 53, y: 34 });
    assert.deepEqual(layout.range(7, 20, 34), { start: 3, end: 6 });
    assert.deepEqual(layout.range(7, 20, 999), { start: 6, end: 7 });
});

test('窗口采用半开边界，正确处理间距、空数据、零视口、回弹和预备行', () => {
    const layout = new FixedVirtualLayout({ itemWidth: 10, itemHeight: 20, spacingY: 10, overscanRows: 0 });
    assert.deepEqual(layout.range(50, 20, 0), { start: 0, end: 1 });
    assert.deepEqual(layout.range(50, 10, 20), { start: 0, end: 0 });
    assert.deepEqual(layout.range(50, 20, 30), { start: 1, end: 2 });
    assert.deepEqual(layout.range(50, 20, -100), { start: 0, end: 1 });
    assert.deepEqual(layout.range(0, 20, 0), { start: 0, end: 0 });
    assert.deepEqual(layout.range(50, 0, 0), { start: 0, end: 0 });
    assert.deepEqual(new FixedVirtualLayout({ itemWidth: 10, itemHeight: 20 }).range(50, 40, 60), { start: 2, end: 6 });
});

test('四种定位方式正确夹紧，nearest 不移动已经可见及覆盖视口的条目', () => {
    const layout = new FixedVirtualLayout({ itemWidth: 10, itemHeight: 20 });
    assert.equal(layout.offset(100, 60, 10, 'start', 0), 200);
    assert.equal(layout.offset(100, 60, 10, 'center', 0), 180);
    assert.equal(layout.offset(100, 60, 10, 'end', 0), 160);
    assert.equal(layout.offset(100, 60, 10, 'nearest', 180), 180);
    assert.equal(layout.offset(100, 60, 10, 'nearest', 0), 160);
    assert.equal(layout.offset(100, 60, 10, 'nearest', 300), 200);
    assert.equal(layout.offset(100, 60, 99, 'start', 0), 1940);
    assert.equal(layout.offset(100, 10, 10, 'nearest', 205), 205);
});

test('非法布局不允许 NaN、无穷、零尺寸、负间距和小数列数', () => {
    for (const input of [
        { itemWidth: 0 },
        { itemHeight: NaN },
        { spacingY: -1 },
        { paddingTop: Infinity },
        { columns: 1.5 },
        { columns: 0 },
        { overscanRows: 0.5 },
    ]) {
        assert.throws(() => new FixedVirtualLayout({ itemWidth: 10, itemHeight: 10, ...input }), {
            code: 'VIRTUAL_LIST_LAYOUT',
        });
    }
});

test('十万条数据只创建窗口实例，长距离跳转复用节点且不重绑仍可见项', async () => {
    const f = fixture();
    f.list.setViewport(60, 0);
    f.list.setItems(data(100000));
    await f.list.whenIdle();
    assert.equal(f.cells.length, 3);
    f.list.setViewport(60, 20);
    await f.list.whenIdle();
    assert.equal(f.renders.filter((r) => r.item.index === 1).length, 1);
    f.list.setViewport(60, 500000);
    await f.list.whenIdle();
    assert.deepEqual(f.list.inspect().indices, [25000, 25001, 25002]);
    assert.ok(f.cells.length <= 4);
    assert.equal(f.cells.filter((cell) => cell.active).length, 3);
    await f.owner.close();
    assert.ok(f.cells.every((cell) => cell.disposed));
    assert.equal(f.owner.inspect().children.length, 0);
});

test('局部刷新只更换指定绑定，重复索引合并，离屏更新在出现时生效', async () => {
    const f = fixture();
    f.list.setViewport(60, 0);
    f.list.setItems(data(100));
    await f.list.whenIdle();
    const first = f.renders.map((r) => r.item);
    f.list.refresh([1, 1]);
    await f.list.whenIdle();
    assert.equal(f.renders.length, 4);
    assert.equal(first[1].signal.aborted, true);
    assert.equal(first[0].signal.aborted, false);
    f.list.updateItem(80, 888);
    assert.equal(f.renders.length, 4);
    f.list.setViewport(60, 1600);
    await f.list.whenIdle();
    assert.equal(f.renders.findLast((r) => r.item.index === 80)?.cell.text, '888');
    await f.owner.close();
});

test('数组快照、同索引新数据、清空、缩短后偏移夹紧及重新填充', async () => {
    const f = fixture();
    const values = data(100);
    f.list.setViewport(40, 0);
    f.list.setItems(values);
    values[0] = 999;
    await f.list.whenIdle();
    assert.equal(f.renders[0].item.data, 0);
    f.list.setViewport(40, 1960);
    await f.list.whenIdle();
    f.list.setItems([8, 7, 6]);
    await f.list.whenIdle();
    assert.equal(f.list.scrollOffset, 20);
    assert.deepEqual(f.list.inspect().indices, [1, 2]);
    f.list.setItems([]);
    await f.list.whenIdle();
    assert.equal(f.list.inspect().slots, 0);
    assert.equal(f.list.scrollOffset, 0);
    f.list.setItems([42]);
    await f.list.whenIdle();
    assert.equal(f.renders.at(-1)?.cell.text, '42');
    await f.owner.close();
});

test('异步任务与清理屏障完成前不复用同一节点，旧 commit 被拦截', async () => {
    const gate = deferred<void>();
    let oldTask!: Promise<unknown>;
    let committed = true;
    const f = fixture({
        render: (cell, item) => {
            if (item.index === 0)
                oldTask = item.run(async (task) => {
                    await gate.promise;
                    committed = task.commit(() => {
                        cell.text = '过期';
                    });
                });
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems(data(100));
    await f.list.whenIdle();
    const old = f.renders[0];
    f.list.setViewport(20, 1000);
    await flush();
    assert.equal(old.item.signal.aborted, true);
    assert.equal(old.cell.active, false);
    for (let i = 0; i < 50; i++) f.list.setViewport(20, i * 20);
    assert.ok(f.list.inspect().slots <= 2);
    assert.equal(f.renders.filter((r) => r.cell === old.cell).length, 1);
    gate.resolve();
    await oldTask;
    await f.list.whenIdle();
    assert.equal(committed, false);
    assert.deepEqual(f.list.inspect().indices, [49]);
    await f.owner.close();
});

test('Part 失活屏障也阻止复用，关闭立即隐藏全部节点', async () => {
    const gate = deferred<void>();
    let wait = true;
    const f = fixture({ deactivate: () => (wait ? gate.promise : Promise.resolve()) });
    f.list.setViewport(20, 0);
    f.list.setItems(data(10));
    await f.list.whenIdle();
    const old = f.renders[0].cell;
    f.list.refresh([0]);
    await flush();
    assert.equal(old.active, false);
    assert.equal(f.renders.filter((r) => r.cell === old).length, 1);
    wait = false;
    gate.resolve();
    await f.list.whenIdle();
    const closing = f.owner.close();
    assert.ok(f.cells.every((cell) => !cell.active));
    await closing;
});

test('绑定期限取消时立即移除事件订阅；新绑定仅接收一次', async () => {
    const events = new Events();
    const key = eventKey<void>('list:test');
    const received: number[] = [];
    const f = fixture({
        render: (_cell, item) => {
            events.on(
                key,
                () => {
                    received.push(item.index);
                },
                item.scope,
            );
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems(data(10));
    await f.list.whenIdle();
    events.emit(key, undefined);
    await flush();
    assert.deepEqual(received, [0]);
    f.list.setViewport(20, 40);
    await f.list.whenIdle();
    events.emit(key, undefined);
    await flush();
    assert.deepEqual(received, [0, 2]);
    await f.owner.close();
    events.emit(key, undefined);
    await flush();
    assert.deepEqual(received, [0, 2]);
});

test('加载中跳转和替换数据采用最新窗口，实例加载数量有界', async () => {
    const gate = deferred<void>();
    let loads = 0;
    const f = fixture({
        create: async () => {
            loads++;
            await gate.promise;
        },
    });
    f.list.setViewport(40, 0);
    f.list.setItems(data(100));
    await flush();
    for (let i = 1; i < 20; i++) f.list.setViewport(40, i * 60);
    f.list.setItems([88, 99]);
    gate.resolve();
    await f.list.whenIdle();
    assert.ok(loads <= 3);
    assert.deepEqual(f.list.inspect().indices, [0, 1]);
    assert.ok(f.renders.every((r) => r.item.data === 88 || r.item.data === 99));
    await f.owner.close();
});

test('加载中关闭等待完成并取消，迟到实例不会激活或泄漏', async () => {
    const gate = deferred<void>();
    const f = fixture({ create: () => gate.promise });
    f.list.setViewport(40, 0);
    f.list.setItems(data(100));
    await flush();
    let closed = false;
    const closing = f.owner.close().then(() => {
        closed = true;
    });
    await flush();
    assert.equal(closed, false);
    gate.resolve();
    await closing;
    assert.equal(f.renders.length, 0);
    assert.equal(f.list.inspect().slots, 0);
    assert.deepEqual(f.errors, []);
});

test('关闭列表时兄弟资源 Scope 必须等绑定任务退出后才销毁实例', async () => {
    const gate = deferred<void>();
    let task!: Promise<unknown>;
    const f = fixture({
        render: (_cell, item) => {
            task = item.run(() => gate.promise);
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems([1]);
    await f.list.whenIdle();
    const closing = f.owner.close();
    for (let i = 0; i < 6; i++) await flush();
    const disposedBeforeTask = f.cells[0].disposed;
    gate.resolve();
    await task;
    await closing;
    assert.equal(disposedBeforeTask, false, '绑定任务尚未退出，不应销毁兄弟 Scope 中的预制体实例');
    assert.equal(f.cells[0].disposed, true);
});

test('关闭列表时异步绑定清理也必须先于预制体资源销毁', async () => {
    const gate = deferred<void>();
    const f = fixture({
        render: (_cell, item) => {
            item.scope.defer(() => gate.promise);
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems([1]);
    await f.list.whenIdle();
    const closing = f.owner.close();
    for (let i = 0; i < 12; i++) await flush();
    const disposedBeforeCleanup = f.cells[0].disposed;
    gate.resolve();
    await closing;
    assert.equal(disposedBeforeCleanup, false, '异步清理仍在使用实例时，不能销毁预制体资源');
});

test('取消监听重入 dispose 时退出屏障已经登记，不死锁且只清理一次', async () => {
    const gate = deferred<void>();
    let cleaned = 0;
    const f = fixture({
        render: (_cell, item) => {
            item.signal.onAbort(() => {
                void f.list.dispose();
            });
            item.scope.defer(async () => {
                await gate.promise;
                cleaned++;
            });
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems([1]);
    await f.list.whenIdle();
    f.list.refresh();
    for (let i = 0; i < 6; i++) await flush();
    assert.equal(f.cells[0].disposed, false);
    gate.resolve();
    await f.list.dispose();
    await f.owner.close();
    assert.equal(cleaned, 1);
    assert.deepEqual(f.errors, []);
});

test('异步 render 返回前失效，旧实例不会被迟到的激活显示', async () => {
    const gate = deferred<void>();
    const f = fixture({ render: (_cell, item) => (item.index === 0 ? gate.promise : undefined) });
    f.list.setViewport(20, 0);
    f.list.setItems(data(10));
    for (let i = 0; i < 12; i++) await flush();
    const old = f.renders[0];
    assert.equal(old.cell.active, false);
    f.list.setViewport(20, 100);
    assert.equal(old.item.signal.aborted, true);
    gate.resolve();
    await f.list.whenIdle();
    assert.deepEqual(f.list.inspect().indices, [5]);
    assert.ok(f.cells.filter((cell) => cell.active).every((cell) => cell.text === '5'));
    await f.owner.close();
});

test('渲染失败只上报且不自动死循环，手动刷新可恢复', async () => {
    let fail = true;
    const f = fixture({
        render: () => {
            if (fail) throw Error('render failed');
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems([1]);
    await f.list.whenIdle();
    assert.ok(f.errors.length >= 1);
    assert.equal(f.renders.length, 1);
    assert.ok(f.cells.every((cell) => !cell.active));
    fail = false;
    f.list.refresh();
    await f.list.whenIdle();
    assert.equal(f.renders.length, 2);
    assert.equal(f.cells.filter((cell) => cell.active).length, 1);
    await f.owner.close();
});

test('加载失败可重试，非法刷新先完整校验而不部分取消条目', async () => {
    let fail = true;
    const f = fixture({
        create: async () => {
            if (fail) throw Error('load failed');
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems([1]);
    await f.list.whenIdle();
    assert.equal(f.list.inspect().slots, 0);
    fail = false;
    f.list.refresh();
    await f.list.whenIdle();
    const item = f.renders[0].item;
    assert.throws(() => f.list.refresh([0, 9]), { code: 'VIRTUAL_LIST_INDEX' });
    assert.equal(item.signal.aborted, false);
    assert.throws(() => f.list.updateItem(-1, 1), { code: 'VIRTUAL_LIST_INDEX' });
    assert.throws(() => f.list.scrollTarget(0.5, 'start'), { code: 'VIRTUAL_LIST_INDEX' });
    await f.owner.close();
    assert.throws(() => f.list.setItems([]), { code: 'OPERATION_CANCELLED' });
});

test('视口扩大缩小、网格切换和零高度恢复，不重绑仍有效的条目', async () => {
    const f = fixture();
    f.list.setItems(data(100));
    assert.equal(f.list.inspect().slots, 0);
    f.list.setViewport(100, 0);
    await f.list.whenIdle();
    f.list.setLayout({ itemWidth: 20, itemHeight: 20, columns: 3, overscanRows: 0 });
    await f.list.whenIdle();
    assert.equal(f.list.inspect().indices.length, 15);
    assert.equal(f.renders.filter((r) => r.item.index === 0).length, 1);
    f.list.setViewport(20, 0);
    await f.list.whenIdle();
    assert.ok(f.list.inspect().slots <= 6);
    f.list.setViewport(0, 0);
    await f.list.whenIdle();
    assert.equal(f.list.inspect().slots, 0);
    f.list.setViewport(40, 0);
    await f.list.whenIdle();
    assert.equal(f.list.inspect().indices.length, 6);
    await f.owner.close();
});

test('异步清理失败的实例销毁，不放回复用池；其他条目仍能继续工作', async () => {
    let first = true;
    const f = fixture({
        render: (_cell, item) => {
            if (first) {
                first = false;
                item.scope.defer(() => {
                    throw Error('cleanup failed');
                });
            }
        },
    });
    f.list.setViewport(20, 0);
    f.list.setItems([1]);
    await f.list.whenIdle();
    const old = f.renders[0].cell;
    f.list.refresh();
    await f.list.whenIdle();
    assert.equal(old.disposed, true);
    assert.notEqual(f.renders.at(-1)?.cell, old);
    assert.equal(f.renders.at(-1)?.cell.active, true);
    assert.ok(f.errors.length > 0);
    await f.owner.close();
});

test('关闭期间绑定或 Part 清理失败仍释放全部实例，并拒绝 dispose 与父级 close', async () => {
    for (const kind of ['binding', 'part'])
        for (const parentCloses of [false, true])
            for (const retirementStarted of [false, true]) {
                const gate = deferred(),
                    failure = Error(`${kind} cleanup failed`);
                const cleanup = async () => {
                    await gate.promise;
                    throw failure;
                };
                const f = fixture({
                    render: (_cell, item) => {
                        if (kind === 'binding') item.scope.defer(cleanup);
                    },
                    deactivate: kind === 'part' ? cleanup : undefined,
                });
                f.list.setViewport(40, 0);
                f.list.setItems([1, 2]);
                await f.list.whenIdle();
                if (retirementStarted) f.list.refresh();
                const closing = parentCloses ? f.owner.close() : f.list.dispose();
                const checked = assert.rejects(closing, { code: 'SCOPE_CLEANUP_FAILED' });
                if (!parentCloses) assert.equal(f.list.dispose(), closing);
                await flush();
                assert.ok(f.cells.every((cell) => !cell.active && !cell.disposed));
                gate.resolve();
                await checked;
                await f.list.whenIdle();
                assert.ok(f.cells.every((cell) => cell.disposed));
                assert.ok(f.errors.length > 0);
                assert.equal(f.list.inspect().slots, 0);
                assert.equal(f.owner.inspect().children.length, 0);
                if (!parentCloses) await f.owner.close();
            }
});

test('反复局部刷新后 Scope 子级数量稳定，不残留旧绑定期限', async () => {
    const f = fixture();
    f.list.setViewport(60, 0);
    f.list.setItems(data(100));
    await f.list.whenIdle();
    for (let i = 0; i < 60; i++) {
        f.list.updateItem(0, i);
        await f.list.whenIdle();
    }
    const snapshot = f.list.scope.inspect();
    assert.equal(snapshot.children.length, f.list.inspect().slots);
    assert.ok(snapshot.children.every((slot) => slot.children.length >= 1 && slot.children.length <= 2));
    assert.equal(
        snapshot.children.flatMap((slot) => slot.children).filter((child) => child.label.includes('item:')).length,
        3,
    );
    assert.ok(snapshot.children.every((slot) => slot.tasks.length === 0));
    await f.owner.close();
});
