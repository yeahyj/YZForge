# 多语言与语言资源包

多语言以**业务资源包**为单位维护。同一模块里的 `default`、`shop` 等资源包可以各自有独立工作簿；专用语言包只承载其中一个业务包的一种语言。框架复用已有 Bundle、Assets、LeaseCache 和 Scope，不另建加载系统。

## 在工作台维护

1. 打开 **YZForge → 项目工作台 → 项目设置**，保存默认语言和支持语言，例如 `zh-CN, en`。
2. 进入 **多语言**，选择模块、业务资源包和语言。
3. **预览创建**后执行 **创建并生成**。默认语言和其他语言统一放到 `localization/业务包/语言`，每种语言一个 Bundle。
4. 打开生成的 Excel，填写文案与资源映射，再选择 **校验并生成**。面板显示各语言的翻译数量和存放位置。

首次创建同时登记默认语言。以后增加语言，先保存项目支持语言，再到多语言页执行创建。已有工作簿会安全追加空语言列，保留原有文本、格式和其他工作表；不会复制默认文案冒充翻译。写入会核对文件摘要、保留备份并使用临时文件替换，外部编辑导致预览过期时拒绝覆盖。

旧项目使用 **预览旧目录迁移 → 迁移并生成**。工具通过 Creator 移动目录和语言文件，保留 UUID、已有语言包 ID 和资源分组；迁移记录保存在 `.yzforge/editor-history`，随后清理已确认无内容、无引用的旧空目录。普通资源改名仍通过 Creator/工作台完成，不手改 `.meta`。同包改名保留资源键；跨包移动需要显式更新身份和所有引用。

```text
assets/game/modules/showcase/
├─ bundles/default/                      普通业务包，保持原位置
├─ localization/default/                 普通分组目录
│  ├─ zh-CN/                             中文 Bundle
│  └─ en/                                英文 Bundle
│     ├─ dynamic/images/greeting.png      示例图片，按需编目和加载
│     ├─ static/                         仅供此包内资源静态引用
│     ├─ yz-index.json                   自动生成的物理资源索引
│     └─ yz-locale.json                  自动生成的文案、字体和图片映射
└─ contracts/generated/localization-default.ts

config-source/showcase/localization-default.xlsx   全部语言共用的源工作簿
```

`localization` 和业务包分组目录均不标记 Bundle，真正的包根目录互不嵌套。`dynamic`、`static` 沿用框架已有含义；图片、字体、音频分类按需要创建。只有文案也使用相同目录，无需放入占位图片。

## 唯一归属声明

项目的 `project-settings/framework.json` 保存语言列表：

```json
"localization": {
  "defaultLocale": "zh-CN",
  "locales": ["zh-CN", "en"]
}
```

工作台在基包的 `module.json` 声明中写入工作簿与存放位置：

```json
"default": {
  "id": "m-showcase",
  "root": "bundles/default",
  "localization": {
    "source": "config-source/showcase/localization-default.xlsx",
    "locales": { "zh-CN": {}, "en": {} }
  }
}
```

实际语言 Bundle 由此声明派生，不再重复登记在普通 `bundles` 中。默认物理 ID 为 `模块-业务包-语言`（小写），目录保留标准语言大小写。`locales.en` 内可由迁移工具保存 `id`、`group` 以保留旧身份；平时通过面板维护即可。普通页面、配置表和预制体的目标只显示业务包。

公共中性图片、字体仍放普通公共包；专属语言字体等可以跨业务包引用**同语言**公共包的资源键。跨语言直接引用被拒绝，缺译使用明确的默认语言回退。

## 工作簿格式

语言工作簿由 `__localization` 识别，和普通配置表的 `__config` 分开处理；没有类型行、主键行或公式求值。工作簿只保存内容，其归属不重复填写。

| 工作表   | 固定列                   | 后续列                 |
| -------- | ------------------------ | ---------------------- |
| `texts`  | `key`、`comment`         | `zh-CN`、`en` 等语言列 |
| `assets` | `key`、`type`、`comment` | 相同顺序的语言列       |

文案键示例 `resources.title`、`resources.progress`。内容保留首尾空格、换行和 Unicode；数字必须作为 Excel 文本填写，公式、重复键、生成标识冲突、参数不一致均拒绝导出。语言表头不能留空或带首尾空格，中间空列会按工作表和单元格位置报错；正文中的空单元格仍按下列规则处理。

- 空单元格：未翻译，回退默认语言。
- `#EMPTY`：有意输出空字符串，也算有效翻译。
- `##EMPTY`：输出字面量 `#EMPTY`；需要以 `#` 开头的保留写法可使用双 `#` 转义。
- `{count}`：参数，值只能为字符串或有限数字；`{{`、`}}` 表示字面大括号。
- 默认语言必须覆盖全部文案和资源键，不提供“返回键名”来掩盖漏配。

资源类型填写 `SpriteFrame`、`Font`、`AudioClip` 等已有 AssetKind。单元格填写 Creator UUID，精灵帧须包含子资源后缀；也可填写 `@模块/包/类型/逻辑路径`，引用已生成的公开资源键。UUID 引用在同包改名后仍有效。`assets` 中特殊行 `$font` / `Font` 定义整种语言的字体；没有字体行时保留 Label 的原始字体设置。某条文案回退中文时使用中文目录的字体。

