import { _decorator, Component, Enum } from 'cc';
import { AppProfile as YZAppProfile, type AppBootProfile } from 'yzforge';

const { ccclass, property } = _decorator;

export enum AppChannel {
    Default = 0,
    Development = 1,
    Android = 2,
    IOS = 3,
    WeChat = 4,
}
Enum(AppChannel);

export enum AppProfileOption {
    Debug = 0,
    Release = 1,
}
Enum(AppProfileOption);

@ccclass('AppBootSettings')
export class AppBootSettings extends Component {
    @property({ type: Enum(AppChannel) })
    public channel: AppChannel = AppChannel.Default;

    @property({ type: Enum(AppProfileOption) })
    public profile: AppProfileOption = AppProfileOption.Debug;

    public toProfile(): AppBootProfile {
        const profile = this.profile === AppProfileOption.Release ? YZAppProfile.Release : YZAppProfile.Debug;
        return {
            channel: enumKeyToKebab(AppChannel, this.channel, 'default'),
            profile,
            debug: profile === YZAppProfile.Debug,
        };
    }
}

function enumKeyToKebab(enumType: Record<string, string | number>, value: number, fallback: string): string {
    for (const key in enumType) {
        const enumValue = enumType[key];
        if (typeof enumValue === 'number' && enumValue === value) {
            return key
                .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                .toLowerCase();
        }
    }
    return fallback;
}
