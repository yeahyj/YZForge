# YZForge

面向 Cocos Creator 3.8.8 的通用游戏框架。运行时在 `assets/framework`，Creator 工作台在 `extensions/yzforge-editor`，生成工具在 `tools/yzforge`。`assets/game` 是可替换的演示应用。

模块划分业务边界，Cocos Bundle 划分交付内容，Scope 管理使用期限。复用代码直接使用普通目录或包，不设运行时 Extension 安装系统，也不另设 ContentPack 业务对象。

常用 API 的参数、返回值、生命周期与示例已写入源码中文注释，可直接在 VS Code 悬停查看。先阅读 [API 使用指南](docs/api-guide.md)，理解 `show.scope`、`show.commit`、跨模块配置、时间周期与模块通信。本轮行为变化及旧代码迁移见 [优化与迁移说明](docs/runtime-improvements.md)。

## 开始使用

1. 用 Creator **3.8.8** 打开项目，安装 Node.js **22.13+（22.x）或 24+**，执行 `npm ci`。
2. 启用项目扩展 `yzforge-editor`，打开 **YZForge → 项目工作台**。
3. 打开 `assets/game/boot/Bootstrap.scene` 运行示例。设计分辨率和横竖屏在 Creator 项目设置中维护。
4. 在工作台创建模块，选择代码随应用启动加载或按需加载。默认创建 `default` 资源包，也可选择纯代码模块。
5. 替换 `GameRoot.onBoot` 中的演示启动流程。删除示例时先处理工作台列出的引用。

## 工作台

| 页面       | 操作                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 创建       | 模块、资源包、Page/Popup/Overlay/Toast/Loading、Part、普通预制体、Component、Service、XLSX；自动补后缀，预览实际路径和冲突 |
| 自动绑定   | 扫描命名节点，生成 Binding，通过 Creator 写入并读回引用；已有预制体也可接入                                                |
| 配置表     | 选择工作簿、Sheet、主键及目标包；保存 `__config`、预览、公式重算、正式导出                                                 |
| 项目设置   | 展示代码/资源两份 Creator 配置；应用标识、音频、日历及框架参数                                                             |
| 删除与恢复 | 模块、资源包、UI、Part/普通预制体、脚本的引用检查、完整备份、Creator 删除及 UUID 恢复                                      |

模块依赖、资源包、预制体、工作簿和导出目标使用选择控件。只需输入新对象的语义名称。创建前列出配套脚本、预制体、生成产物和 Creator 元数据；存在同名文件时停止。切换页面和刷新会保留未保存的配置草稿，源工作簿变化后会拒绝用旧摘要覆盖。

资源导入、移动、删除以及 XLSX 保存会自动校验、更新清单和配置。批量事件合并执行；工作台操作与生成串行，失败操作保留上一份有效产物，错误显示于操作结果和 Creator 控制台。仍提供手动“生成清单与配置”和“检查”，用于修复后重试。

## 模块与资源目录

```text
assets/game/modules/inventory/
├─ module.json
├─ public.ts                         # ModuleRef 与公开 API 类型
├─ contracts/generated/              # 资源 Key、ViewKey、BundleRef；可公开配置合同/枚举
├─ code/                             # 选择按需代码时，这个目录是代码 Bundle
│  ├─ InventoryModule.ts
│  ├─ InventoryModuleEntry.ts         # 按需代码入口
│  ├─ entry.prefab
│  ├─ ui/                            # Page/Popup 等，以及可选 Presenter
│  ├─ components/                    # Part 与普通组件；各自有 generated/Binding
│  ├─ services/
│  └─ generated/config/              # 私有表的 TS 合同和类型，不含数据行
└─ bundles/
   ├─ default/                       # 实际资源 Bundle
   │  ├─ dynamic/                    # 自动编目
   │  │  ├─ ui/
   │  │  ├─ prefabs/ItemPart.prefab
   │  │  ├─ icons/
   │  │  ├─ audio/
   │  │  └─ config/                  # XLSX 导出的 JSON
   │  ├─ static/                     # 仅通过序列化引用使用，不进框架动态清单
   │  └─ yz-index.json
   └─ extra/                         # 可选；与 default 相同的结构
```

**`bundles/default` 才是 Bundle，`dynamic` 和 `static` 是它的子目录。** static 不因这个名字而进入主包，也不表示一定从构建中剔除。最终交付和依赖归属以 Creator 产物为准；主场景的静态引用可能提前拉入可选内容。

Creator 项目设置中有 **YZForge 代码配置**、**YZForge 资源配置** 两份真实预设，目录通过 `bundleConfigID` 引用。支持分包的小游戏默认本地分包；Web/原生默认本地 Bundle，开发者在 Creator 统一修改交付设置。工作台仅补建缺失预设，不重置已有修改。

