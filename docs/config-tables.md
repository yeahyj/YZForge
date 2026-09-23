# XLSX 配置表制作

在 **YZForge → 项目工作台** 创建 XLSX，再在“配置表”中选择工作簿和数据表，设置目标资源包、主键及公开范围。数据页由表格软件编辑；工作台修改同一工作簿内的导出配置。运行时加载与查询见 [API 使用指南](api-guide.md#配置表与生成的-ts-合同)。

## 工作簿与导出位置

工作簿保存在 `config-source/`，每个工作簿属于一个模块，使用版本 2 声明：

```text
items.xlsx
├─ __config   # 模块、默认包、表、索引、约束、分片和公式关联输入
├─ __enums    # 可选的命名枚举
└─ Items      # 数据表，前四行为表头
```

Sheet 按固定名称识别，不依赖排列顺序。数据表的目标包优先使用该表设置，否则使用工作簿默认包；分片表按显式映射选择包。目标必须属于本模块且已经存在。

`config-source/tables.json` 只为旧表映射保留，新 XLSX 的导出规则维护在 `__config`。同一表同时出现在两种来源中会报错。停用或删除模块后保留的 XLSX 不应改名后继续留作备份；工具递归扫描 `config-source`，归档应放在该目录之外。

## 数据页

| 行   | 内容     | 示例                                               |
| ---- | -------- | -------------------------------------------------- |
| 1    | 字段名   | `id`、`name`、`quality`                            |
| 2    | 字段类型 | `int`、`string`、`enum<Quality>`                   |
| 3    | 默认值   | 空单元格先使用默认值；无默认值时只有可空字段能留空 |
| 4    | 字段说明 | 进入生成的 TypeScript 注释                         |
| 5 起 | 数据     | 主键唯一；字符串 ID 应使用文本单元格               |

主键只能是非空 `int` 或 `string`。空白字段名和以 `#` 开头的列不导出；整行为空的数据跳过。`0` 和 `false` 不视为空值；需要保留前导零或超过安全整数范围的 ID 时使用 `string`。

| 类型                    | 单元格写法与输出                                        |
| ----------------------- | ------------------------------------------------------- |
| `int` / `float`         | 数字；整数必须为安全整数，浮点数必须有限                |
| `bool`                  | `true` / `false` 或 `1` / `0`                           |
| `string`                | 文本单元格，不自动把数字转换为字符串                    |
| `enum<Quality>`         | 命名枚举的存储值，不填成员名                            |
| `ref<common.economy>`   | 目标表主键，导出时检查目标记录存在；不会自动加载目标表  |
| `asset<SpriteFrame>`    | 框架资源逻辑引用，导出时解析并校验资源种类              |
| `vec2` / `vec3`         | JSON 数组，如 `[1,2]`；生成 `{ x, y }` 或 `{ x, y, z }` |
| `color`                 | `#RRGGBB` 或 `#RRGGBBAA`，生成 RGBA 对象                |
| `int[]` / `string[]` 等 | 一维 JSON 数组，如 `[1,2]`、`["a","b"]`                 |
| `string?` / `int[]?` 等 | 末尾 `?` 允许整个值为 `null`；数组写在 `?` 之前         |

日期使用 `string` 配合 `format: date` 或 `date-time` 约束，分别填写 `YYYY-MM-DD` 或含时区的 ISO 时间文本；没有独立的 `date` 字段类型。可用约束为数值 `min/max`、字符串或数组 `minLength/maxLength`、字符串 `format`。解析规则见 [config.mjs](../tools/yzforge/config.mjs)，运行时校验见 [schema.ts](../assets/framework/config/schema.ts)。

## `__config` 与命名枚举

优先在工作台设置导出规则；手动维护时保留模板的固定表头：

```text
kind | id | sheet | bundle | primaryKey | enabled | field | name | value | unique
```

| `kind`       | 主要字段                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `setting`    | `id` 为 `version/module/bundle/enabled`，配置值填 `value`；版本为数字 `2`                                        |
| `table`      | `id` 为稳定表标识，`sheet` 为数据页，`bundle` 可覆盖默认包，`primaryKey` 默认为 `id`，`value` 表示是否公开表合同 |
| `index`      | `id` 指向表，`field` 为索引字段，`name` 为索引名，`unique` 控制唯一性                                            |
| `constraint` | `id` 指向表，`field` 为字段，`name` 为约束名，`value` 为约束值                                                   |
| `shard`      | `id` 指向表，`field` 为分片字段，`value` 为字段值，`bundle` 为目标包；`enabled: false` 明确排除该分片            |
| `input`      | `id` 为公式关联工作簿的项目相对路径，限 `config-source/` 内的 XLSX                                               |

表、索引及分片规则不得重复；未配置目标的分片值会使导出失败。公开表合同与模块 API 依赖独立，仅加载其他模块的公开数据不需要启动其业务。

`__enums` 的表头为 `enum/member/value/comment/public`，例如：

| enum    | member | value | comment | public |
| ------- | ------ | ----- | ------- | ------ |
| Quality | Normal | 1     | 普通    | true   |
| Quality | Rare   | 2     | 稀有    | true   |

同一枚举使用一致的整数或字符串存储值，成员名和值保持唯一，`public` 设置保持一致。同模块的工作簿不能重复定义同名枚举。字段使用 `enum<Quality>`；跨模块使用 `enum<common.Quality>`，目标枚举必须公开。生成结果是 `as const` 值对象及联合类型，业务可以使用 `Quality.Rare`。

可直接参考 [任务表](../config-source/workshop/tasks.xlsx) 的枚举、外键与索引，以及 [Samples](../config-source/showcase/samples.xlsx) 的分片、资源引用和公式。工作簿配置的读写实现见 [workbooks.mjs](../tools/yzforge/workbooks.mjs)。

## 公式与写回

不含公式的工作簿直接校验导出。含公式时，预览可以使用工作簿缓存结果，正式导出必须读取与源文件及声明输入摘要匹配的重算快照。

```powershell
node tools/yzforge/cli.mjs formula-status
node tools/yzforge/cli.mjs recalculate --source config-source/showcase/samples.xlsx
npm run generate
npm run check
```

当前重算器使用 Windows 桌面 Excel COM，在独立副本中计算，不保存源工作簿。结果写入 `project-settings/generated/formulas` 并随源码提交。未改变输入时无需重复运行 Excel；工作簿、导出配置或声明的关联 XLSX 改变后重新计算。没有有效快照时正式导出失败，不会静默使用缓存。

外部工作簿必须在 `input` 中声明；DDE/OLE 链接不支持，复杂或非确定性公式需要项目自行验收。WPS 和 LibreOffice 未提供重算适配器。

工作台保存配置前核对源摘要并备份到 `.yzforge/workbook-history`，仅更新 `__config` 的 XML，检查其余 ZIP 条目不变。若源文件已被其他编辑修改或保存失败，先解决冲突再重试；数据和枚举仍在表格软件中维护。

## 生成与验证

JSON 写入目标 Bundle 的 `dynamic/config`；公开表合同/类型位于 `contracts/generated/config`，私有表位于 `code/generated/config`。行数据不会编译成 TypeScript 常量。生成文件由工具管理，修改源表后重新生成。

运行时用 `show.config.load(Table)` 获取当前使用期内的只读表；多分片表必须显式指定 Bundle。外键只是主键值，资源引用也不等于已加载资源。加载、查询、持有和跨模块示例见 [API 使用指南](api-guide.md#配置表与生成的-ts-合同)。

`npm run check` 核对源表与生成产物，`npm test` 包含配置及工作簿读写测试。公式环境检查不能替代实际工作簿重算；Creator 工作台与目标平台验证入口见 [实现范围与验证](implementation-status.md)。
