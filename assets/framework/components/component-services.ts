import type { AssetAccess } from '../assets/asset-access';
import type { AudioAccess } from '../audio/audio-access';
import type { ConfigAccess } from '../config/config-access';
import type { Scope } from '../core/scope';
import type { TimeAccess } from '../time/time-access';
import type { LocalizationAccess } from '../ui/localization/localization-access';

/** 组件只消费当前激活期的能力；具体服务由应用装配，宿主不加载 UI 实现。 */
export interface ComponentServices {
    readonly assets: AssetAccess;
    readonly config: ConfigAccess;
    readonly audio: AudioAccess;
    readonly time: TimeAccess;
    readonly i18n: LocalizationAccess;
}
/** @internal 每次激活创建新入口，异步回写仍需验证该次激活是否有效。 */
export type ComponentServicesFactory = (owner: Scope, current: () => boolean) => ComponentServices;

/** @internal 原生扩展只需激活期服务工厂，不依赖完整业务模块上下文。 */
export interface ComponentServicesHost {
    readonly componentServices: ComponentServicesFactory;
}
