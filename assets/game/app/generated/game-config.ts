// 自动生成：GameSettings 已保存的选择 + project-settings/game-config.json 渠道参数。
import { freezeGameConfig } from '../../../framework/platform/game-config';
/** 当前运行配置；地址与 SDK 参数在运行期间保持不变。 */
export const gameConfig = freezeGameConfig({
    appVersion: '1.0.0',
    channel: 'web_local',
    mode: 'debug',
    environment: 'dev',
    channelName: 'Web · 开发',
    platform: 'web',
    buildTargets: ['web-mobile', 'web-desktop'],
    platformAppId: '',
    diagnostics: {
        logLevel: 'debug',
        showStats: true,
    },
    endpoints: {
        apiBaseUrl: '',
        resourceBaseUrl: '',
    },
    sdk: {
        integration: 'platform',
        ads: {
            revive: '',
            double_reward: '',
        },
        share: {
            default: {
                title: '一起玩游戏',
            },
        },
        parameters: {},
        timeoutMs: 10000,
    },
    previewMockSdk: false,
    configHash: '7a981197f3ac44b33eb6d772959e17975246336bfc9f2984c58ea03388cf1789',
});
