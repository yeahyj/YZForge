import test from 'node:test';
import assert from 'node:assert/strict';
import { Scope, taskContext } from '../../assets/framework/core/scope';
import { Actions } from '../../assets/framework/core/actions';
import { Events } from '../../assets/framework/core/events';
import { TimeService } from '../../assets/framework/time/time-service';
import { Storage } from '../../assets/framework/platform/storage';
import type { App } from '../../assets/framework/core/app';
import { ShowcaseNavigation } from '../../assets/game/app/showcase-navigation';
import { WalletService } from '../../assets/game/modules/profile/code/services/WalletService';
import { TaskService } from '../../assets/game/modules/workshop/code/services/TaskService';
import { WorkflowPagePresenter } from '../../assets/game/modules/workshop/code/ui/WorkflowPagePresenter';
import { LabClock } from '../../assets/game/modules/showcase/code/services/LabClock';
import { StorageLab, LabWallet, LabStorageBackend } from '../../assets/game/modules/showcase/code/services/StorageLab';
import type { ModuleContext } from '../../assets/framework/modules/module-manager';
import type { ProfileApi } from '../../assets/game/modules/profile/public';
import type { TasksRow } from '../../assets/game/modules/workshop/contracts/generated/config/Tasks.types';
import type { UIManager, ViewResult } from '../../assets/framework/ui/ui-manager';
import type { ViewShowContext } from '../../assets/framework/ui/ui-view';
import type { WorkflowPageParams } from '../../assets/game/modules/workshop/code/ui/WorkflowPage.types';
import { flush, deferred } from '../fake-clock';
const row: TasksRow = { id: 1, name: '初次训练', goal: 1, reward: 20, quality: 'normal', economy: 1 };
async function setup() {
    const scope = new Scope('example-test');
    const backend = new LabStorageBackend();
    const storage = new Storage('test:', backend);
    const ctx = {
        scope: scope.lifetime,
        storage,
        events: new Events(),
        config: {
            in: () => ({
                loadMany: async () => ({ tasks: { all: () => [row] }, economy: { require: () => ({ id: 1 }) } }),
            }),
        },
    } as unknown as ModuleContext;
    const wallet = new WalletService(ctx);
    const profile: ProfileApi = {
        moduleId: 'profile',
        snapshot: () => wallet.snapshot(),
        changeCoins: (n) => wallet.changeCoins(n),
        claimReward: (id, amount) => wallet.claimReward(id, amount),
        hasReward: (id) => wallet.hasReward(id),
        subscribe: (callback, owner) => wallet.subscribe(callback, owner),
    };
    const tasks = new TaskService(ctx, profile);
    await tasks.load(scope);
    return { scope, backend, storage, ctx, wallet, tasks };
}

test('navigation keeps the first destination during a slow open and uses the application owner', async () => {
    const owner = new Scope('navigation');
    const previousPage = owner.child('previous-page');
    const opened = deferred();
    const calls: string[] = [];
    const app = {
        ui: {
            pushPage: async (key: { id: string }, _params: unknown, lifetime: unknown) => {
                assert.equal(lifetime, owner.lifetime);
                calls.push(key.id);
                if (calls.length === 1) await opened.promise;
            },
        },
    } as unknown as App;
    const navigation = new ShowcaseNavigation(app, owner.lifetime);
    try {
        const first = navigation.open('data');
        const repeated = navigation.open('time');
        await flush();
        assert.deepEqual(calls, ['showcase.data-lab-page']);
        await previousPage.close();
        assert.equal(owner.signal.aborted, false, 'new page must outlive the previous show');
        opened.resolve();
        await Promise.all([first, repeated]);
        await navigation.open('workflow');
        assert.deepEqual(calls, ['showcase.data-lab-page', 'workshop.workflow-page']);
    } finally {
        opened.resolve();
        await owner.close();
    }
});

test('failed navigation reports the same failure to joined callers and allows an explicit retry', async () => {
    const owner = new Scope('navigation-retry');
    let calls = 0;
    const failure = Error('Page preparation failed');
    const app = {
        ui: {
            pushPage: async () => {
                if (++calls === 1) throw failure;
            },
        },
    } as unknown as App;
    const navigation = new ShowcaseNavigation(app, owner.lifetime);
    try {
        const results = await Promise.allSettled([navigation.open('data'), navigation.open('time')]);
        assert.equal(calls, 1);
        for (const result of results) {
            assert.equal(result.status, 'rejected');
            if (result.status === 'rejected') assert.equal(result.reason, failure);
        }
        await navigation.open('data');
        assert.equal(calls, 2);
    } finally {
        await owner.close();
    }
});

