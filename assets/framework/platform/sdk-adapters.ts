import type { CancellationSignal } from '../core/cancellation';
import { OperationCancelled } from '../core/errors';
import type { GameConfig } from './game-config';
import {
    SdkError,
    type LaunchInfo,
    type PlatformCredential,
    type RewardedResult,
    type SdkAdapter,
    type SdkRuntime,
    type SdkSimulation,
} from './sdk';

/** 新宿主在项目中登记检测与适配工厂；检测实际能力，不能仅凭配置假定当前平台。 */
export interface SdkPlatformRegistration {
    readonly id: string;
    isAvailable(): boolean;
    create(config: GameConfig, runtime: SdkRuntime): SdkAdapter;
}
/** 多个自定义宿主同时命中视为接入错误，避免由登记顺序决定身份。 */
export function resolveSdkRuntime(
    fallback: SdkRuntime,
    platforms: readonly SdkPlatformRegistration[] = [],
): SdkRuntime {
    const ids = new Set<string>();
    for (const platform of platforms) {
        if (!/^[a-z][a-z0-9_-]*$/.test(platform.id) || ids.has(platform.id))
            throw new SdkError('SDK_PLATFORM_INVALID', '平台登记 ID 无效或重复');
        ids.add(platform.id);
    }
    const available = platforms.filter((platform) => platform.isAvailable());
    if (available.length > 1) throw new SdkError('SDK_PLATFORM_AMBIGUOUS', '多个自定义平台同时命中宿主检测');
    return Object.freeze({ ...fallback, platform: available[0]?.id ?? fallback.platform });
}

