# 05. UI 与 Prefab 流程

## 创建 View

```bash
npm run yzforge:create -- view PageBattle --owner Battle
```

会创建 View 脚本和空 AutoRefs：

```text
assets/modules/Battle/code/view/PageBattle.ts
assets/modules/Battle/code/view/refs/PageBattle.refs.generated.ts
```

Prefab 需要在 Cocos 中维护：

```text
assets/modules/Battle/res/view/PageBattle.prefab
```

基础流程：

1. 在 Cocos 中创建 `PageBattle.prefab`。
2. 把 `PageBattle` 脚本挂到 prefab 根节点。
3. 维护按钮、文本、子节点和组件引用。
4. 运行 `npm run yzforge:generate` 生成资源入口和 refs。
5. 在 Flow 中 `module.ui.open(assets.views.pageBattle)`。

## 创建 Part

```bash
npm run yzforge:create -- part PartRewardCell --owner Battle
```

Part 放在：

```text
assets/modules/Battle/code/part/PartRewardCell.ts
assets/modules/Battle/res/part/PartRewardCell.prefab
```

Part 通常由 View 内部实例化，不作为页面进入 UI 栈。

## View 命名

推荐命名：

```text
PageHome
PaperInventory
PopupSettings
ToastReward
TopDebug
```

名字用于可读性和生成器默认推断。最终行为以生成出的 `ViewRef` 策略为准。

## Flow 打开 UI

View 不负责流程跳转。推荐由 Flow 打开：

```ts
import { Flow } from 'yzforge';
import { assets } from '../generated/assets';

export class BattleFlow extends Flow {
    public async enter(): Promise<void> {
        await this.module.ui.open(assets.views.pageBattle);
    }
}
```

需要结果时：

```ts
const result = await this.module.ui.openForResult(assets.views.popupConfirm, {
    title: 'Exit?',
});
```

## View 内部

View 负责显示和输入：

```ts
import { _decorator, Button } from 'cc';
import { PageBattleRefs } from './refs/PageBattle.refs.generated';

const { ccclass } = _decorator;

@ccclass('PageBattle')
export class PageBattle extends PageBattleRefs<void, void> {
    protected onOpen(): void {
        this.listen(this.startButton.node, Button.EventType.CLICK, this.onStart, this);
    }

    private onStart(): void {
        this.module.logger.info('start battle');
    }
}
```

事件监听用 `this.listen`，这样 View 关闭或销毁时会自动解绑。

## AutoRefs 规则

- `*.refs.generated.ts` 是生成文件，不手改。
- 节点引用来自 prefab，不在代码里手写查找路径。
- prefab 改了节点名或组件后，运行 `npm run yzforge:generate`。
- 如果 refs 不对，先检查 prefab 挂载脚本、节点命名和组件是否存在。

## 不要这样做

不要让 View 直接控制别的模块：

```ts
import { ShopService } from '../../../Shop/code/service/ShopService';
```

不要长期保存别的 View 节点：

```ts
this.otherPageNode = otherPage.node;
```

不要绕过 UIManager 打开 UI：

```ts
instantiate(pagePrefab);
```

这些都会破坏 owner、返回键、关闭和卸载逻辑。
