import test from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../assets/framework/core/scope';
import { OperationCancelled } from '../assets/framework/core/errors';
import { freezeGameConfig, standaloneGameConfig } from '../assets/framework/platform/game-config';
import { GameSdk, type SdkAdapter } from '../assets/framework/platform/sdk';
import {
    createMiniGameSdkAdapter,
    createPlatformSdkAdapter,
    resolveSdkRuntime,
    type MiniGameSdkHost,
    type MiniGameVideo,
} from '../assets/framework/platform/sdk-adapters';

const settings = (overrides = {}) =>
    freezeGameConfig({
        ...standaloneGameConfig,
        ...overrides,
        sdk: {
            ...standaloneGameConfig.sdk,
            ads: { revive: 'ad-real' },
            share: { default: { title: '分享', imageUrl: 'a.png' } },
            timeoutMs: 50,
            ...(overrides as any).sdk,
        },
    });
const tick = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};
test('SDK：项目可登记新宿主，配置不伪造宿主，重复检测明确失败', async () => {
    const platforms = [
        {
            id: 'custom_host',
            isAvailable: () => true,
            create: () => ({
                id: 'custom-host',
                login: async () => ({
                    kind: 'channel' as const,
                    provider: 'custom',
                    userId: 'u',
                    token: 't',
                    simulated: false,
                }),
            }),
        },
    ];
    const runtime = resolveSdkRuntime({ platform: 'web', preview: false }, platforms);
    assert.equal(runtime.platform, 'custom_host');
    const config = settings({ platform: 'custom_host' });
    const owner = new Scope('custom-platform');
    const sdk = new GameSdk(config, runtime, owner, createPlatformSdkAdapter(config, runtime, platforms));
    await sdk.initialize();
    assert.equal((await sdk.auth.login(owner)).provider, 'custom');
    await owner.close();
    assert.throws(() => createPlatformSdkAdapter(config, { platform: 'web', preview: false }, platforms), {
        code: 'SDK_PLATFORM_MISMATCH',
    });
    assert.throws(() => resolveSdkRuntime(runtime, [...platforms, { ...platforms[0], id: 'another' }]), {
        code: 'SDK_PLATFORM_AMBIGUOUS',
    });
});
async function setup(adapter: SdkAdapter, config = settings()) {
    const owner = new Scope('sdk-test');
    const sdk = new GameSdk(config, { platform: 'web', preview: true }, owner, adapter);
    await sdk.initialize();
    return { owner, sdk };
}
function videoFixture() {
    const close = new Set<(value?: { isEnded?: boolean; count?: number }) => void>();
    const errors = new Set<(error: unknown) => void>();
    let shown = 0,
        destroyed = 0;
    const video: MiniGameVideo = {
        load: () => Promise.resolve(),
        show: () => {
            shown++;
            return Promise.resolve();
        },
        onClose: (fn) => {
            close.add(fn);
        },
        offClose: (fn) => {
            close.delete(fn);
        },
        onError: (fn) => {
            errors.add(fn);
        },
        offError: (fn) => {
            errors.delete(fn);
        },
        destroy: () => {
            destroyed++;
        },
    };
    return {
        video,
        close: (value?: { isEnded?: boolean; count?: number }) => {
            for (const fn of close) fn(value);
        },
        get shown() {
            return shown;
        },
        get destroyed() {
            return destroyed;
        },
        get listeners() {
            return close.size + errors.size;
        },
    };
}
test('SDK：微信/抖音临时凭证、匿名凭证、迟到回调和初始化幂等', async () => {
    for (const platform of ['wechat', 'douyin'] as const) {
        let force: boolean | undefined;
        const host: MiniGameSdkHost = {
            login: (options) => {
                force = options.force;
                options.success(platform === 'wechat' ? { code: 'wx-code' } : { anonymousCode: 'anonymous' });
                options.fail({ errCode: 999 });
            },
        };
        const { owner, sdk } = await setup(createMiniGameSdkAdapter(platform, host));
        await sdk.initialize();
        const value = await sdk.auth.login(owner);
        assert.equal(value.provider, platform);
        assert.equal(value.simulated, false);
        assert.equal(value.kind === 'platform' ? value.code : undefined, platform === 'wechat' ? 'wx-code' : undefined);
        assert.equal(force, platform === 'douyin' ? true : undefined);
        await owner.close();
    }
});
test('SDK：登录取消/超时迅速结束，迟到结果不会交付，Scope 可以关闭', async () => {
    let callbacks: any;
    const { owner, sdk } = await setup(
        createMiniGameSdkAdapter('wechat', {
            login: (value) => {
                callbacks = value;
            },
        }),
    );
    const page = owner.child('page');
    const result = sdk.auth.login(page);
    await tick();
    page.cancel();
    await assert.rejects(result, OperationCancelled);
    callbacks.success({ code: 'late-private-code' });
    await page.close();
    await assert.rejects(sdk.auth.login(owner), { code: 'SDK_TIMEOUT' });
    callbacks.success({ code: 'another-late-code' });
    await owner.close();
});
test('SDK：广告完整观看/提前关闭/未知结果与多次完成数量不混淆', async () => {
    const f = videoFixture();
    const { owner, sdk } = await setup(createMiniGameSdkAdapter('douyin', { createRewardedVideoAd: () => f.video }));
    for (const [input, status, count] of [
        [{ isEnded: true }, 'completed', 1],
        [{ isEnded: false, count: 2 }, 'skipped', 2],
        [undefined, 'unknown', 0],
    ] as const) {
        const pending = sdk.ads.showRewarded('revive', owner);
        await tick();
        f.close(input);
        const result = await pending;
        assert.equal(result.status, status);
        assert.equal(result.completedCount, count);
        assert.equal(f.listeners, 0);
    }
    assert.equal(f.destroyed, 3);
    await owner.close();
});
test('SDK：取消已展示广告只取消等待，直到真实关闭才释放并发锁', async () => {
    const f = videoFixture();
    const { owner, sdk } = await setup(createMiniGameSdkAdapter('wechat', { createRewardedVideoAd: () => f.video }));
    const page = owner.child('page');
    const result = sdk.ads.showRewarded('revive', page);
    await tick();
    assert.equal(f.shown, 1);
    page.cancel();
    await assert.rejects(result, OperationCancelled);
    await assert.rejects(sdk.ads.showRewarded('revive', owner), { code: 'SDK_BUSY' });
    assert.equal(f.destroyed, 0);
    f.close({ isEnded: true });
    await tick();
    assert.equal(sdk.inspect().videoBusy, false);
    assert.equal(f.listeners, 0);
    await owner.close();
});
test('SDK：加载阶段取消不再展示广告，App 关闭清理原生监听', async () => {
    const f = videoFixture();
    let finish!: () => void;
    f.video.load = () =>
        new Promise<void>((resolve) => {
            finish = resolve;
        });
    const { owner, sdk } = await setup(createMiniGameSdkAdapter('wechat', { createRewardedVideoAd: () => f.video }));
    const page = owner.child('page');
    const result = sdk.ads.showRewarded('revive', page);
    await tick();
    page.cancel();
    await assert.rejects(result, OperationCancelled);
    finish();
    await tick();
    assert.equal(f.shown, 0);
    assert.equal(f.destroyed, 1);
    await owner.close();
});
test('SDK：未配置广告位与缺失能力明确失败，分享只返回 invoked', async () => {
    const { owner, sdk } = await setup({ id: 'web' });
    assert.equal(sdk.capabilities.auth, false);
    await assert.rejects(sdk.auth.login(owner), { code: 'SDK_UNSUPPORTED' });
    await owner.close();
    let received: any;
    const mini = await setup(
        createMiniGameSdkAdapter('wechat', {
            createRewardedVideoAd: () => videoFixture().video,
            shareAppMessage: (options) => {
                received = options;
            },
        }),
    );
    await assert.rejects(mini.sdk.ads.showRewarded('missing', mini.owner), { code: 'SDK_NOT_CONFIGURED' });
    assert.equal((await mini.sdk.share.open('default', { x: 'a & 中文' }, mini.owner)).status, 'invoked');
    assert.equal(received.query, 'x=a%20%26%20%E4%B8%AD%E6%96%87');
    await mini.owner.close();
});
test('SDK：平台登录串联发行登录，广告独立接入；依赖按序初始化、逆序清理且只执行一次', async () => {
    const owner = new Scope('integration');
    const events: string[] = [];
    const platform: SdkAdapter = {
        id: 'wechat',
        initialize: async () => {
            events.push('platform.init');
        },
        dispose: () => {
            events.push('platform.dispose');
        },
        login: async () => {
            events.push('platform.login');
            return { kind: 'platform', provider: 'wechat', code: 'one-use-code', simulated: false };
        },
        share: async () => {
            events.push('platform.share');
            return { status: 'invoked', simulated: false };
        },
    };
    const sdk = new GameSdk(
        settings({ sdk: { integration: 'publisher' } }),
        { platform: 'wechat', preview: false },
        owner,
        platform,
        {
            publisher: ({ platform, use }) => {
                const publisher = use({
                    id: 'publisher',
                    initialize: async () => {
                        events.push('publisher.init');
                    },
                    dispose: () => {
                        events.push('publisher.dispose');
                    },
                    login: async (code: string) => {
                        assert.equal(code, 'one-use-code');
                        events.push('publisher.login');
                        return {
                            kind: 'channel' as const,
                            provider: 'publisher',
                            userId: 'p-123',
                            token: 'publisher-token',
                            simulated: false,
                        };
                    },
                });
                use(publisher);
                const ads = use({
                    id: 'ads',
                    initialize: async () => {
                        events.push('ads.init');
                    },
                    dispose: () => {
                        events.push('ads.dispose');
                    },
                    show: async (id: string) => {
                        assert.equal(id, 'ad-real');
                        events.push('ads.show');
                        return { status: 'completed' as const, completedCount: 1, simulated: false };
                    },
                });
                return {
                    id: 'wechat-publisher',
                    login: async (signal) => {
                        const credential = await platform.login!(signal);
                        signal.throwIfAborted();
                        if (credential.kind !== 'platform' || !credential.code) throw Error('missing code');
                        return publisher.login(credential.code);
                    },
                    rewardedVideo: (id) => ads.show(id),
                    share: platform.share?.bind(platform),
                };
            },
        },
    );
    await Promise.all([sdk.initialize(), sdk.initialize()]);
    const user = await sdk.auth.login(owner);
    assert.equal(user.kind, 'channel');
    assert.equal(user.provider, 'publisher');
    await sdk.ads.showRewarded('revive', owner);
    await sdk.share.open('default', {}, owner);
    await owner.close();
    assert.deepEqual(events, [
        'platform.init',
        'publisher.init',
        'ads.init',
        'platform.login',
        'publisher.login',
        'ads.show',
        'platform.share',
        'ads.dispose',
        'publisher.dispose',
        'platform.dispose',
    ]);
});

