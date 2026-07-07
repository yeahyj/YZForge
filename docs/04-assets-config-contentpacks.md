# 04. 资源、配置与 ContentPack

## 资源原则

YZForge 不允许业务代码手写动态资源路径。所有显式加载资源都必须通过 generated manifest。

禁止：

```ts
resources.load('xxx');
assetManager.loadBundle('yzforge-module-home');
bundle.load('view/PageHome');
```

推荐：

```ts
await module.ui.open(assets.views.pageHome);
const table = await module.assets.load(assets.runtime.itemTable);
```

资源规则：

- `assets.generated.ts` 属于对应真实 Bundle。
- `registry` 和 `contracts` 不能 import 目标 Bundle 的 `assets.generated.ts`。
- 显式加载资源进入 manifest。
- 间接依赖资源放 `content`，默认不生成普通 asset ref。
- 加载出的资源由对应 Scope 的 asset handle 追踪并释放。

## 资源清单

每个 Module、Global、Shared Resource、Library 都可以生成：

```text
code/assets.generated.ts
```

示例：

```ts
export const assets = defineAssets({
    views: {
        pageHome: viewRef('Home', PageHome, 'view/PageHome', {
            kind: ViewKind.Page,
        }),
        popupSettings: viewRef('Home', PopupSettings, 'view/PopupSettings', {
            kind: ViewKind.Popup,
            mask: 'dim',
        }),
    },
    parts: {
        rewardCell: partRef(PartRewardCell, 'part/PartRewardCell'),
    },
    runtime: {
        itemTable: assetRef(JsonAsset, 'runtime/table/item'),
        effectHit: assetRef(Prefab, 'runtime/effect/hit'),
    },
});
```

生成器必须记录：

- 逻辑路径。
- 资源类型。
- 所属 Scope。
- 所属 Bundle。
- 是否可预加载。
- 是否只允许 UIManager 加载。

## 资源实例所有权

加载资源和实例化节点是两件事。`load` 只得到资源，`instantiate` 会创建运行时节点，必须登记 owner，方便模块退出或 ContentPack 卸载时统一销毁。

推荐 API：

```ts
const prefab = await module.assets.load(assets.runtime.effectHit);

const effectNode = await module.assets.instantiate(assets.runtime.effectHit, {
    parent: effectRoot,
    owner: module,
});
```

ContentPack 内容：

```ts
const levelRoot = await contentPack.assets.instantiate(contentPack.refs.levelRoot, {
    parent: sceneHost,
    owner: contentPack,
});
```

规则：

- `module.assets.load(ref)` 记录资源由当前 Module asset scope 持有。
- `module.assets.instantiate(ref, options)` 记录实例节点由当前 Module 持有。
- `contentPack.assets.instantiate(ref, options)` 记录实例节点由当前 ContentPack 持有。
- owner 卸载时，框架先销毁已登记实例节点，再释放资源。
- 业务手动 `instantiate(prefab)` 可以用，但必须显式调用 owner scope 的 `trackNode(node)`；否则 Validator 或运行时 debug 模式应给出警告。
- UI prefab 不通过普通 `instantiate` 创建，必须走 `module.ui.open`，由 UIManager 记录 UI owner。
- 第一版 UI 关闭时默认销毁节点，prefab 资源跟随 owner Scope 缓存到 Module 或 AppScope 卸载。

## 资源分类

```text
Module / Global:
  res/view      可被 UIManager 打开的 prefab
  res/part      可动态创建的 UI 片段
  res/runtime   代码显式加载资源
  res/content   被 prefab 或其他资源间接引用的内容
  res/sound     可选音频资源，由 yzforge-audio 扩展扫描

Library:
  res/prefab    业务领域共享 prefab
  res/runtime   代码显式加载资源
  res/content   被 prefab 或其他资源间接引用的内容
  res/sound     可选音频资源，由 yzforge-audio 扩展扫描

ContentPack:
  res/prefab    内容 prefab，例如关卡根节点
  res/scene     可选 scene 资源，第一版核心不直接切换
  res/runtime   ContentPack 显式资源
  res/content   ContentPack 内间接引用内容

Shared Resource:
  res/runtime   通用显式资源
  res/content   通用间接资源
  res/sound     通用音频
```

