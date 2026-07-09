# 框架使用手册

这篇是 YZForge 的日常使用手册。只讲开发时怎么落功能、怎么放代码、怎么读资源、怎么检查结果。

## 开发闭环

普通功能开发按这个顺序走：

```text
判断 Scope
创建 Module / Library / ContentPack / View
写手写代码
在 Cocos 里维护 prefab 和资源
npm run yzforge:generate
npm run yzforge:validate:strict
npm run typecheck
```

提交前建议跑：

```bash
npm run yzforge:generate:check
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
```

## 先判断 Scope

YZForge 的第一原则是所有权。不要先想“脚本放 scripts 还是 game”，先判断这段能力归谁。

| 你要做的事 | 放哪里 |
| --- | --- |
| 一个可进入页面、玩法、系统功能 | `assets/modules/<Module>` |
| 两个以上 Module 复用的领域能力 | `assets/libraries/<Library>` |
| 某个 Module 解释的关卡、章节、活动内容 | `assets/content-packs/<Owner>/<Pack>` |
| 无状态工具函数、纯类型、纯算法 | `assets/shared/code` |
| 账号、会话、全局策略、全局 UI 状态 | `assets/app/global` |
| 启动场景、MainRoot、AppBootSettings | `assets/app/main` |

不确定时按这三个问题判断：

- 能不能独立进入和卸载？能，就是 `Module`。
- 是否被多个模块复用，而且有自己的业务规则或状态？是，就是 `Library`。
- 是否只是被某个模块解释的数据和资源？是，就是 `ContentPack`。

## 创建结构

常用创建命令：

```bash
npm run yzforge:create -- module Battle
npm run yzforge:create -- library BattleCore
npm run yzforge:create -- content-pack Level001 --owner Battle
npm run yzforge:create -- view PageBattle --owner Battle
npm run yzforge:create -- part PartRewardCell --owner Battle
npm run yzforge:create -- model BattleModel --owner Battle
npm run yzforge:create -- service BattleService --owner Battle
npm run yzforge:create -- flow BattleFlow --owner Battle
npm run yzforge:create -- event-file BattleStarted --owner Battle
```

创建后刷新生成文件：

```bash
npm run yzforge:generate
```

生成文件只读，不手改。业务改手写文件、manifest、Excel 或 prefab。

## Module 用法

`Module` 是功能入口，例如 `Home`、`Battle`、`Shop`。

推荐分工：

| 类型 | 职责 |
| --- | --- |
| `Module` | 生命周期入口和模块级组合 |
| `Flow` | 流程编排、打开 UI、等待 UI 结果 |
| `Service` | 业务规则、读配置、写 Model、发事件 |
| `Model` | 模块状态数据 |
| `View` | 显示和用户输入 |

`Module` 入口保持薄：

```ts
import { Module } from 'yzforge';
import type { BattleEnterParams } from './public';
import { BattleFlow } from './flow/BattleFlow';

export class BattleModule extends Module<BattleEnterParams> {
    protected async onEnter(params?: BattleEnterParams): Promise<void> {
        await this.useFlow(BattleFlow).enter(params);
    }
}
```

进入模块：

```ts
import { BattleRef } from 'yzforge/modules/Battle';

await app.enterModule(BattleRef, {
    stageId: 'stage_001',
});
```

从当前模块返回：

```ts
await app.back();
```

## Library 用法

`Library` 是多模块复用的领域能力。外部只认公开契约和 token，不 import 内部实现。

Library 的 `code/public.ts` 写公开类型：

```ts
export interface DamageInput {
    readonly attackerId: string;
    readonly targetId: string;
}

export interface DamageSystemApi {
    calc(input: DamageInput): number;
}

export interface BattleCoreTokenMap {
    damageSystem: DamageSystemApi;
}
```

`providers.ts` 绑定实现：

```ts
import { classToken, defineLibraryProviders } from 'yzforge';
import type { BattleCoreTokenMap } from './public';
import { DamageSystem } from './system/DamageSystem';

export const providers = defineLibraryProviders<BattleCoreTokenMap>({
    damageSystem: classToken(DamageSystem),
});
```

Module 先在 `module.json` 声明依赖：

```json
{
  "libraries": ["BattleCore"]
}
```

再使用生成入口：

```ts
import { BattleCoreRef } from 'yzforge/libraries/BattleCore';
import { BattleCoreTokens } from 'yzforge/contracts/libraries/BattleCore';

const battleCore = await this.libraries.load(BattleCoreRef);
const damageSystem = battleCore.use(BattleCoreTokens.damageSystem);
```