test('SDK：发行 SDK 已封装平台登录时不会额外调用平台登录', async () => {
    const owner = new Scope('wrapped');
    const sdk = new GameSdk(
        settings({ sdk: { integration: 'wrapped' } }),
        { platform: 'wechat', preview: false },
        owner,
        {
            id: 'wechat',
            login: () => {
                throw Error('must not login twice');
            },
        },
        {
            wrapped: () => ({
                id: 'wrapped',
                login: async () => ({
                    kind: 'channel',
                    provider: 'wrapped',
                    userId: '1',
                    token: 'token',
                    simulated: false,
                }),
            }),
        },
    );
    await sdk.initialize();
    assert.equal((await sdk.auth.login(owner)).kind, 'channel');
    await owner.close();
});

test('SDK：空拒绝原因仍然失败，初始化不会变 ready，后续调用不会变成功', async () => {
    for (const reason of [undefined, null, false, 0, '']) {
        const owner = new Scope('rejection');
        const sdk = new GameSdk(settings(), { platform: 'web', preview: true }, owner, {
            id: 'bad',
            initialize: () => Promise.reject(reason),
        });
        await assert.rejects(sdk.initialize(), (error) => error === reason);
        assert.equal(sdk.inspect().phase, 'failed');
        await owner.close();
        const live = await setup({ id: 'bad', login: () => Promise.reject(reason) });
        await assert.rejects(live.sdk.auth.login(live.owner), (error) => error === reason);
        await live.owner.close();
    }
});

