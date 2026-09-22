import type { Lifetime } from '../../assets/framework/core/scope';
import type { ScopedAssets } from '../../assets/framework/assets/asset-manager';
import type { AssetKey } from '../../assets/framework/assets/asset-types';
import { GameComponent } from '../../assets/framework/core/game-component';
import type { VirtualList, VirtualListItemContext } from '../../assets/framework/ui/components/virtual-list';

declare const list: VirtualList;
declare const owner: Lifetime;
declare const assets: ScopedAssets;
declare const prefab: AssetKey<'Prefab'>;
class RowPart extends GameComponent {
    render(_item: VirtualListItemContext<{ id: number }>): void {}
}
function contracts(): void {
    const handle = list.mount<{ id: number }, RowPart>({
        owner,
        assets,
        prefab,
        part: RowPart,
        layout: { itemWidth: 100, itemHeight: 20 },
        render: (part, item) => {
            part.render(item);
            // @ts-expect-error 借用期限不能关闭框架绑定。
            void item.scope.close();
            // @ts-expect-error 模型字段类型由数据源保留。
            const wrong: string = item.data.id;
            void wrong;
        },
    });
    handle.setItems([{ id: 1 }]);
    handle.updateItem(0, { id: 2 });
    // @ts-expect-error 不允许替换为错误的数据类型。
    handle.updateItem(0, { id: 'wrong' });
    // @ts-expect-error 定位模式为明确的字符串联合。
    handle.scrollToIndex(0, 'left');
}
void contracts;
