import test from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../assets/framework/core/scope';
import { AsyncButtonController } from '../assets/framework/ui/components/async-button/async-button-controller';
import { marqueeOffset } from '../assets/framework/ui/components/marquee/marquee-motion';
import { countdownSeconds, formatCountdown } from '../assets/framework/ui/components/countdown/countdown';
import {
    SafeEdge,
    SafeSymmetry,
    safeWidgetOffsets,
    symmetricSafeRect,
} from '../assets/framework/ui/components/safe-widget/safe-widget-layout';
import { deferred, flush } from './fake-clock';

test('异步按钮覆盖业务执行和异步清理的整个忙碌期', async () => {
    const owner = new Scope('button'),
        work = deferred(),
        cleanup = deferred();
    const changes: boolean[] = [];
    let calls = 0;
    const button = new AsyncButtonController(
        owner,
        async (task) => {
            calls++;
            task.scope.defer(() => cleanup.promise);
            await work.promise;
        },
        (busy) => changes.push(busy),
    );
    const pressing = button.press();
    assert.equal(await button.press(), false);
    await flush();
    assert.equal(calls, 1);
    work.resolve();
    await flush();
    assert.equal(await button.press(), false);
    assert.deepEqual(changes, [true]);
    cleanup.resolve();
    assert.equal(await pressing, true);
    assert.deepEqual(changes, [true, false]);
    await owner.close();
});

test('异步按钮失败后恢复；宿主取消阻止旧提交并等待任务退出', async () => {
    const owner = new Scope('button'),
        gate = deferred();
    let first = true,
        writes = 0;
    const failure = new Error('request failed');
    const button = new AsyncButtonController(
        owner,
        async (task) => {
            if (first) {
                first = false;
                throw failure;
            }
            await gate.promise;
            task.commit(() => writes++);
        },
        () => {},
    );
    await assert.rejects(button.press(), (error) => error === failure);
    const pending = button.press();
    const rejection = assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
    await flush();
    let closed = false;
    const closing = owner.close().then(() => {
        closed = true;
    });
    await flush();
    assert.equal(closed, false);
    gate.resolve();
    await Promise.all([closing, rejection]);
    assert.equal(writes, 0);
});

test('滚动文本：短文本静止，首尾停留，平滑往返，大帧间隔不越界', () => {
    assert.equal(marqueeOffset(50, 0, 40, 1), 0);
    assert.equal(marqueeOffset(2, 100, 0, 1), 0);
    assert.equal(marqueeOffset(0.5, 100, 50, 1), 0);
    assert.equal(marqueeOffset(2, 100, 50, 1), -50);
    assert.equal(marqueeOffset(3.5, 100, 50, 1), -100);
    assert.equal(marqueeOffset(5, 100, 50, 1), -50);
    assert.equal(marqueeOffset(6, 100, 50, 1), 0);
    assert.equal(marqueeOffset(6000002, 100, 50, 1), -50);
    assert.throws(() => marqueeOffset(Infinity, 100, 50, 1), RangeError);
});

const full = { left: 0, right: 720, bottom: 0, top: 1280 };
const safe = { left: 20, right: 710, bottom: 30, top: 1190 };
const base = { top: 12, bottom: 13, left: 14, right: 15 };
const absolute = { top: true, bottom: true, left: true, right: true };

test('安全区按选择边叠加基础边距，重复计算不累积', () => {
    const expected = { top: 102, bottom: 13, left: 34, right: 15 };
    for (let i = 0; i < 10; i++)
        assert.deepEqual(safeWidgetOffsets(full, safe, base, absolute, SafeEdge.Top | SafeEdge.Left), expected);
    assert.deepEqual(base, { top: 12, bottom: 13, left: 14, right: 15 });
});

test('安全区百分比依据目标尺寸换算，嵌套安全容器不再次缩进', () => {
    const unitBase = { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 };
    const offsets = safeWidgetOffsets(
        full,
        safe,
        unitBase,
        { top: false, bottom: false, left: false, right: false },
        SafeEdge.All,
    );
    assert.equal(offsets.top, 0.1 + 90 / 1280);
    assert.equal(offsets.left, 0.1 + 20 / 720);
    assert.deepEqual(safeWidgetOffsets(safe, safe, base, absolute, SafeEdge.All), base);
    const local = { left: -200, right: 200, bottom: -300, top: 300 };
    assert.deepEqual(safeWidgetOffsets(local, { ...local, top: 260 }, base, absolute, SafeEdge.All), {
        ...base,
        top: 52,
    });
});

test('安全区对称可选，默认保留上下不对称，横屏只对称左右', () => {
    assert.deepEqual(symmetricSafeRect(full, safe, SafeSymmetry.None), safe);
    assert.deepEqual(symmetricSafeRect(full, safe, SafeSymmetry.LandscapeSides), safe);
    assert.deepEqual(symmetricSafeRect(full, safe, SafeSymmetry.BothAxes), {
        left: 20,
        right: 700,
        bottom: 90,
        top: 1190,
    });
    assert.deepEqual(
        symmetricSafeRect(
            { left: 0, right: 1280, bottom: 0, top: 720 },
            { left: 100, right: 1250, bottom: 20, top: 720 },
            SafeSymmetry.LandscapeSides,
        ),
        { left: 100, right: 1180, bottom: 20, top: 720 },
    );
});

test('安全区拒绝无效矩形、超界参考节点、NaN 边距与非法位掩码', () => {
    assert.throws(() => symmetricSafeRect(full, { ...safe, top: NaN }, SafeSymmetry.None), {
        code: 'SAFE_WIDGET_RECT',
    });
    assert.throws(
        () => safeWidgetOffsets({ left: 0, right: 10, bottom: 0, top: 10 }, safe, base, absolute, SafeEdge.All),
        { code: 'SAFE_WIDGET_OUTSIDE' },
    );
    assert.throws(() => safeWidgetOffsets(full, safe, { ...base, top: NaN }, absolute, SafeEdge.All), {
        code: 'SAFE_WIDGET_OFFSETS',
    });
    assert.throws(() => safeWidgetOffsets(full, safe, base, absolute, 16), { code: 'SAFE_WIDGET_OFFSETS' });
});

test('倒计时由绝对时间计算，跳时恢复无逐帧累积误差', () => {
    assert.equal(countdownSeconds(5000, 0), 5);
    assert.equal(countdownSeconds(5000, 4001), 1);
    assert.equal(countdownSeconds(5000, 5000), 0);
    assert.equal(countdownSeconds(5000, 9000), 0);
    assert.equal(countdownSeconds(5000, 2000), 3);
    assert.equal(formatCountdown(90061), '25:01:01');
    assert.equal(formatCountdown(0), '00:00:00');
    assert.throws(() => countdownSeconds(NaN, 0));
    assert.throws(() => countdownSeconds(1, Infinity));
    assert.throws(() => formatCountdown(-1));
    assert.throws(() => formatCountdown(1.5));
});
