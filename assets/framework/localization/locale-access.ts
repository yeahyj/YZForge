import type { AssetKey, AssetKind } from '../assets/asset-types';
import type { TextKey, LocalizedAssetKey, TextParameters, TextArguments } from './localization';
export interface LocaleAccess {
    readonly locale: string;

    /** 原生检查器中的字符串键在已加载合同内解析；业务代码优先使用生成的类型键。 */
    textKey(name: string): TextKey<string>;

    assetKey<K extends AssetKind>(name: string, type: K): LocalizedAssetKey<K>;

    text<P extends string>(
        key: TextKey<P>,
        values?: TextParameters,
    ): {
        text: string;
        locale: string;
        font: AssetKey<'Font'> | null;
    };

    t<P extends string>(key: TextKey<P>, ...args: TextArguments<NoInfer<P>>): string;

    asset<K extends AssetKind>(key: LocalizedAssetKey<K>): AssetKey<K>;
}