interface CallbackOptions<T> {
    success(value: T): void;
    fail(error: { errMsg?: string; errCode?: number; errNo?: number }): void;
}
/** wx/tt 激励视频共同合同；只使用明确支持的 Promise 与事件接口。 */
export interface MiniGameVideo {
    load(): Promise<void>;
    show(): Promise<void>;
    onClose(callback: (value?: { isEnded?: boolean; count?: number }) => void): void;
    offClose(callback: (value?: { isEnded?: boolean; count?: number }) => void): void;
    onError(callback: (error: unknown) => void): void;
    offError(callback: (error: unknown) => void): void;
    destroy?(): void | Promise<void>;
}
/** 最小平台合同；可注入微信/抖音宿主或确定性测试替身。 */
export interface MiniGameSdkHost {
    login?(options: CallbackOptions<{ code?: string; anonymousCode?: string }> & { force?: boolean }): void;
    createRewardedVideoAd?(options: { adUnitId: string }): MiniGameVideo;
    shareAppMessage?(options: { title: string; imageUrl?: string; query: string }): void;
    vibrateShort?(options: CallbackOptions<unknown> & { type?: 'heavy' | 'medium' | 'light' }): void;
    vibrateLong?(options: CallbackOptions<unknown>): void;
    setClipboardData?(options: CallbackOptions<unknown> & { data: string }): void;
    getClipboardData?(options: CallbackOptions<{ data: string }>): void;
    getLaunchOptionsSync?(): unknown;
    getEnterOptionsSync?(): unknown;
    getAccountInfoSync?(): { miniProgram?: { appId?: string } };
}
function callbackCall<T>(signal: CancellationSignal, action: (callbacks: CallbackOptions<T>) => void): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        let done = false,
            detach = () => {};
        const finish = (success: boolean, result: unknown) => {
            if (done) return;
            done = true;
            detach();
            if (success) resolve(result as T);
            else reject(result);
        };
        detach = signal.onAbort((reason) => finish(false, reason));
        if (done) {
            detach();
            return;
        }
        try {
            action({
                success: (value) => finish(true, value),
                fail: (error) =>
                    finish(
                        false,
                        new SdkError(
                            'SDK_PLATFORM_ERROR',
                            `平台调用失败（${error?.errCode ?? error?.errNo ?? 'unknown'}）`,
                        ),
                    ),
            });
        } catch (error) {
            finish(false, error);
        }
    });
}
function launchInfo(value: unknown): LaunchInfo {
    const input = value && typeof value === 'object' ? (value as { scene?: unknown; query?: unknown }) : {};
    const query: Record<string, string> = {};
    if (input.query && typeof input.query === 'object') {
        for (const [key, item] of Object.entries(input.query)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
            if (typeof item === 'string' || typeof item === 'number') query[key] = String(item);
        }
    }
    return Object.freeze({
        scene: typeof input.scene === 'number' || typeof input.scene === 'string' ? input.scene : undefined,
        query: Object.freeze(query),
    });
}
/** 微信/抖音真实宿主适配；平台凭证仅返回给调用者，不写入任何存档。 */
export function createMiniGameSdkAdapter(platform: 'wechat' | 'douyin', host: MiniGameSdkHost): SdkAdapter {
    const activeVideos = new Set<() => Promise<void>>();
    let adCleanupFailed = false;
    const stopVideos = async () => {
        await Promise.allSettled(Array.from(activeVideos, (cancel) => cancel()));
        if (adCleanupFailed) throw new SdkError('SDK_AD_CLEANUP_FAILED', '广告实例未能完整清理');
    };
    const adapter: SdkAdapter = {
        id: platform,
        initialize: (config: GameConfig) => {
            const actualId = host.getAccountInfoSync?.().miniProgram?.appId;
            if (config.platformAppId && actualId && actualId !== config.platformAppId)
                return Promise.reject(new SdkError('SDK_APP_ID_MISMATCH', '实际平台 AppID 与当前渠道配置不一致'));
            return Promise.resolve();
        },
        stop: stopVideos,
        dispose: stopVideos,
        launch: () => launchInfo(host.getLaunchOptionsSync?.()),
        enter: () => launchInfo(host.getEnterOptionsSync?.() ?? host.getLaunchOptionsSync?.()),
        login: host.login
            ? async (signal): Promise<PlatformCredential> => {
                  const value = await callbackCall<{ code?: string; anonymousCode?: string }>(signal, (callbacks) =>
                      host.login!({ ...callbacks, ...(platform === 'douyin' ? { force: true } : {}) }),
                  );
                  if (
                      !(typeof value.code === 'string' && value.code) &&
                      !(typeof value.anonymousCode === 'string' && value.anonymousCode)
                  )
                      throw new SdkError('SDK_INVALID_RESULT', '平台未返回有效登录凭证');
                  return Object.freeze({
                      kind: 'platform',
                      provider: platform,
                      code: value.code,
                      anonymousCode: value.anonymousCode,
                      simulated: false,
                  });
              }
            : undefined,
        rewardedVideo: host.createRewardedVideoAd
            ? (adUnitId, signal) => {
                  signal.throwIfAborted();
                  if (adCleanupFailed)
                      throw new SdkError('SDK_AD_CLEANUP_FAILED', '上一个广告未能销毁，请重新启动 SDK');
                  return new Promise<RewardedResult>((resolve, reject) => {
                      const video = host.createRewardedVideoAd!({ adUnitId });
                      let done = false,
                          presenting = false,
                          detach = () => {};
                      let cleanup: Promise<void> | undefined;
                      const finish = (success: boolean, result: unknown): Promise<void> => {
                          if (done) return cleanup ?? Promise.resolve();
                          done = true;
                          detach();
                          cleanup = (async () => {
                              let failedCleanup = false;
                              // 每项都尝试清理，tt.destroy 的 Promise 完成之前保留实例与并发锁。
                              for (const release of [
                                  () => video.offClose(closed),
                                  () => video.offError(failed),
                                  () => video.destroy?.(),
                              ]) {
                                  try {
                                      await Promise.resolve(release());
                                  } catch {
                                      failedCleanup = true;
                                  }
                              }
                              activeVideos.delete(dispose);
                              if (failedCleanup) {
                                  adCleanupFailed = true;
                                  throw new SdkError('SDK_AD_CLEANUP_FAILED', '广告实例清理失败');
                              }
                          })();
                          // 同时接管事件回调触发的拒绝，并把清理失败保留给 dispose。
                          void cleanup.then(() => {
                              if (success) resolve(result as RewardedResult);
                              else reject(result);
                          }, reject);
                          return cleanup;
                      };
                      const closed = (value?: { isEnded?: boolean; count?: number }) => {
                          const status =
                              value?.isEnded === true ? 'completed' : value?.isEnded === false ? 'skipped' : 'unknown';
                          const completedCount =
                              Number.isSafeInteger(value?.count) && value!.count! >= 0
                                  ? value!.count!
                                  : status === 'completed'
                                    ? 1
                                    : 0;
                          void finish(true, Object.freeze({ status, completedCount, simulated: false }));
                      };
                      const failed = () => {
                          void finish(false, new SdkError('SDK_AD_FAILED', '激励视频加载或展示失败'));
                      };
                      const dispose = () => finish(false, new OperationCancelled('SDK 已结束'));
                      activeVideos.add(dispose);
                      try {
                          video.onClose(closed);
                          video.onError(failed);
                          detach = signal.onAbort((reason) => {
                              // 已展示广告由用户关闭；保持监听以供服务正确释放并发锁。
                              if (!presenting) void finish(false, reason);
                          });
                          if (done) {
                              detach();
                              return;
                          }
                          void video
                              .load()
                              .then(() => {
                                  if (done) return;
                                  signal.throwIfAborted();
                                  presenting = true;
                                  return video.show();
                              })
                              .catch(failed);
                      } catch (error) {
                          void finish(false, error);
                      }
                  });
              }
            : undefined,
        share: host.shareAppMessage
            ? (options, signal) => {
                  signal.throwIfAborted();
                  host.shareAppMessage!(options);
                  // 微信不能可靠确认分享完成；共同合同只表示发起调用。
                  return Promise.resolve({ status: 'invoked', simulated: false });
              }
            : undefined,
        vibrate:
            host.vibrateShort && host.vibrateLong
                ? async (kind, signal) => {
                      await callbackCall(signal, (callbacks) =>
                          kind === 'long'
                              ? host.vibrateLong!(callbacks)
                              : host.vibrateShort!({
                                    ...callbacks,
                                    ...(platform === 'wechat' ? { type: 'medium' as const } : {}),
                                }),
                      );
                  }
                : undefined,
        setClipboard: host.setClipboardData
            ? async (text, signal) => {
                  await callbackCall(signal, (callbacks) => host.setClipboardData!({ ...callbacks, data: text }));
              }
            : undefined,
        getClipboard: host.getClipboardData
            ? async (signal) => {
                  const value = await callbackCall<{ data: string }>(signal, (callbacks) =>
                      host.getClipboardData!(callbacks),
                  );
                  if (typeof value.data !== 'string') throw new SdkError('SDK_INVALID_RESULT', '平台剪贴板结果无效');
                  return value.data;
              }
            : undefined,
    };
    return adapter;
}
/** 显式预览模拟；结果始终标记 simulated，默认广告提前关闭。 */
export function createMockSdkAdapter(): SdkAdapter {
    const simulation: SdkSimulation = { nextAd: 'skipped', failNextLogin: false };
    let clipboard = '';
    return {
        id: 'mock',
        simulation,
        login: (signal) => {
            signal.throwIfAborted();
            const fail = simulation.failNextLogin;
            simulation.failNextLogin = false;
            return fail
                ? Promise.reject(new SdkError('SDK_PLATFORM_ERROR', '模拟登录失败'))
                : Promise.resolve({ kind: 'platform', provider: 'mock', code: 'MOCK_ONLY', simulated: true });
        },
        rewardedVideo: (_id, signal) => {
            signal.throwIfAborted();
            const status = simulation.nextAd;
            simulation.nextAd = 'skipped';
            return status === 'error'
                ? Promise.reject(new SdkError('SDK_AD_FAILED', '模拟广告失败'))
                : Promise.resolve({ status, completedCount: status === 'completed' ? 1 : 0, simulated: true });
        },
        share: () => Promise.resolve({ status: 'invoked', simulated: true }),
        vibrate: () => Promise.resolve(),
        setClipboard: (text) => {
            clipboard = text;
            return Promise.resolve();
        },
        getClipboard: () => Promise.resolve(clipboard),
    };
}
/** 按实际宿主适配；目标渠道不匹配只允许明确的编辑器预览。 */
export function createPlatformSdkAdapter(
    config: GameConfig,
    runtime: SdkRuntime,
    platforms: readonly SdkPlatformRegistration[] = [],
): SdkAdapter {
    if (!runtime.preview && config.platform !== runtime.platform)
        throw new SdkError(
            'SDK_PLATFORM_MISMATCH',
            `目标平台 ${config.platform} 与实际宿主 ${runtime.platform} 不一致`,
        );
    if (config.previewMockSdk) {
        if (!runtime.preview) throw new SdkError('SDK_MOCK_BUILD', '模拟 SDK 仅允许编辑器预览');
        return createMockSdkAdapter();
    }
    const custom = platforms.find((platform) => platform.id === runtime.platform);
    if (custom) return custom.create(config, runtime);
    const globals = globalThis as typeof globalThis & { wx?: MiniGameSdkHost; tt?: MiniGameSdkHost };
    if (runtime.platform === 'wechat' || runtime.platform === 'douyin') {
        const host = runtime.platform === 'wechat' ? globals.wx : globals.tt;
        if (!host) throw new SdkError('SDK_HOST_MISSING', '目标平台 SDK 宿主不存在');
        return createMiniGameSdkAdapter(runtime.platform, host);
    }
    if (!['web', 'native'].includes(runtime.platform))
        throw new SdkError('SDK_PLATFORM_MISSING', `平台适配器未登记：${runtime.platform}`);
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    return {
        id: runtime.platform,
        vibrate: nav?.vibrate
            ? (kind, signal) => {
                  signal.throwIfAborted();
                  if (!nav.vibrate(kind === 'long' ? 400 : 20))
                      return Promise.reject(new SdkError('SDK_UNSUPPORTED', '浏览器无法执行震动'));
                  return Promise.resolve();
              }
            : undefined,
        setClipboard: nav?.clipboard?.writeText
            ? (text, signal) => {
                  signal.throwIfAborted();
                  return nav.clipboard.writeText(text);
              }
            : undefined,
        getClipboard: nav?.clipboard?.readText
            ? (signal) => {
                  signal.throwIfAborted();
                  return nav.clipboard.readText();
              }
            : undefined,
    };
}