`content` 默认不进入普通 `assets.generated.ts`。如果代码需要显式加载某个资源，它应该移动到 `runtime` 或通过专门 manifest 标记。

## Shared Resource

`assets/shared/code` 始终在首包。

`assets/shared/res` 有两种模式：

```text
inline    放首包，适合很少量通用资源
bundle    配成 yzforge-shared-res，适合字体、通用图集、通用音效、通用材质
```

如果采用 `bundle` 模式：

- `yzforge-shared-res` 必须在业务 Bundle 前加载。
- 共享资源 Bundle 优先级应高于业务 Bundle。
- 业务 Bundle 可以引用共享资源，但不能反向引用业务资源。
- Validator 必须检查共享资源没有引用 Module/Library 内部资源。

## 配置系统

配置不混入普通资源清单。配置由 Config Generator、Config Manifest、Config Codec 和 Config Registry 管理。

配置系统分三层：

| 层 | 作用 | 例子 |
| --- | --- | --- |
| Authoring Source | 策划或工具维护的原始数据 | xlsx、csv、json、yaml、自研表格 |
| Runtime Payload | 构建后运行时加载的数据 | json、binary、compressed binary |
| Generated Contract | TypeScript 类型、表入口、索引入口 | `config.generated.ts` |

`config.generated.ts` 不内嵌大表数据，只生成类型安全访问入口。真实数据仍然作为资源随对应 Scope 的 Bundle 或 ContentPack 加载。

原始文件：

```text
res/content/config/
  manifest.json
  schema/
  tables/
  patches/
```

生成文件：

```text
code/config.generated.ts
```

终局规则：

- 配置表类型、枚举、索引入口由生成器生成。
- 配置原始数据不进入普通 `assets.generated.ts`。
- Config Manager 负责加载、索引、校验。
- Model 可以保存配置 id 或只读索引，不直接读 JSON。
- Service 读取配置并写入 Model。
- ContentPack 可以拥有本地配置，但必须通过 `LoadedContentPack.config` 访问。
- 配置数据不允许携带可执行 TS 脚本。需要行为时，用配置中的 `type`、`strategyId` 或 `scriptKey` 映射到 Module/Library 中已声明的代码实现。
- 配置可以引用资源，但必须通过 generated asset ref 或受校验的资源 key，不手写跨 Scope 路径。

## Config Manifest

`res/content/config/manifest.json` 描述配置表、格式、主键、索引、枚举、补丁和 codec。

示例：

```json
{
  "schemaVersion": 1,
  "format": "json",
  "codec": "yzforge-json",
  "tables": {
    "item": {
      "source": "tables/item.json",
      "row": "ItemRow",
      "primaryKey": "id",
      "indexes": {
        "byType": { "fields": ["type"], "unique": false },
        "byQuality": { "fields": ["quality"], "unique": false }
      }
    },
    "skill": {
      "source": "tables/skill.bytes",
      "format": "binary",
      "codec": "game-skill-binary",
      "row": "SkillRow",
      "primaryKey": "id"
    }
  },
  "enums": {
    "ItemType": ["weapon", "armor", "material"]
  },
  "patches": [
    "patches/dev.json"
  ]
}
```

`format` 是运行时载荷格式，`codec` 是解析器。第一版只必须实现 `json` codec；二进制和压缩格式预留 codec 接口。

## Config Generated API

`config.generated.ts` 只生成稳定 API，不关心底层数据是 json、binary 还是压缩格式。

示例：

```ts
export interface ItemRow {
    id: string;
    type: ItemType;
    quality: number;
}

export const config = defineConfig({
    tables: {
        item: tableRef<ItemRow>({
            name: 'item',
            primaryKey: 'id',
            indexes: {
                byType: indexRef<ItemRow, 'type'>('type'),
            },
        }),
    },
});
```

业务代码只依赖 `config.tables.item.get()` 这类稳定 API，不依赖具体 codec。这样以后从 JSON 切到二进制，不需要改业务调用。

Config Codec 只负责把运行时载荷解析成框架统一的 table data：

```ts
export interface ConfigCodec {
    readonly name: string;
    readonly version: number;
    decode(data: ArrayBuffer | string): unknown;
}
```

第一版内置 `yzforge-json`。自定义二进制格式通过 Extension 注册 codec。

## Config 类型

