import { _decorator, Enum, settings as engineSettings } from 'cc';
import { PREVIEW } from 'cc/env';
import { AppSettings } from '../../framework/core/app-settings';
import type { GameConfig, GameSelection } from '../../framework/platform/game-config';
import { gameConfig } from '../app/generated/game-config';
import { channelOptions } from '../app/generated/channel-options';
const { ccclass, disallowMultiple, menu, property } = _decorator;
const channelEnum = Enum(
    Object.fromEntries([
        ['（渠道不存在，请重新选择）', 0],
        ...channelOptions.map((item, index) => [
            channelOptions.filter((other) => other.name === item.name).length > 1
                ? `${item.name} (${item.id})`
                : item.name,
            index + 1,
        ]),
    ]),
);
const modeEnum = Enum({ Debug: 0, Release: 1 });
const environmentEnum = Enum({ 'Dev · 开发': 0, 'Staging · 测试': 1, 'Prod · 正式': 2 });

/**
 * 原生 Inspector 的四项启动选择，Ctrl+S 保存到 Bootstrap 场景。
 * 渠道参数只在 JSON 中维护；自动生成器将已保存选择与参数合成运行快照。
 */
@ccclass('game.GameSettings')
@disallowMultiple
@menu('YZForge/游戏设置')
export class GameSettings extends AppSettings {
    @property({ displayName: '游戏版本', tooltip: '例如 1.0.0；保存场景后下次启动生效。' })
    appVersion = '1.0.0';

    @property({ visible: false })
    channelId = 'web_local';

    @property({
        type: channelEnum,
        displayName: '渠道',
        tooltip: '选项来自 project-settings/game-config.json；实际保存稳定的渠道 ID。',
    })
    get channel(): number {
        return channelOptions.findIndex((item) => item.id === this.channelId) + 1;
    }
    set channel(value: number) {
        const item = channelOptions[value - 1];
        if (item) this.channelId = item.id;
    }

    @property({ type: modeEnum, displayName: '构建模式', tooltip: '控制调试与日志，独立于服务环境。' })
    mode = 0;

    @property({
        type: environmentEnum,
        displayName: '服务环境',
        tooltip: '选择服务器地址及 SDK 参数；支持 Debug + Prod。',
    })
    environment = 0;

    /** 编辑器和运行时共用选择格式，枚举位置只用于固定的模式和环境。 */
    selection(): GameSelection {
        const mode = (['debug', 'release'] as const)[this.mode];
        const environment = (['dev', 'staging', 'prod'] as const)[this.environment];
        if (!mode || !environment) throw Error('GameSettings 的模式或环境无效');
        return { appVersion: this.appVersion, channel: this.channelId, mode, environment };
    }
    /** 取得本次启动的不可变配置；修改源配置后重新生成并重启运行时。 */
    resolve(): GameConfig {
        if (PREVIEW) {
            const error = engineSettings.querySettings('yzforge', 'gameConfigError');
            if (error) throw Error(String(error));
            if (engineSettings.querySettings('yzforge', 'gameConfigHash') !== gameConfig.configHash)
                throw Error('预览配置未同步，请启用 YZForge 编辑器扩展，保存场景并等待自动生成完成后重启预览');
        }
        const selection = this.selection();
        for (const key of ['appVersion', 'channel', 'mode', 'environment'] as const)
            if (selection[key] !== gameConfig[key])
                throw Error('GameSettings 与生成配置不一致，请保存 Bootstrap 场景并等待自动生成完成后重启预览');
        return gameConfig;
    }
}
