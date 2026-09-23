import type { SdkIntegrationFactory } from '../../framework/platform/sdk';
import type { SdkPlatformRegistration } from '../../framework/platform/sdk-adapters';

/**
 * 项目渠道接入登记表；JSON 的 channels.<id>.integration 对应这里的键。
 * 内置 platform 直接使用宿主能力，无需登记。新发行 SDK 的组合工厂加在这里。
 * 接入示例与初始化/清理规则见 docs/game-settings-sdk.md。
 */
export const sdkIntegrations: Readonly<Record<string, SdkIntegrationFactory>> = {};

/** 新平台的宿主检测与适配器登记；构建目标在 game-config.json 的 platforms 中维护。 */
export const sdkPlatforms: readonly SdkPlatformRegistration[] = [];
