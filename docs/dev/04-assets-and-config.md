# 04. 资源与配置

## 资源原则

业务代码不要手写动态资源路径，也不要直接加载 Bundle。

不要这样：

```ts
resources.load('view/PageBattle');
assetManager.loadBundle('yzforge-module-battle');
bundle.load('runtime/effect/hit');
```

应该这样：

```ts
import { assets } from '../generated/assets';

await this.module.ui.open(assets.views.pageBattle);
const effect = await this.module.assets.instantiate(assets.runtime.effectHit, {
    parent: this.effectRoot,
});
```

## 放到哪个资源目录

| 目录 | 何时使用 | 访问方式 |
| --- | --- | --- |
| `res/view` | 可被 UIManager 打开的 View prefab | `module.ui.open(assets.views.xxx)` |
| `res/part` | View 内动态 UI 片段 | `module.assets.instantiate(assets.parts.xxx)` |
| `res/runtime` | 代码显式加载的 prefab、json、texture 等 | `module.assets.load/instantiate` |
| `res/content` | prefab 间接引用或配置原始文件 | 通常不直接由业务加载 |
| `res/sound` | 音频资源 | 音频扩展或项目音频系统 |

如果一段代码需要主动加载资源，把资源放进 `runtime`。如果只是 prefab 里拖了引用，放进 `content`。

## 生成资源入口

运行：

```bash
npm run yzforge:generate
```

生成：

```text
assets/modules/Battle/code/generated/assets.ts
assets/libraries/BattleCore/code/generated/assets.ts
assets/app/global/code/generated/assets.ts
```

业务只 import 自己 Scope 的生成入口：

```ts
import { assets } from '../generated/assets';
```

不要 import 其他 Module 的 `generated/assets.ts`。

## 实例所有权

通过框架实例化的节点会记录 owner：

```ts
const node = await this.module.assets.instantiate(assets.runtime.hitEffect, {
    parent: this.effectRoot,
});
```

Module 卸载时，框架会按 owner 清理节点和资源。

如果项目确实手动 `instantiate(prefab)`，必须把节点登记到当前 owner。能走 `module.assets.instantiate` 时优先走它。

## UI prefab

UI prefab 不走普通 instantiate：

```ts
await this.module.ui.open(assets.views.pageBattle);
```

这样 UIManager 才能管理层级、返回键、遮罩、暂停、关闭和 `openForResult`。

## 配置放哪里

配置原始文件推荐放：

```text
res/content/config/
  manifest.json
  schema/
  tables/
  patches/
```

生成入口在：

```text
code/generated/config.ts
```

业务代码只读生成后的配置入口，不直接散落读取 JSON：

```ts
import { config } from '../generated/config';

const stage = this.config.tables.stage.require(stageId);
```

## 配置规则

- 配置类型、索引和表入口由生成器维护。
- 配置数据不进入普通 `generated/assets.ts`。
- Model 可以保存配置 id 或只读结果，不直接加载原始 JSON。
- Service 负责读取配置并写入 Model。
- 配置里不要写可执行脚本路径，需要行为时用 `type`、`strategyId` 或 `scriptKey` 映射到已声明代码。
- ContentPack 可以有自己的配置，但必须通过 `LoadedContentPack.config` 访问。

## 常见判断

| 问题 | 结论 |
| --- | --- |
| 我要代码里主动加载一个 prefab | 放 `res/runtime` |
| View 要打开一个页面 | 放 `res/view`，通过 UIManager 打开 |
| prefab 里拖了一张背景图 | 放 `res/content` |
| 策划表原始 JSON | 放 `res/content/config/tables` |
| 多个模块都用同一张通用字体 | 放 `shared/res` |
