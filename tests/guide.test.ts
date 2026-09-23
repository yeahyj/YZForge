import test from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../assets/framework/core/scope';
import { untilCancelled } from '../assets/framework/core/cancellation';
import { GuideRunner, type GuideCheckpoint } from '../assets/framework/guide/guide-runner';
import { GuideTargets } from '../assets/framework/guide/guide-targets';
import { StorageGuideProgress } from '../assets/framework/guide/guide-progress';
import { Storage } from '../assets/framework/platform/storage';
import {
    focusFrame,
    focusGeometry,
    insideFocus,
    intersectFocusRect,
} from '../assets/framework/ui/components/guide/guide-focus';
import { deferred, flush } from './fake-clock';

test('引导：按稳定步骤恢复，清理结束后才保存和启动下一步', async () => {
    const owner = new Scope('guide'),
        gate = deferred(),
        log: string[] = [];
    let saved: GuideCheckpoint | undefined;
    const runner = new GuideRunner({
        read: () => saved,
        write: (_id, value) => {
            saved = value;
            log.push(`save:${value.nextStep ?? value.status}`);
        },
    });
    const definition = {
        id: 'intro',
        version: 1,
        steps: [
            {
                id: 'a',
                run: (task: any) => {
                    log.push('a');
                    task.scope.defer(() =>
                        gate.promise.then(() => {
                            log.push('clean-a');
                        }),
                    );
                },
            },
            {
                id: 'b',
                run: () => {
                    log.push('b');
                },
            },
        ],
    };
    const handle = runner.start(definition, owner);
    await flush();
    assert.deepEqual(log, ['a']);
    assert.throws(() => runner.start(definition, owner), { code: 'GUIDE_BUSY' });
    gate.resolve();
    assert.deepEqual(await handle.result, { status: 'completed' });
    assert.deepEqual(log, ['a', 'clean-a', 'save:b', 'b', 'save:completed']);
    const before = log.length;
    await runner.start(definition, owner).result;
    assert.equal(log.length, before);
    saved = { version: 1, status: 'running', nextStep: 'b' };
    await runner.start(definition, owner).result;
    assert.deepEqual(log.slice(-2), ['b', 'save:completed']);
    await owner.close();
});

test('引导：取消保留检查点，等待不配合取消的任务和异步清理，不允许抢跑', async () => {
    const owner = new Scope('guide'),
        gate = deferred(),
        cleanup = deferred();
    let writes = 0;
    const runner = new GuideRunner({
        read: () => undefined,
        write: () => {
            writes++;
        },
    });
    const definition = {
        id: 'intro',
        version: 1,
        steps: [
            {
                id: 'a',
                run: async (task: any) => {
                    task.scope.defer(() => cleanup.promise);
                    await gate.promise;
                },
            },
        ],
    };
    const handle = runner.start(definition, owner);
    await flush();
    handle.cancel();
    let ended = false;
    void handle.result.then(() => {
        ended = true;
    });
    await flush();
    assert.equal(ended, false);
    assert.equal(writes, 0);
    assert.throws(() => runner.start(definition, owner), { code: 'GUIDE_BUSY' });
    gate.resolve();
    await flush();
    assert.equal(ended, false);
    cleanup.resolve();
    assert.deepEqual(await handle.result, { status: 'cancelled' });
    assert.equal(owner.inspect().children.length, 0);
    await owner.close();
});

