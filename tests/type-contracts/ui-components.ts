import type { ScopedAssets } from '../../assets/framework/assets/asset-manager';
import type { Lifetime } from '../../assets/framework/core/scope';
import type { ScopedTime } from '../../assets/framework/time/time-service';
import type {
    AsyncButton,
    AsyncSprite,
    ViewState,
    CountdownLabel,
    TabGroup,
} from '../../assets/framework/ui/components';
import type { Toggle } from 'cc';

export function componentContracts(
    owner: Lifetime,
    assets: ScopedAssets,
    time: ScopedTime,
    button: AsyncButton,
    image: AsyncSprite,
    state: ViewState,
    timer: CountdownLabel,
    tabs: TabGroup,
    toggle: Toggle,
): void {
    void button
        .run((task) => {
            task.commit(() => {});
        })
        .catch(() => {});
    void image.setSource('icons/example').catch(() => {});
    state.showContent();
    timer.startFor(30);
    timer.startUntil(Date.now() + 30000);
    tabs.selectIndex(0);
    const click = button.bind(owner, (task) => {
        task.commit(() => {});
    });
    const result: Promise<boolean> = click.press();
    void result.catch(() => {});
    const sprite = image.bind(owner, assets);
    void sprite.set({ id: 'example/default/sprite/icon', type: 'SpriteFrame' }).catch(() => {});
    // @ts-expect-error 图片组件只接收 SpriteFrame，不接收 Prefab Key。
    void sprite.set({ id: 'example/default/prefab/card', type: 'Prefab' });
    state.bind(owner, () => 'empty');
    // @ts-expect-error 加载函数不能把 loading 当成已完成的结果。
    state.bind(owner, () => 'loading');
    // @ts-expect-error 状态受四态联合类型约束。
    state.show('unknown');
    timer.bind(owner, time, {
        deadlineMs: 123456,
        onComplete: (task) => {
            task.commit(() => {});
        },
    });
    // @ts-expect-error 截止时间使用 UTC 毫秒数值。
    timer.bind(owner, time, { deadlineMs: 'tomorrow' });
    tabs.bind(owner, [
        {
            id: 'first',
            toggle,
            open: (task) => {
                void assets
                    .in(task.scope)
                    .instantiate({ id: 'example/default/prefab/card', type: 'Prefab' }, task.parent);
                // @ts-expect-error 页签任务不能关闭父显示期限。
                task.scope.close();
            },
        },
    ]);
}