test('SDK：初始化超时或取消后，等待底层完成再逆序销毁，不继续启动后续 SDK', async () => {
    for (const reason of ['timeout', 'cancel']) {
        const owner = new Scope('initialization-' + reason);
        const events: string[] = [];
        let resourceLive = false;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const sdk = new GameSdk(
            settings({ sdk: { integration: 'publisher', timeoutMs: 20 } }),
            { platform: 'web', preview: true },
            owner,
            {
                id: 'platform',
                async initialize(_config, signal) {
                    events.push('initializing');
                    await pending;
                    resourceLive = true;
                    events.push('initialized');
                    signal.throwIfAborted();
                },
                dispose() {
                    events.push('platform.dispose');
                    resourceLive = false;
                },
            },
            {
                publisher: () => ({
                    id: 'publisher',
                    initialize: async () => {
                        events.push('publisher.initialize');
                    },
                    dispose: () => {
                        events.push('publisher.dispose');
                    },
                }),
            },
        );
        const initialized = sdk.initialize();
        const rejected = assert.rejects(initialized, {
            code: reason === 'timeout' ? 'SDK_TIMEOUT' : 'OPERATION_CANCELLED',
        });
        await tick();
        if (reason === 'timeout') await rejected;
        const closing = owner.close();
        await rejected;
        await tick();
        assert.equal(owner.closed, false);
        assert.deepEqual(events, ['initializing']);
        release();
        await closing;
        assert.deepEqual(events, ['initializing', 'initialized', 'publisher.dispose', 'platform.dispose']);
        assert.equal(resourceLive, false);
        assert.equal(sdk.inspect().phase, 'closed');
    }
});

