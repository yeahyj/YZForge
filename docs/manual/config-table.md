# 配置表使用手册

这篇只讲配置表。目标是让你从 Excel 到业务读取全程不用猜路径、不手写字符串、不手改生成物。

## 总流程

```text
把 Excel 放到 config-source/excel
按 4 行表头规则维护工作表
日常开发：在 YZForge -> 配置表 面板保存导出规则并生成配置
自动化/CI/AI：用 CLI 保存导出规则并运行 npm run yzforge:config:build
在业务里通过 generated/config.ts 读取
npm run yzforge:config:check
```

插件和 CLI 是同一套能力的两个入口：

| 方式 | 适合场景 |
| --- | --- |
| Cocos 插件 | 日常点选 Excel、维护导出规则、手动生成配置 |
| CLI | CI、脚本、AI 开发、提交前检查 |

## Excel 放哪里

所有原始 Excel 只放在项目根目录：

```text
config-source/excel/
  Battle.xlsx
  Economy/Items.xlsx
  Activity/SpringFestival.xlsx
```

规则：

- `source` 必须是 `config-source/excel` 下的项目相对路径。
- 不允许用绝对路径。
- 不允许用 `../` 越界。
- `.xlsx` 读取的是工作簿保存后的单元格值，不负责重新计算公式。

## 表头规则

固定 4 行表头，第 5 行开始是数据。

| 行号 | 含义 | 例子 |
| --- | --- | --- |
| 第 1 行 | 字段名，必须 lowerCamelCase | `id`、`price`、`rewardItems` |
| 第 2 行 | 字段类型 | `string`、`number`、`string[]`、`json` |
| 第 3 行 | 字段规则，空白等于 `client` | `pk`、`optional`、`ignore` |
| 第 4 行 | 字段注释，会生成到 TS 接口 | `道具 ID`、`价格` |
| 第 5 行起 | 数据 | `sword_001`、`100` |

第 4 行可以整行留空；Excel 物理空行不会导致第 5 行数据被误判成表头。

## 字段名规则

字段名必须是 lowerCamelCase：

```text
id
itemType
rewardItems
unlockLevel
```

不要写：

```text
ItemId
item_id
item-id
物品ID
```

## 字段类型

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

数组字段可以写 JSON 数组，也可以用 `,`、`;` 或 `|` 分隔：

```text
sharp|metal
1,2,3
["a","b"]
```

`json` 字段必须是合法 JSON。

## 字段规则

支持规则：

| 规则 | 作用 |
| --- | --- |
| `pk` | 标记主键。整张表必须且只能有一个主键。 |
| `client` | 导出到客户端。空白规则默认就是它。 |
| `optional` | 数据为空时允许省略这个字段。 |
| `ignore` | 完全不导出这一列。 |

未知规则会直接报错。比如 `server`、`clientOnly`、`note` 都不是合法规则；备注写第 4 行注释，不要塞进规则行。

## 主键规则

主键只从 Excel 第 3 行规则推导，不从面板或 CLI 填。

规则：

- 整张表必须且只能有一个 `pk` 字段。
- 如果字段名叫 `id`，第三行规则必须写 `pk`。
- 主键不能为空。
- 主键不能重复。

推荐大多数表都使用 `id` 做主键：

```text
第 1 行：id
第 2 行：string
第 3 行：pk
第 4 行：道具 ID
```

## 面板用法

打开 Cocos 菜单：

```text
YZForge -> 配置表
```

常规步骤：

1. 点击 `Scan Excel / 扫描 Excel`，扫描 `config-source/excel/**/*.xlsx`。
2. 在左侧规则区选择已有规则，或点击 `New Rule / 新建规则`。
3. 选择 `Source` 和 `Sheet`。
4. 选择配置归属：`Module`、`Library`、`ContentPack` 或 `Global`。
5. 填写 `Rule Name / 规则名称`。
6. 填写 `Table Key / 代码表名`。
7. 按需要勾选 `Generate ID constants`。
8. 在输出预览中确认目标路径；点击 `Save Rule / 保存规则`（或按 `Ctrl/Cmd + S`）写入 `config-source/export-plan.json`。
9. 点击 `Build Config / 生成配置` 生成 JSON 和 `generated/config.ts`。

面板会用“未保存”状态标记当前编辑；切换规则或重新扫描 Excel 前会确认是否放弃修改。必填项和 `Table Key` 的 lowerCamelCase 格式会在发送命令前校验。

`Delete Rule / 删除规则` 只删除导出规则，不删除 Excel。下一次 `Build Config / 生成配置` 会清理不再属于导出计划的旧生成 JSON。

`Config Check / 检查配置` 只检查生成物是否最新，不写文件，适合提交前和 CI。

## 导出规则字段

导出计划保存在：

```text
config-source/export-plan.json
```

重要字段：

| 字段 | 作用 | 是否影响业务代码 |
| --- | --- | --- |
| `id` | 稳定规则 ID，编辑和删除都按它命中。 | 不直接影响 |
| `label` / `Rule Name` | 面板显示名，方便人看。 | 不影响 |
| `source` | Excel 路径。 | 影响生成来源 |
| `sheet` | 工作表名。 | 影响生成来源 |
| `scope` | 输出归属。 | 影响输出目录和读取位置 |
| `table` / `Table Key` | 代码表名。 | 影响 JSON 文件名、TS 类型和业务读取入口 |
| `generateIdConstants` | 是否生成主键常量。 | 影响是否能 import ID 常量 |