test('task domain rejects incomplete commands and persists reward deduplication across service recreation', async () => {
    const s = await setup();
    try {
        assert.throws(() => s.tasks.claim(999), { code: 'DEMO_TASK_UNKNOWN' });
        assert.throws(() => s.tasks.claim(row.id), { code: 'DEMO_TASK_LOCKED' });
        s.tasks.train();
        assert.equal(s.tasks.claim(row.id), true);
        assert.equal(s.tasks.claim(row.id), false);
        assert.equal(s.wallet.snapshot().coins, 20);
        const recreated = new WalletService(s.ctx);
        assert.equal(recreated.claimReward('workshop/task/1', 20), false);
        assert.equal(recreated.snapshot().coins, 20);
        assert.equal(s.tasks.cards([row])[0].state, 'claimed');
    } finally {
        await s.scope.close();
    }
});

test('failed reward write changes neither balance nor idempotency record, and retry grants exactly once', async () => {
    const s = await setup();
    try {
        s.tasks.train();
        s.backend.failKey = 'test:profile.wallet';
        assert.throws(() => s.tasks.claim(row.id), { code: 'STORAGE_WRITE_FAILED' });
        assert.equal(s.wallet.snapshot().coins, 0);
        assert.equal(s.wallet.hasReward('workshop/task/1'), false);
        s.backend.failKey = '';
        assert.equal(s.tasks.claim(row.id), true);
        assert.equal(s.tasks.claim(row.id), false);
        assert.equal(s.wallet.snapshot().coins, 20);
    } finally {
        await s.scope.close();
    }
});

test('simulated domain failure and training write failure leave old state unchanged', async () => {
    const s = await setup();
    try {
        s.backend.failKey = 'test:workshop.progress';
        assert.throws(() => s.tasks.train(), { code: 'STORAGE_WRITE_FAILED' });
        assert.equal(s.tasks.snapshot().progress, 0);
        s.backend.failKey = '';
        s.tasks.train();
        s.tasks.simulateFailure();
        assert.throws(() => s.tasks.claim(row.id), /模拟请求失败/);
        assert.equal(s.wallet.snapshot().coins, 0);
        assert.equal(s.tasks.claim(row.id), true);
    } finally {
        await s.scope.close();
    }
});

test('Presenter waits for confirmation, ignores duplicate clicks, and renders through a node-free port', async () => {
    const s = await setup();
    const showScope = s.scope.child('show');
    const answer = deferred<ViewResult<boolean>>();
    let opens = 0,
        renders = 0;
    const ui = {
        open: async () => {
            opens++;
            return { result: answer.promise };
        },
    } as unknown as UIManager;
    const show = { ...taskContext(showScope), actions: new Actions(showScope) } as ViewShowContext<
        WorkflowPageParams,
        void
    >;
    const presenter = new WorkflowPagePresenter(s.tasks, ui, show, {
        mount: async (cards) => {
            assert.equal(cards.length, 1);
        },
        render: () => {
            renders++;
        },
    });
    try {
        await presenter.start();
        presenter.train();
        const first = presenter.claim(1),
            repeated = presenter.claim(1);
        await flush();
        assert.equal(opens, 1);
        assert.equal(s.wallet.snapshot().coins, 0);
        answer.resolve({ status: 'completed', value: true });
        await Promise.all([first, repeated]);
        await flush();
        assert.equal(s.wallet.snapshot().coins, 20);
        assert.ok(renders >= 3);
        await showScope.close();
        const count = renders;
        s.tasks.train();
        await flush();
        assert.equal(renders, count, 'ended show must not receive business event rendering');
    } finally {
        await s.scope.close();
    }
});

test('Presenter observes external wallet and claim changes and stops both subscriptions with its show', async () => {
    const s = await setup();
    const showScope = s.scope.child('observed-show');
    const show = { ...taskContext(showScope), actions: new Actions(showScope) } as ViewShowContext<
        WorkflowPageParams,
        void
    >;
    let summary = '',
        cardState = '',
        renders = 0;
    const presenter = new WorkflowPagePresenter(s.tasks, {} as UIManager, show, {
        mount: async () => {},
        render: (cards, text) => {
            summary = text;
            cardState = cards[0].state;
            renders++;
        },
    });
    try {
        await presenter.start();
        s.tasks.train();
        await flush();
        assert.equal(cardState, 'ready');
        s.wallet.changeCoins(7);
        await flush();
        assert.match(summary, /余额 7 金币/);
        s.wallet.claimReward('workshop/task/1', 20);
        await flush();
        assert.match(summary, /余额 27 金币/);
        assert.equal(cardState, 'claimed');
        await showScope.close();
        const before = renders;
        s.wallet.changeCoins(3);
        s.tasks.train();
        await flush();
        assert.equal(renders, before);
    } finally {
        await s.scope.close();
    }
});