必须支持：

- `string`
- `number`
- `boolean`
- `enum`
- object
- array
- nullable
- table row reference
- asset reference key

可后续支持：

- union
- bit flags
- vector/color 等 Cocos 友好类型
- localized string key
- formula expression
- custom scalar codec

数组和对象要生成明确类型：

```ts
export interface SkillRow {
    id: string;
    tags: string[];
    cost: {
        itemId: string;
        count: number;
    };
}
```

枚举生成 union type，默认不生成运行时 enum：

```ts
export type ItemType = 'weapon' | 'armor' | 'material';
```

如果业务需要运行时枚举对象，可以由生成器额外生成：

```ts
export const ItemTypes = defineConfigEnum(['weapon', 'armor', 'material'] as const);
```

## Config 访问

默认访问：

示例：

```ts
const item = this.module.config.tables.item.get(itemId);
const enemy = contentPack.config.tables.enemy.get(enemyId);
```

推荐 API：

```ts
const item = config.tables.item.get(id);          // ItemRow | undefined
const item = config.tables.item.require(id);      // ItemRow，不存在则抛清晰错误
const all = config.tables.item.all();             // readonly ItemRow[]
const weapons = config.tables.item.index.byType.get('weapon');
const one = config.tables.item.index.byCode.require('sword_001');
```

索引必须在 manifest 中声明，由生成器生成类型安全入口。第一版不做任意查询引擎，避免把配置系统做成小数据库。

支持的索引形态：

- primary key。
- unique secondary index。
- non-unique group index。
- composite index。
- sorted index，后续支持。

## Config Scope

配置归属必须跟 Scope 对齐：

| Scope | 访问方式 | 说明 |
| --- | --- | --- |
| Global | `app.global.config` | 全局配置，例如平台、启动、公告策略 |
| Module | `module.config` | 模块业务配置 |
| Library | `loadedLibrary.config` | Library 领域配置 |
| ContentPack | `loadedContentPack.config` | 关卡、章节、活动期数等内容配置 |

禁止：

- Module 直接读取另一个 Module 的配置。
- ContentPack 配置直接调用业务代码。
- 配置文件携带 TS 实现脚本。
- 配置里写跨 Scope 资源路径。

## 跨 Scope 配置共享

跨 Scope 共用配置时，不允许直接读取对方内部 config。必须先判断配置真正归属，再把配置放到共同依赖的位置。

判断规则：

- 只有一个 Module 使用，放该 Module。
- 多个 Module 复用的领域配置，提升到 Library。
- App 启动、全局开关、全局入口摘要，放 Global。
- 关卡、章节、活动期数等内容数据，放 ContentPack。
- 只是大厅展示用的轻量摘要，放 Global 或轻量 Entry Library。
- 道具、奖励、掉落等经济领域配置，放对应领域 Library。

示例：

```text
Battle Module
  BattleLocalConfig        战斗模块内部流程配置，只给 Battle 自己读

BattleCore Library
  BattleModeConfig         大厅、活动、战斗都可能读取
  BattleConditionConfig    战斗进入条件
  BattlePreviewConfig      战斗预览信息

RewardCore Library
  RewardGroupConfig        奖励组
  DropConfig               掉落

ItemCore Library
  ItemConfig               道具表

Activity Module
  ActivityConfig           活动期数
  ActivityBattleConfig     活动绑定 battleModeId / rewardGroupId

Battle ContentPack
  Level001Config           具体关卡怪物、波次、地图内容
```

调用方式：

```ts
const battleCore = await this.libraries.load(BattleCoreRef);
const mode = battleCore.config.tables.battleMode.require(modeId);
```

这表示当前 Module 声明依赖 `BattleCore`，并通过 `LoadedLibrary.config` 读取公共领域配置，不是跨模块偷读 Battle Module 的内部配置。

如果配置需要驱动行为：

```json
{
  "id": "fireball",
  "handler": "damage.fire"
}
```

然后由 Module 或 Library 把 `handler` 映射到已注册实现：

```ts
const handler = this.handlers.require(row.handler);
handler.execute(row);
```

这样配置只描述数据，不携带代码。

## Config Validator

必须检查：

