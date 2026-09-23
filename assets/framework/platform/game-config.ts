/** 游戏构建模式；服务环境独立选择。 */
export type BuildMode = 'debug' | 'release';
/** 服务环境；不参与默认存档前缀。 */
export type ServiceEnvironment = 'dev' | 'staging' | 'prod';
/** 稳定的平台 ID；内置 web/wechat/douyin/native，项目可登记新宿主。 */
export type GamePlatform = string;
/** SDK 参数仅使用可序列化的公开 JSON 数据。 */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
/** 原生设置组件保存的四项选择；渠道始终使用稳定的字符串 ID。 */
export interface GameSelection {
    readonly appVersion: string;
    readonly channel: string;
    readonly mode: BuildMode;
    readonly environment: ServiceEnvironment;
}
/** 可复用的分享模板；动态 query 在调用时传入。 */
export interface ShareTemplate {
    readonly title: string;
    readonly imageUrl?: string;
}
/** 本次预览/构建的只读配置快照；原始多渠道 JSON 不进入游戏。 */
export interface GameConfig {
    readonly appVersion: string;
    readonly channel: string;
    readonly channelName: string;
    readonly mode: BuildMode;
    readonly environment: ServiceEnvironment;
    readonly platform: GamePlatform;
    /** 此平台允许的 Creator 构建目标，第一个用于导出构建参数。 */
    readonly buildTargets: readonly string[];
    /** 平台公开 AppID，区别于框架的存档 appId。 */
    readonly platformAppId: string;
    readonly configHash: string;
    readonly diagnostics: {
        readonly logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
        readonly showStats: boolean;
    };
    readonly endpoints: { readonly apiBaseUrl: string; readonly resourceBaseUrl: string };
    readonly sdk: {
        /** 项目登记的渠道接入实现，可组合平台、发行和广告 SDK。 */
        readonly integration: string;
        readonly ads: Readonly<Record<string, string>>;
        readonly share: Readonly<Record<string, ShareTemplate>>;
        readonly parameters: Readonly<Record<string, JsonValue>>;
        readonly timeoutMs: number;
    };
    /** 只允许编辑器预览使用；构建校验拒绝开启此项的发布任务。 */
    readonly previewMockSdk: boolean;
}
/** 深冻结 JSON 快照，防止业务在运行中改地址或切换渠道。 */
export function freezeGameConfig(config: GameConfig): GameConfig {
    const freeze = (value: unknown): void => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    };
    const copy: GameConfig = JSON.parse(JSON.stringify(config)) as GameConfig;
    freeze(copy);
    return copy;
}
/** 独立使用框架而没有启动配置时的离线默认值；项目 GameRoot 始终提供生成配置。 */
export const standaloneGameConfig: GameConfig = freezeGameConfig({
    appVersion: '0.0.0',
    channel: 'standalone',
    channelName: '独立框架',
    mode: 'debug',
    environment: 'dev',
    platform: 'web',
    buildTargets: ['web-mobile', 'web-desktop'],
    platformAppId: '',
    configHash: '',
    previewMockSdk: false,
    diagnostics: { logLevel: 'warn', showStats: false },
    endpoints: { apiBaseUrl: '', resourceBaseUrl: '' },
    sdk: {
        integration: 'platform',
        ads: {},
        share: {},
        parameters: {},
        timeoutMs: 10000,
    },
});
