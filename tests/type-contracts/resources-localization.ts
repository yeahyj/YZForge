import type { Assets } from '../../assets/framework/assets/asset-manager';
import type { Localization } from '../../assets/framework/localization/localization';
import type { Lifetime } from '../../assets/framework/core/scope';
import type { AudioClip, Node, Prefab, SpriteFrame } from 'cc';
declare const assets: Assets;
declare const owner: Lifetime;
declare const parent: Node;
declare const i18n: Localization;
async function contracts(): Promise<void> {
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
    const key = i18n.asset('logo', 'SpriteFrame');
    const frame: SpriteFrame = await assets.load(key, owner);
    // @ts-expect-error 文案参数只接受字符串和数字。
    i18n.t('hi', { name: {} });
    void [prefab, sound, wrong, frame];
}
void contracts;
