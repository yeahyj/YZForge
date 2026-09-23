import { CancellationSource, type CancellationSignal } from '../core/cancellation';
import { FrameworkError, OperationCancelled, reportError } from '../core/errors';
import { runTask, type Lifetime } from '../core/scope';
import type { GameConfig, GamePlatform, JsonValue, ShareTemplate } from './game-config';

/** SDK 的稳定错误分类；保留平台错误码，不携带登录 code 或业务令牌。 */
export class SdkError extends FrameworkError {
    constructor(code: string, message: string) {
        super(code, message);
        this.name = 'SdkError';
    }
}
/** 平台临时凭证；由业务通过自己的 HTTP 登录接口换取游戏会话。 */
export interface PlatformCredential {
    readonly kind: 'platform';
    readonly provider: string;
    readonly code?: string;
    readonly anonymousCode?: string;
    readonly simulated: boolean;
}
/** 发行方凭证；游戏服务端验证后才能建立游戏会话，不把 openid 当作令牌。 */
export interface ChannelCredential {
    readonly kind: 'channel';
    readonly provider: string;
    readonly userId: string;
    readonly token: string;
    readonly extra?: Readonly<Record<string, JsonValue>>;
    readonly simulated: boolean;
}
/** 统一登录结果允许平台临时凭证和发行方登录凭证。 */
export type SdkCredential = PlatformCredential | ChannelCredential;
/** 视频展示成功不代表完成；unknown 不能作为发奖依据。 */
export interface RewardedResult {
    readonly status: 'completed' | 'skipped' | 'unknown';
    readonly completedCount: number;
    readonly simulated: boolean;
}
/** 分享只承诺已发起；不将打开分享界面视为完成分享或满足发奖条件。 */
export interface ShareResult {
    readonly status: 'invoked';
    readonly simulated: boolean;
}
/** 已归一化的启动参数；保持平台 scene 和 query，不推断广告投放来源。 */
export interface LaunchInfo {
    readonly scene?: string | number;
    readonly query: Readonly<Record<string, string>>;
}
/** 实际宿主与目标渠道分别记录；预览不改变渠道配置。 */
export interface SdkRuntime {
    readonly platform: GamePlatform;
    readonly preview: boolean;
}
/** 预览模拟控制；每次调用消费一次结果，默认提前关闭，不自动发放奖励。 */
export interface SdkSimulation {
    nextAd: 'completed' | 'skipped' | 'error';
    failNextLogin: boolean;
}
/**
 * 平台/发行适配合同。未实现的方法通过 capabilities 显示为不可用。
 * 异步工作遵守 signal；已展示的原生广告保留监听直到真实关闭，不能假装被取消关闭。
 */
export interface SdkLifecycle {
    readonly id: string;
    initialize?(config: GameConfig, signal: CancellationSignal): Promise<void>;
    dispose?(): void | Promise<void>;
}
/** 能力对象只负责 SDK 调用；渠道接入实现可以组合多个这样的对象。 */
export interface SdkAdapter extends SdkLifecycle {
    readonly simulation?: SdkSimulation;
    login?(signal: CancellationSignal): Promise<SdkCredential>;
    rewardedVideo?(adUnitId: string, signal: CancellationSignal): Promise<RewardedResult>;
    share?(options: ShareTemplate & { readonly query: string }, signal: CancellationSignal): Promise<ShareResult>;
    vibrate?(kind: 'short' | 'long', signal: CancellationSignal): Promise<void>;
    setClipboard?(text: string, signal: CancellationSignal): Promise<void>;
    getClipboard?(signal: CancellationSignal): Promise<string>;
    launch?(): LaunchInfo;
    enter?(): LaunchInfo;
}
/** 工厂同步组装依赖；use 按登记顺序初始化、逆序清理，同一个实例只管理一次。 */
export interface SdkIntegrationContext {
    readonly config: GameConfig;
    readonly runtime: SdkRuntime;
    readonly platform: SdkAdapter;
    use<T extends SdkLifecycle>(adapter: T): T;
}
/** 只登记接入代码；JSON 选择实现并提供参数，调用顺序在 TypeScript 中明确编排。 */
export type SdkIntegrationFactory = (context: SdkIntegrationContext) => SdkAdapter;
const emptyLaunch = (): LaunchInfo => Object.freeze({ query: Object.freeze({}) });