按需模块的私有代码由代码 Bundle 注册；生成的主包装配只存代码包和入口标识。跨模块使用 `public.ts`、`contracts`、模块 API 或事件，禁止直接值导入另一个模块的 `code`。公开合同可用 `import type` 引用类型，数据行留在资源包。构建前检查生成一致性和类型，构建后核验实际资源包及代码入口归属，报告在 `.yzforge/build-reports`。

## 自动绑定、Part 与生命周期

节点例如 `btn_confirm`、`lbl_title`、`spr_icon`、`node_content`。生成器创建隐藏序列化字段和受保护 getter，再由 Creator 自动写入引用，**无需手动拖节点**。同范围重名或缺组件时明确报错。外层可以绑定嵌套预制体的根节点，但不扫描其内部，也不改写嵌套预制体身份。

| 对象       | 文件示例                                         | 基类和管理方式                                           |
| ---------- | ------------------------------------------------ | -------------------------------------------------------- |
| 完整界面   | InventoryPage、RewardPopup                       | 生成 Binding 继承 UIView，由 UI 管理器管理               |
| UI 部件    | ItemPart.prefab、ItemPart.ts、ItemPartBinding.ts | 生成 Binding 继承 GameComponent，由父界面/创建者组合管理 |
| 普通预制体 | ActorPrefab.prefab、ActorComponent.ts            | 生成 Binding 继承 GameComponent                          |
| 服务       | InventoryService.ts                              | 普通 TypeScript 类，持有明确的 Scope                     |

Part 支持动态创建。动态加载的 Part 放 `dynamic/prefabs/`；仅通过编辑器嵌套引用的放 `static/prefabs/`。同时需要两种用法时保留 dynamic 中的一份。已有预制体通过“创建 → UI 部件/通用预制体 → 预制体来源”接入，保留原 UUID 和节点结构。

```ts
// InventoryRes 来自 contracts/generated/resources-default.ts。
// Part 与父界面的显示周期一起结束。
const partNode = await show.assets.instantiate(InventoryRes.prefab.prefabsItemPart, this.node);
// 创建者需要提前移除时，可等待节点和资源清理完成。
await show.assets.destroyInstance(partNode);
```

跨模块资源会先准备其 `requiredCodeModules`，再反序列化。通过 `ctx.assets` 创建时，注入的是调用方的业务上下文，不按资源目录猜测宿主；共享 Part 优先接收数据与回调。单纯加载代码不启动所属模块的业务工厂。场景中手动放置的 GameComponent 使用 `app.bindScene(root, moduleId, owner)` 接入，注入之前不会运行业务 `onInit`。

| 基类          | 业务钩子                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| UIView        | onCreate、onShow、onHide、onDispose、onTick、onLateTick                  |
| GameComponent | onInit、onActivate、onReady、onTick、onLateTick、onDeactivate、onDispose |
| AppEntry      | appOptions、onBoot、onBootFailed                                         |

业务使用框架钩子，不覆盖引擎 onLoad/start/onEnable/update。GameComponent 钩子同步执行，异步任务放在 `activation.run`；UI 的 onCreate/onShow/onHide 可以异步。异步返回后使用捕获的 `show.commit` 或 `activation.commit` 提交结果。按钮结束弹窗调用 `show.finish(result)`。

简单界面直接编写渲染和输入逻辑；复杂界面可选择生成 Presenter，由它组织显示流程，页面负责渲染，跨界面业务状态放 Service。Part 不进入页面栈。

## 资源寻址与通信

```ts
const assets = show.assets;
const address = await assets.resolve('icons/coin', 'SpriteFrame');
const frame = await assets.load('coin', 'SpriteFrame'); // 当前包内唯一时可用短名
await assets.setSprite(this.sprIcon, InventoryRes.sprite.iconsCoin);

// 跨命名空间使用生成 Key 或完整 AssetKey；scoped 字符串始终表示相对名。
await assets.load({ id: 'common/default/sprite/icons/coin', type: 'SpriteFrame' });

const popup = await ctx.ui.open(InventoryViews.rewardPopup, params, show.scope);
const result = await popup.result;
if (result.status === 'completed') show.commit(() => applyResult(result.value));

const sound = await show.audio.play(InventoryRes.audio.audioConfirm);
await sound.ended;
ctx.audio.setVolume('sfx', 0.5);
```

逻辑 ID 为 `module/group/kind/relative/path`，物理文件名按英文短横线规则生成身份。类型、命名空间和层级共同区分重名；短名有多个候选时列出候选并报错，不任取一个。图片的 ImageAsset、Texture2D、SpriteFrame 分别编目，图集子帧保留子资源名称。暂不支持的动态导入类型明确报错。

