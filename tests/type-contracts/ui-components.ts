import type { ScopedAssets } from '../../assets/framework/assets/asset-manager';
import type { Lifetime } from '../../assets/framework/core/scope';
import type { ScopedTime } from '../../assets/framework/time/time-service';
import type {
    AsyncButton,
    AsyncSprite,
    Switch,
    CountdownLabel,
    MarqueeLabel,
} from '../../assets/framework/ui/components';
import type { Button, Sprite, Label } from 'cc';

export function componentContracts(
    owner: Lifetime,
    assets: ScopedAssets,
    time: ScopedTime,
    button: AsyncButton,
    image: AsyncSprite,
    switcher: Switch,
    timer: CountdownLabel,
    text: MarqueeLabel,
): void {
    const native: [Button, Sprite, Label] = [button, image, timer];
    native[0].interactable = true;
    native[1].spriteFrame = null;
    native[2].fontSize = 24;
    void button
        .run((task) => {
            task.commit(() => {});
        })
        .catch(() => {});
    void image.setSource('icons/example').catch(() => {});
    switcher.updateCheck(0, 2);
    switcher.updateCheckByName('content');
    text.string = '超宽自动滚动';
    text.pause();
    text.play();
    timer.startFor(30);
    timer.startUntil(Date.now() + 30000);
    const click = button.bind(owner, (task) => {
        task.commit(() => {});
    });
    const result: Promise<boolean> = click.press();
    void result.catch(() => {});
    const sprite = image.bind(owner, assets);
    void sprite.set({ id: 'example/default/sprite/icon', type: 'SpriteFrame' }).catch(() => {});
    // @ts-expect-error 图片组件只接收 SpriteFrame，不接收 Prefab Key。
    void sprite.set({ id: 'example/default/prefab/card', type: 'Prefab' });
    // @ts-expect-error 索引接口只接受数值。
    switcher.updateCheck('content');
    timer.bind(owner, time, {
        deadlineMs: 123456,
        onComplete: (task) => {
            task.commit(() => {});
        },
    });
    // @ts-expect-error 截止时间使用 UTC 毫秒数值。
    timer.bind(owner, time, { deadlineMs: 'tomorrow' });
    // @ts-expect-error 借用的期限不能关闭父 Scope。
    owner.close();
}