test('SDK：抖音异步销毁完成之前广告仍忙，关闭 App 等待销毁完成', async () => {
    const fixture = videoFixture();
    let release!: () => void;
    fixture.video.destroy = () =>
        new Promise<void>((resolve) => {
            release = resolve;
        });
    const { owner, sdk } = await setup(
        createMiniGameSdkAdapter('douyin', { createRewardedVideoAd: () => fixture.video }),
    );
    const ad = sdk.ads.showRewarded('revive', owner);
    const result = ad.then(
        (value) => value,
        (error) => error,
    );
    await tick();
    fixture.close({ isEnded: true });
    await tick();
    await assert.rejects(sdk.ads.showRewarded('revive', owner), { code: 'SDK_BUSY' });
    let ended = false;
    const closing = owner.close().then(() => {
        ended = true;
    });
    await tick();
    assert.equal(ended, false);
    release();
    await closing;
    await result;
    assert.equal(sdk.inspect().videoBusy, false);
});

test('SDK：广告销毁拒绝被处理，不能在残留实例之上创建下一个广告', async () => {
    const fixture = videoFixture();
    fixture.video.destroy = () => Promise.reject();
    const { owner, sdk } = await setup(
        createMiniGameSdkAdapter('douyin', { createRewardedVideoAd: () => fixture.video }),
    );
    const ad = sdk.ads.showRewarded('revive', owner);
    await tick();
    fixture.close({ isEnded: true });
    await assert.rejects(ad, { code: 'SDK_AD_CLEANUP_FAILED' });
    await assert.rejects(sdk.ads.showRewarded('revive', owner), { code: 'SDK_AD_CLEANUP_FAILED' });
    await assert.rejects(owner.close(), { code: 'SCOPE_CLEANUP_FAILED' });
});