图片、字体和音频文件仍由 Creator 管理。不要在业务预制体里静态引用全部语言资源；生成的语言目录只保存键，不形成所有语言包的静态依赖。

## 页面与组件

### 编辑器固定配置

在 Label 所在节点添加 **YZForge → 多语言 → 文字绑定（LocalizedLabel）**；在 Sprite 所在节点添加 **图片绑定（LocalizedSprite）**。两者沿用原生检查器，填写：

- **语言键**：Excel 的原始 key，如 `example.welcome` 或 `example.greeting`。
- 文字可填写 **固定参数**，如 `name = YZForge`；变化的计数使用下面的代码绑定。
- **跨包引用** 默认关闭，框架按源预制体/场景所在的业务资源包自动确定词条库。引用其他包时再打开并填写 **词条来源**，如 `common/default`。

源资源 UUID 与业务包的对应关系随发布清单生成；共享/嵌套预制体被其他模块使用时仍保留源资源归属。移动资源后重新生成即可，不按调用方模块或全项目同名 key 猜测。未放入业务资源包的独立场景需要显式选择词条来源。已有预制体保存的 `namespace` 仍作为跨包覆盖兼容，关闭“跨包引用”即可改为自动。

组件自动接入框架显示期限。固定配置只保存语言键，图片仍按当前语言通过 Assets 加载。挂载到框架 UI、托管 Prefab/Part 或 `app.bindScene` 管理的节点即可，无需另写页面绑定代码。

选择节点后，**预览语言** 下拉显示项目默认和已配置语言，选择后直接更新预制体/场景视图中的原生 Label 文字和 Sprite 图片；修改语言键、固定参数及撤销编辑也自动刷新。新增项目语言后重新选中节点即可读取最新选项。切换选中节点、禁用或删除绑定时还原原始内容。预览保持节点原有尺寸；Label 的自动扩展模式临时按原边框裁剪，Sprite 临时使用自定义尺寸，实际运行仍沿用原生尺寸模式。

画面预览兼容 Creator 3.8 保存时先复制节点再序列化的流程：保存、撤销快照和脚本重载均读取原始属性，不写入临时文字、图片引用、尺寸模式或预览语言。原生字体、颜色和其他样式保持原配置；预览期间对原生组件所做的真实编辑仍会保留。生成时检查已保存组件中的自动归属/显式来源、语言键、图片类型和固定参数，并定位到文件与节点。

框架 UI 首次显示、恢复显示时，会等待当前启用的原生语言绑定完成，成功后才显示并开放交互；准备期间保留上一页，失败或取消不提交新页面。动态新增或重新启用的语言组件会先隐藏自身 Label/Sprite，准备完成后恢复原来的启用状态，避免短暂显示旧文字或旧图片。运行中切换语言继续保留旧内容，待所有新内容准备完成后统一提交。

预览选了 `en` 不会导致中文运行时先请求英文包。业务 Sprite 不应直接静态引用语言包内图片；需要固定英文 Logo 等不随语言切换的内容时，将其作为普通资源使用。目前构建按已登记语言包输出，没有独立的“本次构建仅包含指定语言”选项，不能直接删除英文构建文件代替配置停用。

### 代码动态绑定

目录、强类型文案键和语言资源键由生成器生成到 `contracts/generated/localization-业务包.ts`，路由自动进入 ContentRelease。**GameRoot 不导入或登记业务语言目录。** App 启动只选择默认语言，首次 `use` 才准备该业务包的当前与默认目录。

```ts
const language = await show.i18n.use(ShowcaseBundles.default);

await language.bindText(this.lblTitle, ShowcaseI18n.text.resourcesTitle);
await language.bindSprite(this.sprLogo, ShowcaseI18n.asset.resourcesLogo);
const status = await language.bindText(this.lblStatus, ShowcaseI18n.text.resourcesProgress, {
    completed: 0,
    total: 10,
});
status.update({ completed: 3, total: 10 });

await show.i18n.setLocale('en');
```

需要动态计算参数时传同步函数；切换提交前读取最新值：

```ts
const binding = await language.bindText(this.lblStatus, ShowcaseI18n.text.resourcesProgress, () => ({
    completed: this.completed,
    total: this.total,
}));
// 数值改变后立即刷新当前语言。
binding.refresh();
```

生成的参数名参与 TypeScript 检查。`language.t(key, params)` 同步取文案，`language.asset(key)` 返回当前资源键。普通业务服务可用 `app.i18n.use(Bundle, owner)` 获得目录；实际资源继续用 `assets.load(key, owner)` 加载。语言资源键与物理 AssetKey 分开，不能直接把前者传给 Assets。

UIView 用 `show.i18n`，GameComponent 用 `activation.i18n`。实例池和虚拟列表使用 `show.i18n.in(lease.scope)` / 条目自己的使用期限。绑定在隐藏、挂起、失活或归还时注销并恢复目标原始属性；同一 Label 或 Sprite 只能有一个多语言绑定，重新绑定会使旧句柄失效。不要用实例或节点销毁期限代替显示/条目期限。