`Rule Name` 是给人看的，改它不会改变生成 JSON、TS 类型或运行时接口。

`Table Key` 是给代码用的，改它以后业务读取代码要一起改。

`Row Type` 不由面板填写，固定由 `Table Key` 推导：

```text
item -> ItemRow
enemyWave -> EnemyWaveRow
startItems -> StartItemsRow
```

`Primary Key` 不由面板填写，固定由 Excel 表头的 `pk` 推导。

## Scope 写法

面板里选择 Scope，CLI 里这样写：

```text
global
module:Battle
library:BattleCore
content-pack:Battle/Level001
```

选择建议：

| 数据用途 | 推荐 Scope |
| --- | --- |
| 只有某个 Module 用 | `module:<Module>` |
| 多个 Module 通过一个领域能力共用 | `library:<Library>` |
| 某个关卡包、章节包、活动包独有 | `content-pack:<Owner>/<Pack>` |
| 全局账号、启动后全局策略需要 | `global` |

不要为了方便从一个 Module 直接 import 另一个 Module 的配置生成文件。多处都要读同一张表时，把表提升到 Library、Global 或对应 ContentPack。

## CLI 用法

登记一张表：

```bash
npm run yzforge:config:table -- --label "Battle Items" --source config-source/excel/Battle.xlsx --sheet Items --scope module:Battle --table item
```

更新已有规则时传 `--id`：

```bash
npm run yzforge:config:table -- --id cfg_xxx --label "Battle Items" --source config-source/excel/Battle.xlsx --sheet Items --scope module:Battle --table item
```

删除规则：

```bash
npm run yzforge:config:remove -- --id cfg_xxx
```

生成配置：

```bash
npm run yzforge:config:build
```

检查配置生成物是否最新：

```bash
npm run yzforge:config:check
```

## 生成物在哪里

运行时 JSON 输出到对应 Scope：

```text
assets/modules/<Module>/res/content/config/<Table>.json
assets/libraries/<Library>/res/content/config/<Table>.json
assets/content-packs/<Owner>/<Pack>/res/content/config/<Table>.json
assets/app/global/res/content/config/<Table>.json
```

类型安全入口输出到：

```text
assets/modules/<Module>/code/generated/config.ts
assets/libraries/<Library>/code/generated/config.ts
assets/app/global/code/generated/config.ts
```

ContentPack 的配置入口通过 `manifest.generated.json` 和 `LoadedContentPack.config` 暴露。

生成物不手改。要改数据，改 Excel；要改导出目标，改导出规则。

## 业务读取

Module 读取自己的配置：

```ts
import { BattleItemIds } from '../generated/config';

const item = this.config.tables.item.require(BattleItemIds.sword);
const price = item.price;
```

让 `this.config.tables` 获得完整类型：

```ts
import { Module } from 'yzforge';
import type { BattleConfigTables } from './generated/config';
import type { BattleEnterParams } from './public';

export class BattleModule extends Module<BattleEnterParams, BattleConfigTables> {
    protected onEnter(): void {
        const item = this.config.tables.item.require(BattleItemIds.sword);
        this.logger.info(item.price);
    }
}
```

读取 Library 配置：

```ts
const battleCore = await this.libraries.load(BattleCoreRef);
const mode = battleCore.config.tables.battleMode.require(BattleCoreBattleModeIds.normal);
```

读取 ContentPack 配置：

```ts
const pack = await this.contentPacks.load(BattleLevel001ContentPack);
const wave = pack.config.tables.enemyWave.require(BattleLevel001EnemyWaveIds.wave1);
```

## 同名表

不同 Scope 可以有同名表：

```text
assets/modules/Battle/res/content/config/Item.json
assets/libraries/Economy/res/content/config/Item.json
```

它们分别生成在自己的 `generated/config.ts` 里，不冲突。

同一个 Scope 内不允许两张表生成到同一个输出路径，否则 `Build Config` 会失败。

## 导出格式

当前导出格式固定为 `json`。

二进制格式在 runtime codec 层预留了接口，但还没有表格导出器。等二进制导出真正落地后，再打开面板格式选项和 CLI 格式参数。

## 常见错误

`id` 字段没有写 `pk`：

```text
如果字段名叫 id，第三行必须写 pk。
```

多个主键：

```text
整张表只能有一个 pk。需要组合含义时，新增一个明确的 id 字段。
```

业务 import 了别的 Module 的生成配置：

```text
把表提升到 Library、Global 或 ContentPack，不要跨 Scope 私有 import。
```

手改了生成 JSON：

```text
不要改 res/content/config/*.json，改 Excel 后重新 npm run yzforge:config:build。
```

生成物没更新：

```bash
npm run yzforge:config:build
npm run yzforge:config:check
```

## 提交前检查

配置表改动至少跑：

```bash
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
```

如果同时改了生成器、面板、配置 runtime 或校验器，再跑：

```bash
npm run yzforge:smoke
```