`project-settings/generated/resource-identities.json` 保存 UUID 与稳定逻辑身份。包内移动和文件改名保持 Key，删除产生停用记录，其他 UUID 不能悄悄复用旧名；跨包身份迁移需显式处理。别名只能直接指向同命名空间的有效入口。身份与生成物所有权记录均进入 Git。

模块通过 `app.modules.use(ModuleRef, owner)` 获得有期限的 API，依赖 API 注入模块工厂的第二个参数。通知使用 `eventKey<T>`、`ctx.events.on(key, handler, owner)` 和 `emit`。UI 之间优先使用参数、结果和有明确 Scope 的事件，不访问另一个界面的内部节点。

模块工厂推荐用 `defineModule` 关联公开 API 和依赖类型。本模块页面通过 `ctx.services(LobbyServices)` 取得工厂显式返回的内部服务；跨模块仍使用公开 API。示例大厅通过 Profile API 修改共享余额，动态 WalletPart 只负责渲染；存档示例包含逐版本迁移和有效备份恢复。

`Scope.close()` 先取消，再等待登记任务和真实清理；超时只报告并隔离实例，不能提前释放仍在使用的资源。代码注册可在同一运行会话复用，业务实例结束时不会假称已卸载 JavaScript。

## 配置表

新建流程使用 **XLSX**。工作簿第一张 `__config` 是唯一导出声明，`__enums` 定义命名枚举；旧 CSV 只用于迁移兼容。面板可选择每张表的目标包，未单独设置时继承工作簿默认包。索引、约束、分片路由、公开合同和外部工作簿输入同样在 `__config` 声明。

数据表第 1—4 行依次为字段名、类型、默认值、说明，第 5 行开始是数据。字符串 ID 使用文本单元格保留前导零；false 和 0 不视为空值。

| 类型                                    | 填写规则                                                                |
| --------------------------------------- | ----------------------------------------------------------------------- |
| int、float、bool、string                | 严格检查值；bool 接受 true/false、1/0                                   |
| enum\<Quality\>、enum\<module.Quality\> | 引用 __enums 的命名枚举；成员值为统一的整数或字符串，跨模块枚举必须公开 |
| ref\<module.table\>                     | 外键，导出时检查目标表和主键；不因此启动目标业务模块                    |
| asset\<SpriteFrame\> 等                 | 完整逻辑 ID 或可唯一解析的相对名；验证后导出 AssetKey                   |
| vec2、vec3                              | JSON 数组                                                               |
| color                                   | #RRGGBB / #RRGGBBAA                                                     |
| T[]、T?、T[]?                           | 一维 JSON 数组、可空值及可空数组                                        |

日期使用 string 及 date/date-time 格式约束，带时间的 ISO 文本必须有偏移；不隐式转换 Excel 日期单元格。数据区的富文本、合并单元格等不支持的结构会报出位置。

输出为目标 Bundle 的 `dynamic/config/<table>.json`，以及 `<Table>.types.ts`、`<Table>.table.ts`、`tables.ts`。公开合同放 `contracts/generated/config`，私有合同放 `code/generated/config`。命名枚举另导出 `<Enum>.ts`，包含 `as const` 值对象和对应类型。TS 不嵌入整张数据表。

面板仅改写 `__config`，校验源文件摘要、保存备份，并逐项验证其他 ZIP 内容未改变；不会为了修改导出地址而重存数据页。并发框架写入互斥，旧草稿不能覆盖已变化的文件。

ExcelJS 只读取公式与缓存，不计算公式。缓存可用于预览，正式导出必须有与源文件及声明输入摘要匹配的重算快照。当前重算适配器需要 **Windows 桌面 Excel COM**，在独立副本中重算，不保存源工作簿。工作台可检测环境；本机已实际验证 `SUM(2,3,4)` 重算为 9 并生成匹配快照。任意外部链接或其他公式兼容性仍需用真实工作簿验收。

```ts
const table = await show.config.load(EntriesTable);
table.get(1);       // 不存在时为 undefined
table.require(1);   // 不存在时报错
table.has(1);
table.all();
table.by('category', 'normal'); // 仅限声明的索引

// 多分片时明确选择 Bundle。
const extra = await show.config.load(EntriesTable, {
    bundle: InventoryBundles.extra,
});
```

配置及嵌套数据只读；`loadMany` 成组加载失败会归还本次持有的资源。玩家存档、活动状态与当前时间属于运行时业务，不写回设计配置。

跨模块表在面板勾选“允许其他模块引用此表合同”，从该模块 `contracts/generated/config` 导入 Table，然后同样调用 `show.config.load(Table)`。唯一发布路由会自动定位资源包，不启动数据所属模块的业务工厂；同表多分片才必须指定 Bundle。公共表放普通 `common` 模块，当前 `EconomyTable` 就是示例。公共不等于常驻：页面、模块或账号 Scope 分别决定持有期限，多个调用者共享底层只读数据。

## 删除与恢复

