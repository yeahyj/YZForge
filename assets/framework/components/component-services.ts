import type { ScopedAssets } from '../assets/asset-manager';
import type { ScopedAudio } from '../audio/audio-manager';
import type { ScopedConfig } from '../config/config-manager';
import type { Scope } from '../core/scope';
import type { ScopedTime } from '../time/time-service';
import type { ScopedLocalization } from '../ui/localization/localized-ui';

/** 组件只消费当前激活期的能力；具体服务由应用装配，宿主不加载 UI 实现。 */
export interface ComponentServices {
    readonly assets: ScopedAssets;
    readonly config: ScopedConfig;
    readonly audio: ScopedAudio;
    readonly time: ScopedTime;
    readonly i18n: ScopedLocalization;
}
/** @internal 每次激活创建新入口，异步回写仍需验证该次激活是否有效。 */
export type ComponentServicesFactory = (owner: Scope, current: () => boolean) => ComponentServices;