test('引导：跳过策略、步骤超时、业务失败、存档失败不误记完成', async () => {
    const owner = new Scope('guide'),
        checkpoints: GuideCheckpoint[] = [];
    const runner = new GuideRunner({ read: () => undefined, write: (_id, saved) => checkpoints.push(saved) });
    const waiting = (task: any) => untilCancelled(new Promise<void>(() => {}), task.signal);
    const definition = { id: 'intro', version: 1, steps: [{ id: 'a', run: waiting }] };
    const protectedRun = runner.start(definition, owner);
    assert.throws(() => protectedRun.skip(), { code: 'GUIDE_SKIP_DISABLED' });
    protectedRun.cancel();
    await protectedRun.result;
    const skipped = runner.start({ ...definition, allowSkip: true }, owner);
    await flush();
    skipped.skip();
    assert.deepEqual(await skipped.result, { status: 'skipped' });
    assert.equal(checkpoints[0].status, 'skipped');
    await assert.rejects(
        runner.start({ ...definition, steps: [{ id: 'a', timeoutMs: 5, run: waiting }] }, owner).result,
        { code: 'GUIDE_TIMEOUT' },
    );
    await assert.rejects(
        runner.start(
            {
                ...definition,
                steps: [
                    {
                        id: 'a',
                        run: () => {
                            throw Error('business');
                        },
                    },
                ],
            },
            owner,
        ).result,
        /business/,
    );
    assert.equal(checkpoints.length, 1);
    const broken = new GuideRunner({
        read: () => undefined,
        write: () => {
            throw Error('disk');
        },
    });
    await assert.rejects(broken.start({ ...definition, steps: [{ id: 'a', run: () => {} }] }, owner).result, /disk/);
    await owner.close();
});

test('引导：目标等待、注销、同名重新注册与虚拟条目代次隔离', async () => {
    const owner = new Scope('guide'),
        targets = new GuideTargets<object>(),
        waiter = owner.child('step');
    const pending = targets.wait('reward/42', waiter);
    assert.equal(targets.inspect().waiters, 1);
    const row = owner.child('row');
    const sharedNode = {};
    const unregister = targets.register('reward/42', sharedNode, row);
    const target = await pending;
    assert.equal(target.isCurrent(), true);
    assert.equal(targets.inspect().waiters, 0);
    assert.throws(() => targets.register('reward/42', {}, row), { code: 'GUIDE_TARGET_DUPLICATE' });
    unregister();
    assert.equal(target.scope.signal.aborted, true);
    targets.register('reward/42', sharedNode, row);
    assert.equal(target.isCurrent(), false);
    assert.equal(targets.get('reward/42')!.isCurrent(), true);
    const missing = targets.wait('missing', waiter);
    const checked = assert.rejects(missing, { code: 'OPERATION_CANCELLED' });
    await waiter.close();
    await checked;
    await row.close();
    assert.deepEqual(targets.inspect(), { targets: 0, waiters: 0 });
    await owner.close();
});

test('引导：版本变化重新开始，失效步骤拒绝恢复，取消前未运行业务', async () => {
    const owner = new Scope('guide');
    let ran = 0;
    const definition = {
        id: 'intro',
        version: 2,
        steps: [
            {
                id: 'new',
                run: () => {
                    ran++;
                },
            },
        ],
    };
    const runner = new GuideRunner({ read: () => ({ version: 1, status: 'completed' }), write: () => {} });
    const handle = runner.start(definition, owner);
    handle.cancel();
    assert.equal((await handle.result).status, 'cancelled');
    assert.equal(ran, 0);
    await runner.start(definition, owner).result;
    assert.equal(ran, 1);
    const invalid = new GuideRunner({
        read: () => ({ version: 2, status: 'running', nextStep: 'old' }),
        write: () => {},
    });
    assert.throws(() => invalid.start(definition, owner), { code: 'GUIDE_PROGRESS_INVALID' });
    await owner.close();
});

test('引导：Storage 持久化与账号隔离、重置及损坏错误', () => {
    const values = new Map<string, string>();
    const storage = new Storage('guide-test:', {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
        removeItem: (key) => {
            values.delete(key);
        },
    });
    const first = new StorageGuideProgress(storage.in('a')),
        second = new StorageGuideProgress(storage.in('b'));
    first.write('intro', { version: 1, status: 'running', nextStep: 'claim' });
    const storedKey = Array.from(values.keys())[0];
    assert.equal(first.read('intro')!.nextStep, 'claim');
    assert.equal(second.read('intro'), undefined);
    first.reset('intro');
    assert.equal(first.read('intro'), undefined);
    values.set(storedKey, 'invalid');
    assert.throws(() => first.read('intro'), { code: 'GUIDE_PROGRESS_INVALID' });
});

