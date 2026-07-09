# 04. 资源与配置表

这篇只讲日常开发怎么放、怎么生成、怎么读。

## 资源放哪里

| 目录 | 用途 | 访问方式 |
| --- | --- | --- |
| `res/view` | 能被 UIManager 打开的 View prefab | `module.ui.open(assets.views.xxx)` |
| `res/part` | View 内部动态 UI 片段 | `module.assets.instantiate(assets.parts.xxx)` |
| `res/runtime` | 代码主动加载的 prefab、json、texture 等 | `module.assets.load/instantiate` |
| `res/content` | prefab 间接引用或内容原始文件 | 通常不由业务直接加载 |
| `res/content/config` | 生成后的运行时配置表 payload | `generated/config.ts` |

不要在业务里手写动态资源路径：

```ts
resources.load('view/PageBattle');
assetManager.loadBundle('yzforge-module-battle');
bundle.load('runtime/effect/hit');
```

应该走当前 Scope 的生成入口：

```ts
import { assets } from '../generated/assets';

await this.module.ui.open(assets.views.pageBattle);
const effect = await this.module.assets.instantiate(assets.runtime.effectHit, {
    parent: this.effectRoot,
});
```

## 配置表工作流

Excel 原始表放在项目根目录：

```text
config-source/excel/
  Battle.xlsx
  Economy/items.xlsx
```

导出计划由面板或 CLI 维护：

```text
config-source/export-plan.json
```

生成后的运行时 JSON 会进入对应 Scope：

```text
assets/modules/<Module>/res/content/config/<Table>.json
assets/libraries/<Library>/res/content/config/<Table>.json
assets/content-packs/<Owner>/<Pack>/res/content/config/<Table>.json
assets/app/global/res/content/config/<Table>.json
```

类型安全入口会进入：

```text
assets/modules/<Module>/code/generated/config.ts
assets/libraries/<Library>/code/generated/config.ts
assets/app/global/code/generated/config.ts
```

ContentPack 的配置入口仍通过 `manifest.generated.json` 暴露给 `LoadedContentPack.config`。

## 面板生成

打开 Cocos 菜单 `YZForge -> Open Panel`，在 `Config Tables` 区域：

1. 点击 `Scan Excel`，扫描 `config-source/excel/**/*.xlsx`。
2. 选择 `Source` 和 `Sheet`。
3. 选择配置归属：`Module`、`Library`、`ContentPack` 或 `Global`。
4. 填 `Table`、`Row Type`、`Primary Key`。
5. 勾选 `Generate ID constants`，生成主键常量，业务代码不用手写字符串。
6. 点击 `Save Table` 写入 `config-source/export-plan.json`。
7. 点击 `Build Config` 生成 JSON 和 `generated/config.ts`。

`Config Check` 只检查生成物是否最新，不写文件，适合提交前和 CI。

## CLI 生成

登记一张表：

```bash
npm run yzforge:config:table -- --source config-source/excel/Battle.xlsx --sheet Items --scope module:Battle --table item --row ItemRow --primary-key id
```

Scope 写法：

```text
global
module:Battle
library:BattleCore
content-pack:Battle/Level001
```

生成配置：

```bash
npm run yzforge:config:build
```

检查配置生成物是否最新：

```bash
npm run yzforge:config:check
```

`yzforge:config:build` 会先按导出计划生成配置 JSON，清理不再属于当前导出计划的旧配置 JSON，再调用普通生成器刷新 `generated/config.ts`。

## Excel 表头规则

固定 4 行表头，第 5 行开始是数据。

| 行号 | 含义 | 例子 |
| --- | --- | --- |
| 第 1 行 | 字段名，必须 lowerCamelCase | `id`、`type`、`price` |
| 第 2 行 | 字段类型 | `string`、`number`、`enum` |
| 第 3 行 | 字段规则，空白等于 `client` | `pk`、`optional`、`ignore` |
| 第 4 行 | 字段注释，会生成到 TS 接口 | `道具 ID`、`显示名称` |
| 第 5 行起 | 数据 | `sword_001`、`10` |

支持类型：

```text
string
number
boolean
enum
string[]
number[]
boolean[]
json
```

支持规则：

| 规则 | 作用 |
| --- | --- |
| `pk` | 标记主键。整张表只能有一个主键 |
| `client` | 导出到客户端，空白规则默认就是它 |
| `optional` | 数据为空时允许省略这个字段 |
| `ignore` | 完全不导出这一列 |

主键规则：

- `Primary Key` 和表头 `pk` 必须指向同一个字段。
- 如果导出计划没有命中字段，但表头只有一个 `pk`，以表头 `pk` 为准。
- 主键不能为空，不能重复。

数组字段可以写成 JSON 数组，也可以用 `,`、`;` 或 `|` 分隔：

```text
sharp|metal
1,2,3
["a","b"]
```

`json` 字段必须是合法 JSON。

## 业务读取

生成器会根据 Excel 元信息生成行类型、表入口和可选 ID 常量：

```ts
import { BattleItemIds, config } from '../generated/config';

const item = this.module.config.tables.item.require(BattleItemIds.sword);
const price = item.price;
```

在 Module 内读自己的配置：

```ts
const item = this.module.config.tables.item.require(BattleItemIds.sword);
```

读 Library 配置，先通过依赖拿到 LoadedLibrary：

```ts
const battleCore = this.module.libraries.require(BattleCoreRef);
const mode = battleCore.config.tables.battleMode.require(BattleCoreBattleModeIds.normal);
```

读 ContentPack 配置：

```ts
const wave = contentPack.config.tables.enemyWave.require(BattleLevel001EnemyWaveIds.wave1);
const count = wave.count;
```

不要从一个 Module 直接 import 另一个 Module 的 `generated/config.ts`。如果多处都要读同一张表，把表提升到 Library、Global 或对应 ContentPack。

## 同名表

不同 Scope 可以有同名表，例如：

```text
assets/modules/Battle/res/content/config/Item.json
assets/libraries/Economy/res/content/config/Item.json
```

它们分别生成在自己的 `generated/config.ts` 里，不冲突。

同一个 Scope 内不允许两张表生成到同一个输出路径，否则 `Build Config` 会失败。

## 当前边界

- 当前导出格式只实现 `json`。
- 二进制格式通过 runtime codec 预留了接口，但还没有表格导出器。
- `.xlsx` 读取的是工作簿里保存的单元格值，不负责重新计算公式。
- `res/content/config/*.json` 只允许是生成物，必须带 `_yzforgeConfig`；手写旧 JSON 表会被 Validator 拒绝。
- 生成的 `code/generated/*` 和 `res/content/config/*.json` 不手改；要改 Excel 或 `config-source/export-plan.json`。