test('task observer removes both sources on unsubscribe or initial callback failure', async () => {
    const s = await setup();
    try {
        let failedCalls = 0;
        assert.throws(() =>
            s.tasks.subscribe(() => {
                failedCalls++;
                throw Error('Initial render failed');
            }, s.scope),
        );
        s.tasks.train();
        s.wallet.changeCoins(1);
        await flush();
        assert.equal(failedCalls, 1, 'failed registration must not leave either source subscribed');
        let calls = 0;
        const off = s.tasks.subscribe(() => calls++, s.scope);
        assert.equal(calls, 1, 'deliver current state immediately');
        s.tasks.train(); // Event delivery has been queued but has not run yet.
        off();
        off();
        s.wallet.changeCoins(1);
        await flush();
        assert.equal(calls, 1, 'unsubscribe must also suppress queued notifications');
    } finally {
        await s.scope.close();
    }
});

test('cancelling confirmation leaves progress and wallet unchanged', async () => {
    const s = await setup();
    const show = { ...taskContext(s.scope), actions: new Actions(s.scope) } as ViewShowContext<
        WorkflowPageParams,
        void
    >;
    const ui = { open: async () => ({ result: Promise.resolve({ status: 'cancelled' }) }) } as unknown as UIManager;
    const presenter = new WorkflowPagePresenter(s.tasks, ui, show, { mount: async () => {}, render: () => {} });
    try {
        await presenter.start();
        presenter.train();
        await presenter.claim(1);
        assert.deepEqual(s.tasks.snapshot(), { progress: 1, coins: 0 });
        assert.equal(s.wallet.hasReward('workshop/task/1'), false);
    } finally {
        await s.scope.close();
    }
});

test('failed confirmation is reported distinctly and never commits a reward', async () => {
    const s = await setup();
    const show = { ...taskContext(s.scope), actions: new Actions(s.scope) } as ViewShowContext<
        WorkflowPageParams,
        void
    >;
    const ui = {
        open: async () => ({
            result: Promise.resolve({ status: 'failed', error: Error('UI fault'), cleanupPending: false }),
        }),
    } as unknown as UIManager;
    let summary = '';
    const presenter = new WorkflowPagePresenter(s.tasks, ui, show, {
        mount: async () => {},
        render: (_cards, text) => {
            summary = text;
        },
    });
    try {
        await presenter.start();
        presenter.train();
        await presenter.claim(1);
        assert.equal(s.wallet.snapshot().coins, 0);
        assert.match(summary, /确认界面失败，未提交领取/);
    } finally {
        await s.scope.close();
    }
});

test('calendar lab merges background periods and releases all injected driver callbacks', async () => {
    const scope = new Scope('lab-time'),
        clock = new LabClock();
    const time = new TimeService(clock, scope, { calendar: { offsetMinutes: 480, resetMinute: 240 } });
    const events: { reason: string; missedCount: number | null }[] = [];
    time.in(scope).onBoundary('day', (event) => {
        events.push(event);
    });
    await flush();
    clock.setBackground(true);
    clock.advance(3 * 86400000);
    await flush();
    assert.equal(events.length, 0);
    clock.setBackground(false);
    await flush();
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, 'resume');
    assert.equal(events[0].missedCount, 2);
    clock.rewindDay();
    await flush();
    assert.equal(events.length, 1);
    await scope.close();
    assert.deepEqual(clock.inspect(), { timers: 0, listeners: 0 });
});

test('storage lab corruption, failed writes, upgrades and future saves use actual Storage behavior', () => {
    const lab = new StorageLab();
    assert.match(lab.corrupt(), /recovered/);
    assert.equal(lab.storage.read(LabWallet).value?.coins, 10);
    assert.match(lab.failWrite(), /失败后余额仍为 10/);
    assert.equal(lab.storage.get(LabWallet)?.coins, 10);
    assert.match(lab.upgrade(), /migrated/);
    assert.equal(lab.storage.get(LabWallet)?.coins, 30);
    assert.match(lab.future(), /incompatible/);
    assert.equal(JSON.parse(lab.backend.values.get('showcase:wallet')!).version, 99);
});