## ContentPack 用法

`ContentPack` 放某个 owner Module 解释的内容，例如关卡包、章节包、活动包。

创建：

```bash
npm run yzforge:create -- content-pack Level001 --owner Battle
npm run yzforge:generate
```

加载：

```ts
import { BattleLevel001ContentPack } from 'yzforge/content-packs/Battle/Level001';

const pack = await this.contentPacks.load(BattleLevel001ContentPack);
```

ContentPack 不写可调用业务 API。它提供资源、配置和 manifest，由 owner Module 解释。

## UI 用法

View prefab 放在当前 Scope 的 `res/view`，Part prefab 放在 `res/part`。

打开 View：

```ts
import { assets } from '../generated/assets';

await this.module.ui.open(assets.views.pageBattle);
```

动态创建 Part：

```ts
const cell = await this.module.assets.instantiate(assets.parts.partRewardCell, {
    parent: this.listRoot,
});
```

UI 规则：

- Page、Paper、Popup、Toast、Top 等挂载层由 UIManager 决定。
- View prefab 内部是否使用 `YZSafeAreaRoot`，由开发者按界面需要决定。
- 需要全屏背景加安全区内容时，在 View prefab 内自行拆成背景节点和安全区内容节点。
- 不要在业务 prefab 里自带 PopupMask；PopupMask 由 UIManager 管。

## 资源用法

显式加载资源时，放在当前 Scope 的 `res/runtime`，通过生成入口读取：

```ts
import { assets } from '../generated/assets';

const effect = await this.module.assets.instantiate(assets.runtime.effectHit, {
    parent: this.effectRoot,
});
```

不要手写动态资源路径：

```ts
resources.load('view/PageBattle');
assetManager.loadBundle('yzforge-module-battle');
bundle.load('runtime/effect/hit');
```

## 配置表用法

配置表原始 Excel 放在：

```text
config-source/excel
```

生成配置：

```bash
npm run yzforge:config:build
```

业务读取：

```ts
import { BattleItemIds } from '../generated/config';

const item = this.config.tables.item.require(BattleItemIds.sword);
```

更完整规则看 [配置表使用手册](./config-table.md)。

## 时间用法

业务里的跨天、跨周、跨月、倒计时和服务端时间校准统一走 `app.clock`：

```ts
this.app.clock.setServerUnixMs(loginResult.serverTimeMs);

if (this.app.clock.hasCrossedDay(save.lastClaimMs)) {
    this.resetDailyReward();
}

const leftMs = this.app.clock.msUntilNextDay();
```

不要在业务逻辑里散落 `Date.now()`。

## 本地存储用法

本地存档、设置和缓存走 `app.storage`：

```ts
app.storage.save.setJson('player', saveData);
app.storage.settings.setBoolean('audio/enabled', true);
app.storage.cache.setString('bundle/startEtag', etag);
```

清缓存只清 `cache` 分区：

```ts
app.storage.clearCache();
```

不要直接调用 `sys.localStorage`，不要把玩家进度写进 `cache`。更完整规则看 [本地存储](./storage.md)。

## 启动设置

启动渠道和 Debug/Release profile 在 `assets/app/main/AppBootSettings.ts` 的 Inspector 字段里改。

运行时读取：

```ts
const channel = app.boot.channel;
const debug = app.boot.debug;
```

它不是配置表，不承载玩法数值、活动参数或远程开关。

## 公开契约

跨 Scope 访问只走公开契约：

```ts
import type { BattleEnterParams } from 'yzforge/contracts/modules/Battle';
import { BattleRef } from 'yzforge/modules/Battle';
```

不要这样写：

```ts
import { BattleService } from '../../Battle/code/service/BattleService';
import { BattleEnterParams } from '../../Battle/code/public';
```

如果一个模块想复用另一个模块内部能力，先把能力提到 `Library`。

## 提交前检查

普通业务改动：

```bash
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run typecheck
```

配置表改动：

```bash
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
```

框架、生成器、校验器或 runtime 改动：

```bash
npm run yzforge:generate:check
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
```

## 不要做

- 不要手改 `code/generated/*`。
- 不要跨 Scope import 私有实现。
- 不要手写动态资源路径。
- 不要把多模块复用能力塞进 `shared/code`。
- 不要把启动渠道、Debug/Release profile 写进配置表。
- 不要把配置表生成 JSON 当手写 JSON 改。
- 不要在业务逻辑里散落 `Date.now()`。
- 不要直接操作 `sys.localStorage` 或 `window.localStorage`。
