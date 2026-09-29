import type { Assets } from '../../assets/framework/assets/asset-manager';
import type { Localization } from '../../assets/framework/localization/localization';
import type { TextKey, LocalizedAssetKey } from '../../assets/framework/localization/localization';
import type { LocalizedBundle } from '../../assets/framework/localization/localized-ui';
import type { CountdownLabel } from '../../assets/framework/ui/components/countdown/countdown-label';
import type { MarqueeLabel } from '../../assets/framework/ui/components/marquee/marquee-label';
import type { Lifetime } from '../../assets/framework/core/scope';
import type { AudioClip, Node, Prefab, SpriteFrame } from 'cc';
declare const assets: Assets;
declare const owner: Lifetime;
declare const parent: Node;
declare const i18n: Localization;
declare const title: TextKey<'name'>;
declare const logo: LocalizedAssetKey<'SpriteFrame'>;
declare const bundle: LocalizedBundle;
declare const countdown: CountdownLabel;
declare const marquee: MarqueeLabel;
declare const remaining: TextKey<'seconds'>;
declare const namedRemaining: TextKey<'name' | 'seconds'>;
async function contracts(): Promise<void> {
    await bundle.bindText(marquee, title, { name: '玩家' });
    await bundle.bindCountdownFormat(countdown, remaining);
    await bundle.bindCountdownFormat(countdown, namedRemaining, { name: '玩家' });
    // @ts-expect-error 除计时占位符外，业务参数仍必填。
    await bundle.bindCountdownFormat(countdown, namedRemaining);
    // @ts-expect-error 参数名不能拼错。
    await bundle.bindCountdownFormat(countdown, namedRemaining, { wrong: '玩家' });
    const loaded = await assets.loadMany(
        { prefab: { id: 'a', type: 'Prefab' }, sound: { id: 'b', type: 'AudioClip' } },
        owner,
    );
    const prefab: Prefab = loaded.prefab,
        sound: AudioClip = loaded.sound;
    // @ts-expect-error 每项结果保留对应的资源类型。
    const wrong: SpriteFrame = loaded.sound;
    const pool = assets.createPool({ id: 'a', type: 'Prefab' }, owner);
    const lease = await pool.spawn(parent, owner);
    // @ts-expect-error 借用期限不暴露关闭权限。
    void lease.scope.close();
    // @ts-expect-error 不能用 SpriteFrame 建立预制体实例池。
    assets.createPool({ id: 'b', type: 'SpriteFrame' }, owner);
    // @ts-expect-error 语言切换必须传使用期限。
    void i18n.setLocale('en');
    const language = await i18n.use('bundle', owner);
    const key = language.asset(logo);
    const frame: SpriteFrame = await assets.load(key, owner);
    // @ts-expect-error 文案参数只接受字符串和数字。
    language.t(title, { name: {} });
    // @ts-expect-error 生成文案键要求完整参数。
    language.t(title);
    // @ts-expect-error 参数名不能拼错。
    language.t(title, { wrong: 'name' });
    language.t(title, { name: '玩家' });
    void [prefab, sound, wrong, frame];
}
void contracts;