默认包与其他资源包适用相同规则。预览检查模块依赖、Creator 引用、显式 TS 导入、已知逻辑名及 XLSX 引用；仍在使用的配置路由或绑定预制体会阻止单独删除资源包。

完整备份及摘要检查通过后，由 Creator 逐个删除资源，再删除经核验的空目录，避免 Windows 下整目录删除失败。每步写入恢复记录；失败停止自动生成并保留备份。恢复检查冲突，导入原元数据，核验每个 UUID，并恢复配置启用状态。

历史在 `.yzforge/trash` 与 `.yzforge/workbook-history`。不覆盖恢复位置的新内容；进程任意时刻崩溃仍可能需要根据记录处理。运行时拼接字符串和反射引用无法完整静态证明。

创建过程另在 `.yzforge/creations` 保存前后快照。失败后可在恢复页预览撤销，后续编辑或外部引用会阻止覆盖；只差生成的记录可在修复源文件后重试。缺少完整后快照的崩溃记录不会强行自动回滚。

## 时间

`app.time` 提供 `nowMs`、`nowSeconds`、`nowDate`、`snapshot`、`remainingMs`、`sync(owner)`、`resetSync()`、`requireNowMs`，以及 `calendar` 日期工具。服务器校时通过注入 `ServerTimeSource` 完成；默认只有本地估计时间，不伪称服务器时间。业务不直接覆写设备时间。

时间上下文的 `calendar` 与周期通知统一继承面板时区/日切规则；显式参数可覆盖，独立导入的纯 `calendar` 保持 UTC 默认值。有服务器源时默认自动校时、提前刷新、失败退避和前台恢复重试；`autoSync: false` 改为完全由业务控制。

```ts
show.time.onBoundary('day', onDay, { emitCurrent: true });
show.time.onBoundary('week', onWeek);
show.time.onBoundary('month', onMonth);
show.time.onBoundary('year', onYear);
show.time.afterPeriod({ unit: 'week', count: 1 }, onOneWeekLater);
show.time.everyPeriod({ unit: 'month', count: 1 }, onMonthly, { anchorMs });
show.time.at(deadlineMs, onDeadline);
```

自然周期变化和“从某日起满一周/月”是不同接口。后台不保证准点执行；恢复时合并错过的周期，时钟回退不重复通知已经过的期次，异步回调串行执行。跨重启由业务保存原始 anchor/deadline 和已经处理的业务标识；框架不会自动恢复内存中的回调，也不会自动发奖。

没有 `time.delay(60000)` 或通用循环定时器。清理超时及内部唤醒使用单调计时，与 UTC/日历分开。微信适配使用 `wx.getPerformance()`，默认按微秒转毫秒；目标 SDK 如果提供毫秒，明确选择相应单位。其他特殊宿主可通过 `AppOptions.clock` 注入适配器。

## 检查与验证

项目已配置 ESLint、Prettier 和 VS Code 工作区设置。脚本使用 **4 个空格**；JSON/Markdown 使用 2 个空格。保存时格式化并执行 ESLint 修复；新建脚本与生成脚本也使用同一份 Prettier 规则。场景、预制体、meta 和生成数据由 Creator/生成器维护。

在 VS Code 按 **Ctrl+Shift+B** 运行完整检查；**F5** 可输入 Creator 浏览器预览 URL，使用 Edge 调试。当前工作区使用 VS Code 的 `js/ts.*` 设置命名。安装、规则与操作说明见 [开发环境](docs/development.md)。

```text
npm run verify
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm test
npm run typecheck
npm run check
npm run generate
node tests/integration/verify-workbench.mjs
node tests/integration/verify-creation.mjs
node tests/integration/verify-preview.mjs
node tools/yzforge/cli.mjs formula-status
node tools/yzforge/cli.mjs audit-build --output build/wechatgame --platform wechatgame
```

集成检查需要开启本项目 Creator 与 Funplay MCP；预览检查还需要运行示例 Game View。工作台检查会临时创建测试模块、验证恢复并移入回收区，不用于生产游戏运行。构建前钩子检查生成产物、源码规则和 TypeScript。Creator 当前构建转换下，展开 Map/Set 等迭代器前使用 `Array.from`，检查器会提示。

预览验证时须保持 Game View 可见且运行。`app.inspect()` 可查看模块、UI、Scope 任务和资源/配置持有者。构建审计按真实输出统计字节、分包、同内容重复文件和 Bundle 依赖；预算见 `project-settings/build-budgets.json`，超限构建失败。统计的是未压缩磁盘输出，不是网络首屏或平台最终压缩包。

详见 [实现和验证范围](docs/implementation-status.md)、[完整设计规格](docs/framework-redesign.md)。小游戏/原生的设备、后台、缓存、平台权限与网络行为必须单独验证；代码分包与原生热更新不因资源分包可用而自动成立。