同一资源包、语言、合同与内容版本的只读字典通过 LeaseCache 共享，多个页面和列表条目不会重复解析或复制整份字典。各条目仍有独立绑定与资源持有；关闭一个条目不影响其他使用者，最后一个使用者结束后回收字典及其 JSON 持有。当前目录与默认目录的兼容性也只在共享期间校验一次。

## 切换合同

`setLocale()` 成功表示当前所有已使用目录和框架绑定的文本、字体、图片已准备并同步提交。只准备实际绑定需要的资源，不预加载整个业务包。

- 新内容下载或校验失败：保留原目录和原绑定。
- 尚未提交的连续请求：最后请求获胜；切回已提交的语言也会取消在途请求。
- 切换期间的新 `use`/绑定：等待切换稳定后准备；首次绑定若被旧快照回收打断，且使用者仍有效，会在新快照下重试。晚到结果不能覆盖新显示，页面关闭或真实加载失败仍正常取消或报错。
- 页面关闭/实例归还：从本次切换移除，迟到结果不接触旧节点。
- 提交后的旧资源清理异常：单独上报 `I18N_PREVIOUS_CLEANUP_FAILED`，不把成功切换改成失败。切换返回仍等待这次清理；提交后的调用者取消不撤销语言。

回退只有“当前语言 → 项目默认语言”，没有隐式地区链。未登记的项目语言报错；业务包没有某个已支持语言的目录时整体回退。已登记目录的下载失败、格式损坏或合同/数据版本不一致都报错，不伪装成缺译。

直接取得的文本快照和已加载资源由调用方自己管理，不会随绑定自动改写。已播放音频不重播，已创建预制体不重建。框架不调用 releaseAll/removeBundle，也不改变共享存档规则。语言偏好存档、设备语言选择由游戏在支持语言中选择后调用 `app.i18n.setLocale(locale, owner)`。

## 生成、删除与构建

工作簿、目录 JSON、强类型键、路由属于同一套生成流程，输出使用现有事务与恢复机制。目录携带合同版本和内容版本；正式构建先校验生成结果，旧目录不能与新路由混用。生成目录不会再次被当作普通动态 JSON 编目。

**删除与恢复 → 停用一种语言** 会预览并备份该语言目录与生成键，解除该语言声明，保留 Excel 翻译列；该列暂不参与资源存在性检查，运行时回退默认语言。可从原删除记录恢复资源、UUID 和声明。默认语言不能单独停用。

**停用业务包多语言** 同时归档其语言包、停用工作簿；若页面代码或原生组件仍使用这些键，预览会阻止操作。删除整个模块同样停用对应工作簿，恢复时还原配置。跨业务包共用资源仍须通过引用检查，不能删除其他使用者正在依赖的内容。

构建审计读取实际输出，检查语言包是否缺失，并遍历所有包的传递依赖：普通业务包不能静态依赖任何语言包，不同语言包不能相互静态依赖，同语言公共资源允许共用。引擎 Bundle 记录按现有规则保持；关闭使用期限会归还实际资源与字典持有，已请求 Bundle 的列表不代表资源仍被持有。

当前实现不包含 ICU 复数、地区数字/日期格式、富文本自动转义和 RTL 排版；字体文件必须包含实际展示字符。

## 示例与验证

Bootstrap 首页 → **多语言示例 · 动态与编辑器配置**：

| 示例     | 查看位置                     | 行为                                              |
| -------- | ---------------------------- | ------------------------------------------------- |
| 动态文字 | `LocalizationLabPage.ts`     | 点击累加参数，中英文切换保留当前计数              |
| 动态图片 | 同上，`bindSprite`           | 按需加载、重新绑定，切换后更新图片                |
| 固定文字 | Prefab 的 `StaticText` 节点  | 原生 `LocalizedLabel` 保存键与固定参数            |
| 固定图片 | Prefab 的 `StaticImage` 节点 | 原生 `LocalizedSprite` 保存键，与动态示例共用资源 |

示例 Prefab 为 `assets/game/modules/showcase/bundles/default/dynamic/ui/LocalizationLabPage.prefab`。图片位于 `localization/default/zh-CN` 和 `localization/default/en`，文案来自 `config-source/showcase/localization-default.xlsx`。

原 **资源准备、实例池与多语言** 页继续演示批量准备、实例池和缺译回退；归还实例不保留旧绑定。

实现见 [LocalizationLabPage.ts](../assets/game/modules/showcase/code/ui/LocalizationLabPage.ts) 和 [ResourceLabPage.ts](../assets/game/modules/showcase/code/ui/ResourceLabPage.ts)。

```sh
npm run verify
node tests/integration/verify-localization-examples.mjs http://127.0.0.1:7456/
node tests/integration/verify-localization-inspector.mjs
node tests/integration/verify-localization-ready.mjs http://127.0.0.1:7456/
node tests/integration/verify-localization-workbench.mjs
node tests/integration/verify-resources-localization.mjs http://127.0.0.1:7456/
```

预览端口以当前 Creator 的预览地址为准。
