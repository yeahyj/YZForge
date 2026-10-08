import type { Assets } from '../../assets/framework/assets/asset-manager';
import type { Localization } from '../../assets/framework/localization/localization';
import type { TextKey, LocalizedAssetKey } from '../../assets/framework/localization/localization';
import type { LocalizedBundle } from '../../assets/framework/ui/localization/localized-ui';
import type { CountdownLabel } from '../../assets/framework/ui/components/countdown/countdown-label';
import type { MarqueeLabel } from '../../assets/framework/ui/components/marquee/marquee-label';
import type { Lifetime } from '../../assets/framework/core/scope';
import type { AudioClip, Node, Prefab, SpriteFrame } from 'cc';
import type { ComponentServices } from '../../assets/framework/components/component-services';
import type { TableKey } from '../../assets/framework/config/schema';
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
declare const services: ComponentServices;
declare const tableKey: TableKey<{ name: string }, number, { name: string }>;
async function capabilityContracts(): Promise<void> {
    const scoped = services.assets.in(owner);
    const values = await scoped.loadMany({
        image: { id: 'image', type: 'SpriteFrame' },
        prefab: { id: 'view', type: 'Prefab' },
    });
    const frame: SpriteFrame = values.image;
    // @ts-expect-error 组件不能通过门面取得全局资源管理器，绕过当前使用期。
    void scoped.manager;
    // @ts-expect-error 返回类型仍区分图片与预制体。
    const wrong: SpriteFrame = values.prefab;
    const tables = await (await scoped.openBundle('bundle')).tables.loadMany({ items: tableKey });
    const name: string = tables.items.require(1).name;
    // @ts-expect-error 表主键类型经过包和配置接口后仍保留。
    tables.items.require('1');
    const language = await services.i18n.in(owner).use('bundle');
    const localizedFrame: SpriteFrame = await scoped.load(language.asset(logo));
    // @ts-expect-error 参数合同经过多语言能力接口后仍必填。
    language.t(title);
    language.t(title, { name });
    void [frame, wrong, localizedFrame];
}
void capabilityContracts;
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
