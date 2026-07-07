# 09. 运行流程串联

这份文档把 YZForge 的核心流程从启动到卸载串起来，便于检查框架是否真的能跑。

## 1. 生成阶段

开发者创建 Module、Library、ContentPack 后，先运行生成器：

```text
YZForge Generate All
```

生成器完成：

```text
scan module.json / library.json / content-pack.json
generate contracts
generate registry refs
generate entry.generated.ts
generate assets.generated.ts
generate config.generated.ts
generate content-packs.generated.ts
update package.json exports for the yzforge package boundary
generate import-map.json
update Cocos project setting to project://import-map.json
update tsconfig paths
run validator
```

此时首包拥有：

```text
assets/app/registry/
assets/app/contracts/
assets/app/bootstrap/install.generated.ts
```

业务 Bundle 内拥有：

```text
assets/modules/Home/code/entry.generated.ts
assets/libraries/BattleCore/code/entry.generated.ts
```

## 2. 启动 App

```text
Main.scene
  Main.ts
```

启动流程：

```text
Main.ts creates App
validate Main scene nodes
install generated extensions
initialize BundleManager / EntryRegistry / UIManager
load registry and contracts from first package
initialize GlobalRoot
enter first module
```

`assets/app` 留在首包，不作为普通业务 Bundle。

## 3. 进入 Home Module

业务只 import 首包 Ref：

```ts
import { HomeRef } from 'yzforge/modules/Home';

await app.enterModule(HomeRef);
```

运行时流程：

```text
read HomeRef.libraries
acquire declared libraries
load yzforge-module-home
wait Home entry.generated.ts registration
validate ModuleEntry == HomeRef
new HomeModule
bind assets / config / libraries / contentPacks / ui / event
onCreate
onLoad
onEnter
```

`entry.generated.ts` 只负责注册：

```ts
registerModuleEntry(defineModuleEntry(...));
```

它不写业务逻辑。

## 4. 打开 Home Page

HomeModule 的 `onEnter` 通常交给 Flow：

```ts
protected async onEnter(): Promise<void> {
    await this.useFlow(HomeFlow).enter();
}
```

Flow 打开 UI：

```ts
import { assets } from '../assets.generated';

export class HomeFlow extends Flow {
    public async enter(): Promise<void> {
        await this.module.ui.open(assets.views.pageHome);
    }
}
```

UIManager 负责：

```text
load view prefab through ModuleAssets
instantiate prefab
apply ViewPolicy
bind owner / app / module / handle
bind AutoRefs
attach to correct UI layer
call beforeOpen / onOpen
push stack or queue
record UI owner = Home Module
```

Home Module 卸载时，UIManager 自动关闭 Home 拥有的 UI。

## 5. 使用 Library

如果 Home 需要 BattleCore，必须在 `module.json` 声明：

```json
{
  "libraries": ["BattleCore"]
}
```

使用：

```ts
import { BattleCoreRef } from 'yzforge/libraries/BattleCore';
import { BattleCoreTokens } from 'yzforge/contracts/libraries/BattleCore';

const battleCore = await this.libraries.load(BattleCoreRef);
const damage = battleCore.use(BattleCoreTokens.damageSystem);
```

规则：

- Module 不 import Library 内部实现。
- `this.libraries.load(ref)` 只返回当前 Module 已 acquire 的 handle。
- 同一个 Module 多次 load 同一个 Library，不重复增加 refCount。
- Module 卸载时释放自己 acquire 的 Library。

## 6. 进入 Battle Module

替换进入：

```ts
await app.enterModule(BattleRef, params, {
    mode: EnterMode.Replace,
    unloadPrevious: false,
});
```

运行时：

```text
load Battle dependencies
load Battle bundle
create BattleModule
current Home.onExit
close Home module UI if closePreviousUi = true
Battle.onEnter(params)
Battle becomes Active
Home remains Ready unless unloadPrevious = true
```

压栈进入：

```ts
await app.enterModule(ActivitySpringRef, params, {
    mode: EnterMode.Push,
});

await app.navigator.back();
```

`Push` 会暂停前一个 Module，并让 UIManager 暂停前一个模块的 Page、Paper、Top，关闭前一个模块的 Popup、Toast；返回时 UIManager 恢复前一个模块被暂停的 UI。

## 7. 加载 ContentPack

Battle Module 加载关卡内容：

```ts
import { BattleLevel001ContentPack } from './content-packs.generated';

const contentPack = await this.contentPacks.load(BattleLevel001ContentPack);
```

运行时：

```text
validate owner module is Battle
load declared pack libraries
load yzforge-content-pack-battle-level001
read manifest.generated.json
create LoadedContentPack
```

实例化关卡 prefab：

```ts
const levelRoot = await contentPack.assets.instantiate(contentPack.refs.levelRoot, {
    parent: this.worldRoot,
});
```

ContentPackManager 记录：

```text
asset owner = LoadedContentPack
node owner = LoadedContentPack
```

ContentPack 卸载时先销毁 `levelRoot`，再释放 ContentPack 资源和 Bundle。

## 8. 读取配置

Module 配置：

```ts
const row = this.module.config.tables.stage.require(stageId);
```

Library 公共配置：

```ts
const battleCore = await this.libraries.load(BattleCoreRef);
const mode = battleCore.config.tables.battleMode.require(modeId);
```

ContentPack 配置：

```ts
const enemy = contentPack.config.tables.enemy.require(enemyId);
```

规则：

- Module 不直接读取另一个 Module 的 config。
- 跨 Scope 共用配置提升到 Library、Global 或 ContentPack。
- 配置不携带 TS 脚本，只携带数据和 handler key。

## 9. 卸载 Battle

```ts
await app.unloadModule(BattleRef);
```

卸载顺序：

```text
Battle.onExit if Active
close Battle UI
dispose Part
dispose Flow
dispose Service
dispose Model
unload loaded ContentPack handles
destroy registered pack/module nodes
release Battle loaded assets
Battle.onUnload
release Battle bundle ref
release acquired Library refs
state = Unloaded
```

Library 只有 refCount 归零才释放。

## 10. Validator 防退化

关键检查：

```text
entry.generated.ts 是否入 Bundle
Bundle 名是否和 manifest 一致
禁止跨 Module import 内部代码
禁止跨 Module 读取 config
禁止直接 assetManager.loadBundle
禁止手写动态资源路径
Prefab 脚本来源是否合法
AutoRefs 是否匹配
实例化节点是否登记 owner
generated 文件是否被手改
```

这条流程通过，才说明项目不是只在文档上成立，而是真的能按框架生命周期运行。
