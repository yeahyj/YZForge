import type { Label, Sprite } from 'cc';
import type { MarqueeLabel } from '../components/marquee/marquee-label';
import type { CountdownLabel } from '../components/countdown/countdown-label';
import type { AssetKind, BundleRef } from '../../assets/asset-types';
import type { Lifetime } from '../../core/scope';
import type { LocaleAccess } from '../../localization/locale-access';
import type { TextKey, LocalizedAssetKey, TextArguments } from '../../localization/localization';

export interface LocalizedBinding {
    refresh(): void;
    dispose(): void;
}

export interface LocalizedTextBinding<P extends string> extends LocalizedBinding {
    /** 参数变更立即刷新已显示的文字，切换提交也会读取最新值。 */
    update(values: Readonly<Record<P, string | number>>): void;
}
export type LocalizedParameters<P extends string> =
    Readonly<Record<P, string | number>> | ((reader: LocaleAccess) => Readonly<Record<P, string | number>>);
type Parameters<P extends string> = LocalizedParameters<P>;
type TextTarget = Label | MarqueeLabel;
type CountdownToken = 'hh' | 'mm' | 'ss' | 'seconds';
/** 按当前使用期加载和切换语言，in 不延长原激活期。 */
export interface LocalizationAccess {
    readonly locale: string | undefined;

    readonly locales: readonly string[];

    in(owner: Lifetime): LocalizationAccess;

    use(bundle: BundleRef): Promise<LocalizedBundleAccess>;

    /** 供原生组件解析保存的业务包命名空间。 */
    useNamespace(namespace: string): Promise<LocalizedBundleAccess>;

    /** 原生组件使用源预制体/场景的业务包，而非调用方模块。 */
    sourceNamespace(source: string): string;

    setLocale(locale: string): Promise<void>;
}

/** 已加载目录的查询与绑定入口；返回句柄不暴露服务实现。 */
export interface LocalizedBundleAccess {
    readonly locale: string;

    textKey(name: string): TextKey<string>;

    assetKey<K extends AssetKind>(name: string, type: K): LocalizedAssetKey<K>;

    t<P extends string>(key: TextKey<P>, ...args: TextArguments<NoInfer<P>>): string;

    asset<K extends AssetKind>(key: LocalizedAssetKey<K>): import('../../assets/asset-types').AssetKey<K>;

    bindText<P extends string>(
        target: TextTarget,
        key: TextKey<P>,
        ...args: [P] extends [never] ? [values?: Parameters<P>] : [values: Parameters<NoInfer<P>>]
    ): Promise<LocalizedTextBinding<P>>;

    /** 只绑定计时显示模板，不重启计时。hh/mm/ss/seconds 由倒计时填入；其他参数可传回调。 */
    bindCountdownFormat<P extends string>(
        target: CountdownLabel,
        key: TextKey<P>,
        ...args: [Exclude<P, CountdownToken>] extends [never]
            ? [values?: Parameters<Exclude<P, CountdownToken>>]
            : [values: Parameters<Exclude<NoInfer<P>, CountdownToken>>]
    ): Promise<LocalizedBinding>;

    bindSprite(target: Sprite, key: LocalizedAssetKey<'SpriteFrame'>): Promise<LocalizedBinding>;
}