test('SDK：关闭期间广告销毁失败传递到 Scope，所有监听清理均被尝试', async () => {
    const fixture = videoFixture();
    const releases: string[] = [];
    fixture.video.offClose = () => {
        releases.push('offClose');
        throw Error('offClose failed');
    };
    fixture.video.offError = () => {
        releases.push('offError');
    };
    fixture.video.destroy = async () => {
        releases.push('destroy');
        throw Error('destroy failed');
    };
    const { owner, sdk } = await setup(
        createMiniGameSdkAdapter('douyin', { createRewardedVideoAd: () => fixture.video }),
    );
    const ad = assert.rejects(sdk.ads.showRewarded('revive', owner), OperationCancelled);
    await tick();
    await assert.rejects(owner.close(), { code: 'SCOPE_CLEANUP_FAILED' });
    await ad;
    assert.deepEqual(releases, ['offClose', 'offError', 'destroy']);
    assert.equal(owner.closed, true);
});

test('SDK：微信短震动提供合法强度，抖音不传微信特有字段', async () => {
    for (const platform of ['wechat', 'douyin'] as const) {
        const { owner, sdk } = await setup(
            createMiniGameSdkAdapter(platform, {
                vibrateShort: (options) => {
                    assert.equal(options.type, platform === 'wechat' ? 'medium' : undefined);
                    options.success({});
                },
                vibrateLong: (options) => options.success({}),
            }),
        );
        await sdk.system.vibrate(owner);
        await owner.close();
    }
});
test('SDK：模拟只允许显式预览，默认广告跳过；Debug 不隐式启用模拟', async () => {
    const config = settings({ previewMockSdk: true });
    assert.throws(() => createPlatformSdkAdapter(config, { platform: 'web', preview: false }), {
        code: 'SDK_MOCK_BUILD',
    });
    const { owner, sdk } = await setup(createPlatformSdkAdapter(config, { platform: 'web', preview: true }), config);
    assert.equal((await sdk.ads.showRewarded('revive', owner)).status, 'skipped');
    sdk.simulation!.nextAd = 'completed';
    assert.equal((await sdk.ads.showRewarded('revive', owner)).simulated, true);
    assert.equal((await sdk.ads.showRewarded('revive', owner)).status, 'skipped');
    await owner.close();
    assert.equal(createPlatformSdkAdapter(settings(), { platform: 'web', preview: true }).simulation, undefined);
});

test('SDK：预览模拟覆盖发行接入，不初始化第三方 SDK', async () => {
    const owner = new Scope('mock-integration');
    const config = settings({ previewMockSdk: true, sdk: { integration: 'partner' } });
    const sdk = new GameSdk(
        config,
        { platform: 'web', preview: true },
        owner,
        createPlatformSdkAdapter(config, { platform: 'web', preview: true }),
        {
            partner: () => {
                throw Error('preview must not create real publisher');
            },
        },
    );
    await sdk.initialize();
    assert.equal((await sdk.auth.login(owner)).simulated, true);
    await owner.close();
});
test('SDK：前后台订阅由调用者期限清理，配置深冻结', async () => {
    const { owner, sdk } = await setup({ id: 'web', enter: () => ({ query: { from: 'resume' } }) });
    const page = owner.child('page');
    let count = 0;
    sdk.lifecycle.onShow((launch) => {
        assert.equal(launch.query.from, 'resume');
        count++;
    }, page);
    sdk.notifyVisibility(true);
    await page.close();
    sdk.notifyVisibility(true);
    assert.equal(count, 1);
    assert.throws(() => {
        (sdk.config.endpoints as any).apiBaseUrl = 'bad';
    }, TypeError);
    await owner.close();
});