test('引导：启动时复制定义，外部修改不改变本次 ID、版本、步骤和跳过策略', async () => {
    const owner = new Scope('guide'),
        saved: { id: string; version: number }[] = [];
    const runner = new GuideRunner({
        read: () => undefined,
        write: (id, value) => saved.push({ id, version: value.version }),
    });
    const definition = {
        id: 'original',
        version: 1,
        allowSkip: true,
        steps: [{ id: 'step', run: (task: any) => untilCancelled(new Promise<void>(() => {}), task.signal) }],
    };
    const handle = runner.start(definition, owner);
    definition.id = 'changed';
    definition.version = 2;
    definition.allowSkip = false;
    definition.steps[0].id = 'changed-step';
    await flush();
    assert.deepEqual(handle.inspect(), { id: 'original', step: 'step', state: 'running' });
    handle.skip();
    assert.equal((await handle.result).status, 'skipped');
    assert.deepEqual(saved, [{ id: 'original', version: 1 }]);
    await owner.close();
});

test('引导：首次收拢时遮罩渐入，连续切换保持透明度且圆形平滑变为直角矩形', () => {
    const screen = { left: -360, bottom: -640, right: 360, top: 640 },
        target = { left: 20, bottom: -70, right: 180, top: 10 };
    const from = { hole: { rect: screen, radius: 0 }, shade: 0 };
    const rectangle = focusGeometry(target, 'rect', 0);
    assert.deepEqual(focusFrame(from, rectangle, 0), from);
    assert.deepEqual(focusFrame(from, rectangle, 1), { hole: rectangle, shade: 1 });
    let area = Infinity;
    for (let i = 0; i <= 100; i++) {
        const { hole, shade } = focusFrame(from, rectangle, i / 100);
        const next = (hole.rect.right - hole.rect.left) * (hole.rect.top - hole.rect.bottom);
        assert.ok(next <= area);
        assert.ok(shade >= 0 && shade <= 1);
        area = next;
    }
    assert.equal(intersectFocusRect(screen, { left: 500, right: 700, bottom: 0, top: 40 }), undefined);
    assert.deepEqual(intersectFocusRect(screen, target), target);
    const circle = focusGeometry({ left: -220, right: -180, bottom: 280, top: 320 }, 'circle', 0);
    const previous = { hole: circle, shade: 1 };
    assert.deepEqual(focusFrame(previous, rectangle, 0), previous);
    assert.deepEqual(focusFrame(previous, rectangle, 1), { hole: rectangle, shade: 1 });
    let last = circle.radius;
    for (let i = 0; i <= 100; i++) {
        const frame = focusFrame(previous, rectangle, i / 100);
        assert.equal(frame.shade, 1);
        assert.ok(frame.hole.radius <= last && frame.hole.radius >= 0);
        assert.ok(frame.hole.rect.right > frame.hole.rect.left && frame.hole.rect.top > frame.hole.rect.bottom);
        last = frame.hole.radius;
    }
});

test('引导：圆形与圆角命中真实形状，外接圆包住目标四角，矩形直角可点击', () => {
    const rect = { left: -30, right: 30, bottom: -40, top: 40 };
    const circle = focusGeometry(rect, 'circle', 0);
    assert.equal(circle.radius, 50);
    assert.equal(insideFocus(circle, 30, 40), true);
    assert.equal(insideFocus(circle, 49, 49), false);
    assert.equal(insideFocus(circle, 51, 0), false);
    const round = focusGeometry(rect, 'rounded-rect', 0, 100);
    assert.equal(round.radius, 30);
    assert.equal(insideFocus(round, 30, 40), false);
    assert.equal(insideFocus(round, 0, 40), true);
    assert.equal(insideFocus(focusGeometry(rect, 'rect', 0), 30, 40), true);
});