/** 统一 SDK 入口；不缓存游戏账号、不改存档前缀、不执行发奖业务。 */
export class GameSdk {
    readonly capabilities: Readonly<{
        auth: boolean;
        rewardedVideo: boolean;
        share: boolean;
        vibrate: boolean;
        clipboardRead: boolean;
        clipboardWrite: boolean;
    }>;
    readonly simulation?: SdkSimulation;
    private readonly adapter: SdkAdapter;
    private readonly adapters: readonly SdkLifecycle[];
    private initialization?: Promise<void>;
    private phase: 'idle' | 'starting' | 'ready' | 'failed' | 'closed' = 'idle';
    private videoBusy = false;
    private readonly showListeners = new Set<(launch: LaunchInfo) => void>();
    private readonly hideListeners = new Set<() => void>();

    /** 取得当前接入的登录凭证；调用顺序由渠道实现决定，不隐式重复平台登录。 */
    readonly auth = {
        login: (owner: Lifetime): Promise<SdkCredential> =>
            this.invoke(owner, (signal) => {
                if (!this.adapter.login) throw this.unsupported('登录');
                return this.adapter.login(signal);
            }),
    };
    /** 逻辑广告位由 JSON 映射为当前渠道的实际广告位 ID。 */
    readonly ads = {
        showRewarded: (placement: string, owner: Lifetime): Promise<RewardedResult> =>
            this.invoke(
                owner,
                (signal) => {
                    const adapter = this.adapter;
                    if (!adapter.rewardedVideo) throw this.unsupported('激励视频');
                    if (this.videoBusy) throw new SdkError('SDK_BUSY', '已有激励视频正在加载或展示');
                    const adUnitId = Object.prototype.hasOwnProperty.call(this.config.sdk.ads, placement)
                        ? this.config.sdk.ads[placement]
                        : '';
                    if (!adUnitId && !adapter.simulation)
                        throw new SdkError('SDK_NOT_CONFIGURED', `广告位未配置：${placement}`);
                    this.videoBusy = true;
                    try {
                        // 调用方取消/超时后也等平台真实结束才解锁，避免两段原生广告重叠。
                        return adapter.rewardedVideo(adUnitId, signal).finally(() => {
                            this.videoBusy = false;
                        });
                    } catch (error) {
                        this.videoBusy = false;
                        throw error;
                    }
                },
                Math.max(180000, this.config.sdk.timeoutMs),
            ),
    };
    /** 使用配置中的分享模板；动态参数由调用方传入。 */
    readonly share = {
        open: (template: string, query: Readonly<Record<string, string>>, owner: Lifetime): Promise<ShareResult> =>
            this.invoke(owner, (signal) => {
                const adapter = this.adapter;
                if (!adapter.share) throw this.unsupported('分享');
                const content = Object.prototype.hasOwnProperty.call(this.config.sdk.share, template)
                    ? this.config.sdk.share[template]
                    : undefined;
                if (!content) throw new SdkError('SDK_NOT_CONFIGURED', `分享模板未配置：${template}`);
                const encoded = Object.entries(query)
                    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                    .join('&');
                return adapter.share({ ...content, query: encoded }, signal);
            }),
    };
    /** 系统调用仍需传入实际使用者的 Scope。 */
    readonly system = {
        vibrate: (owner: Lifetime, kind: 'short' | 'long' = 'short'): Promise<void> =>
            this.invoke(owner, (signal) => {
                const adapter = this.adapter;
                if (!adapter.vibrate) throw this.unsupported('震动');
                return adapter.vibrate(kind, signal);
            }),
        setClipboard: (text: string, owner: Lifetime): Promise<void> =>
            this.invoke(owner, (signal) => {
                const adapter = this.adapter;
                if (!adapter.setClipboard) throw this.unsupported('写入剪贴板');
                return adapter.setClipboard(text, signal);
            }),
        getClipboard: (owner: Lifetime): Promise<string> =>
            this.invoke(owner, (signal) => {
                const adapter = this.adapter;
                if (!adapter.getClipboard) throw this.unsupported('读取剪贴板');
                return adapter.getClipboard(signal);
            }),
    };
    /** 复用 App 的引擎前后台事件；监听随调用方 Scope 结束自动清理。 */
    readonly lifecycle = {
        getLaunchOptions: (): LaunchInfo => this.platformAdapter.launch?.() ?? emptyLaunch(),
        onShow: (callback: (launch: LaunchInfo) => void, owner: Lifetime): (() => void) =>
            this.subscribe(this.showListeners, callback, owner),
        onHide: (callback: () => void, owner: Lifetime): (() => void) =>
            this.subscribe(this.hideListeners, callback, owner),
    };