- manifest schema 正确。
- 表文件存在。
- 主键唯一。
- 枚举值合法。
- object/array 字段类型正确。
- reference 指向的表和 id 存在。
- asset reference 指向合法 Scope。
- secondary index 字段存在。
- unique index 不重复。
- patch 能正确合并。
- binary codec 存在且版本匹配。
- generated 类型与 manifest 最新。

## Config 实现阶段

第一版最小实现：

```text
json table
primary key id
get / require / all
生成 row interface
生成 union enum
基础校验
Module / ContentPack config scope
```

第二阶段：

```text
secondary index
object / array 深度校验
table reference 校验
asset reference 校验
Library / Global config scope
```

后续阶段：

```text
binary codec
compression
patch / channel override
localized string key
custom scalar codec
sorted index
编辑器表格预览和跳转
```

## ContentPack Manifest

ContentPack 不在自身目录生成业务 TS。Editor 扫描：

```text
assets/content-packs/<Owner>/*/content-pack.json
assets/content-packs/<Owner>/*/res/
```

生成 ContentPack 内资源映射：

```text
assets/content-packs/<Owner>/<ContentPackName>/manifest.generated.json
```

并生成 owner Module 的类型安全入口：

```text
assets/modules/<Owner>/code/content-packs.generated.ts
```

示例：

```ts
export const BattleLevel001ContentPack = defineContentPack({
    id: 'battle.level001',
    owner: 'Battle',
    bundle: 'yzforge-content-pack-battle-level001',
    libraries: [BattleCoreRef],
    refs: {
        levelRoot: contentPackAssetRef(Prefab, 'prefab/LevelRoot'),
        enemyTable: contentPackConfigRef('enemy'),
    },
});
```

使用：

```ts
const plan = this.contentPacks.explain(BattleLevel001ContentPack);
const contentPack = await this.contentPacks.load(BattleLevel001ContentPack);
const levelRoot = await contentPack.assets.load(contentPack.refs.levelRoot);
await this.useFlow(BattleFlow).startLevel(contentPack);
```

`explain(ref)` 不加载资源，只返回 bundle、依赖 Library 和由 refs 解释出的 manifest，方便编辑器面板、日志和调试快照提前展示将要加载的内容。

## LoadedContentPack

```ts
export interface LoadedContentPack<TConfig = unknown> {
    readonly ref: ContentPackRef;
    readonly bundleName: string;
    readonly refs: ContentPackAssetRefs;
    readonly manifest: ContentPackManifest;
    readonly assets: ContentPackAssetScope;
    readonly config: ContentPackConfigScope<TConfig>;
    unload(): Promise<void>;
}
```

Module 只通过 `LoadedContentPack` 读取关卡、章节、活动期数等内容，不把 ContentPack 当成可调用对象。

## ContentPack 脚本引用

ContentPack 不放 TS 源码，但 ContentPack prefab 可以挂载外部脚本。

允许来源：

- `SharedScope` 组件。
- owner Module 组件。
- 已声明 Library 组件。

要求：

- 加载 ContentPack 前必须确保 owner Module 已加载。
- 加载 ContentPack 前必须确保 declared Library 已加载。
- ContentPack 卸载时只能销毁自己实例化的节点和自己加载的资源。
- ContentPack 不能 import、复制或生成业务源代码。

Validator 必须读取 prefab 序列化数据，检查脚本 UUID 是否来自允许 Scope。

## 资源释放

每个 Scope 都有自己的 AssetScope：

```text
ModuleAssets
LibraryAssets
ContentPackAssetScope
GlobalAssets
SharedAssets
```

释放规则：

- 谁加载，谁记录。
- 谁拥有 Handle，谁释放。
- Module 卸载释放自己的资源和 ContentPack。
- Library 只有 refCount 归零才释放。
- Shared Resource 默认不随业务释放，除非显式策略要求。
- `releaseAll` 只能由框架在 Scope 卸载时调用，业务不直接调用。

资源加载 API 应返回 typed asset，并内部记录引用：

```ts
const prefab = await module.assets.load(assets.runtime.effectHit);
```

实例化 API 应登记 owner：

```ts
const node = await module.assets.instantiate(assets.runtime.effectHit, {
    parent: effectRoot,
});
```

业务如果长期持有实例化节点，必须在 Module/Part/View 生命周期中释放或销毁；优先让 AssetScope 或 UIManager 记录所有权。