    constructor(
        readonly config: GameConfig,
        readonly runtime: SdkRuntime,
        private readonly owner: Lifetime,
        private readonly platformAdapter: SdkAdapter,
        integrations: Readonly<Record<string, SdkIntegrationFactory>> = {},
    ) {
        const instances = new Set<SdkLifecycle>([platformAdapter]);
        // 先登记收尾，保证发行工厂或配置解析失败时已创建的适配器也能回收。
        owner.defer(async () => {
            this.phase = 'closed';
            this.showListeners.clear();
            this.hideListeners.clear();
            let failed = 0;
            for (const adapter of Array.from(instances).reverse()) {
                try {
                    await adapter.dispose?.();
                } catch {
                    failed++;
                }
            }
            if (failed) throw new SdkError('SDK_CLEANUP_FAILED', `${failed} 个 SDK 适配器清理失败`);
        });
        // 显式预览模拟覆盖整套接入，不初始化真实发行/广告 SDK。
        const id = runtime.preview && config.previewMockSdk ? 'platform' : config.sdk.integration;
        let assembling = true;
        try {
            if (id !== 'platform' && !Object.prototype.hasOwnProperty.call(integrations, id))
                throw new SdkError('SDK_INTEGRATION_MISSING', `渠道接入实现未登记：${id}`);
            this.adapter =
                id === 'platform'
                    ? platformAdapter
                    : integrations[id]({
                          config,
                          runtime,
                          platform: platformAdapter,
                          use: <T extends SdkLifecycle>(adapter: T): T => {
                              if (!assembling) throw new SdkError('SDK_ASSEMBLY_CLOSED', '请在工厂返回前登记 SDK 依赖');
                              instances.add(adapter);
                              return adapter;
                          },
                      });
            instances.add(this.adapter);
        } finally {
            assembling = false;
        }
        this.adapters = Array.from(instances);
        this.simulation = this.adapter.simulation;
        this.capabilities = Object.freeze({
            auth: !!this.adapter.login,
            rewardedVideo:
                !!this.adapter.rewardedVideo &&
                (!!this.adapter.simulation || Object.values(config.sdk.ads).some(Boolean)),
            share: !!this.adapter.share && Object.keys(config.sdk.share).length > 0,
            vibrate: !!this.adapter.vibrate,
            clipboardRead: !!this.adapter.getClipboard,
            clipboardWrite: !!this.adapter.setClipboard,
        });
    }
    /** App.create 在进入业务启动前执行；同一次 App 只初始化一次，失败由 App 回收后重建。 */
    initialize(): Promise<void> {
        if (this.initialization) return this.initialization;
        this.phase = 'starting';
        this.initialization = this.wait(
            this.owner,
            (signal) =>
                // 超时只结束调用者的等待；底层初始化仍持有 SDK，完成后才允许 dispose。
                runTask(
                    this.owner,
                    async () => {
                        for (const adapter of this.adapters) {
                            signal.throwIfAborted();
                            await adapter.initialize?.(this.config, signal);
                            signal.throwIfAborted();
                        }
                    },
                    undefined,
                    'sdk.initialize',
                ),
            this.config.sdk.timeoutMs,
        ).then(
            () => {
                if (this.phase !== 'closed') this.phase = 'ready';
            },
            (error) => {
                if (this.phase !== 'closed') this.phase = 'failed';
                throw error;
            },
        );
        return this.initialization;
    }
    /** @internal 由 App 唯一的前后台事件桥转发。 */
    notifyVisibility(visible: boolean): void {
        if (this.phase !== 'ready') return;
        const launch = visible ? (this.platformAdapter.enter?.() ?? this.lifecycle.getLaunchOptions()) : undefined;
        for (const callback of visible ? Array.from(this.showListeners) : Array.from(this.hideListeners)) {
            try {
                (callback as (info?: LaunchInfo) => void)(launch);
            } catch (error) {
                reportError(error);
            }
        }
    }
    /** 只读运行摘要，不包含凭证、服务端令牌或 SDK 私有对象。 */
    inspect() {
        return Object.freeze({
            phase: this.phase,
            integration: this.config.sdk.integration,
            targetPlatform: this.config.platform,
            runtime: this.runtime,
            capabilities: this.capabilities,
            simulated: !!this.simulation,
            videoBusy: this.videoBusy,
        });
    }
    private unsupported(feature: string): SdkError {
        return new SdkError('SDK_UNSUPPORTED', `当前 SDK 不支持${feature}`);
    }
    private invoke<T>(
        owner: Lifetime,
        action: (signal: CancellationSignal) => Promise<T>,
        timeoutMs = this.config.sdk.timeoutMs,
    ): Promise<T> {
        return runTask(
            owner,
            () => {
                if (this.phase !== 'ready') throw new SdkError('SDK_NOT_READY', 'SDK 尚未完成初始化');
                return this.wait(owner, action, timeoutMs);
            },
            undefined,
            'sdk',
        );
    }
    private wait<T>(
        owner: Lifetime,
        action: (signal: CancellationSignal) => Promise<T>,
        timeoutMs: number,
    ): Promise<T> {
        owner.signal.throwIfAborted();
        this.owner.signal.throwIfAborted();
        return new Promise<T>((resolve, reject) => {
            const operation = new CancellationSource();
            let done = false;
            let detachOwner = () => {},
                detachApp = () => {};
            const timer = setTimeout(() => finish(false, new SdkError('SDK_TIMEOUT', 'SDK 调用超时')), timeoutMs);
            const finish = (success: boolean, result: unknown) => {
                if (done) return;
                done = true;
                if (!success)
                    operation.cancel(
                        result instanceof OperationCancelled ? result : new OperationCancelled('SDK 调用结束'),
                    );
                clearTimeout(timer);
                detachOwner();
                detachApp();
                if (success) resolve(result as T);
                else reject(result);
            };
            detachOwner = owner.signal.onAbort((reason) => finish(false, reason));
            detachApp = this.owner.signal.onAbort((reason) => finish(false, reason));
            if (done) {
                detachOwner();
                detachApp();
                return;
            }
            try {
                void action(operation.signal).then(
                    (value) => finish(true, value),
                    (error: unknown) => finish(false, error),
                );
            } catch (error) {
                finish(false, error);
            }
        });
    }
    private subscribe<T>(listeners: Set<T>, callback: T, owner: Lifetime): () => void {
        owner.signal.throwIfAborted();
        this.owner.signal.throwIfAborted();
        listeners.add(callback);
        let detach = () => {};
        const remove = () => {
            listeners.delete(callback);
            detach();
        };
        detach = owner.signal.onAbort(remove);
        return remove;
    }
}
