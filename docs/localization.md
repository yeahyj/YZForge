# 多语言与语言资源包

多语言以**业务资源包**为单位维护。文案用 Excel；图片、音频等使用各语言 `dynamic` 下不含扩展名的相对路径作为 key，目录是资源对应关系的唯一来源。纯资源包不需要工作簿。专用语言包只承载其中一个业务包的一种语言，框架复用已有 Bundle、Assets、LeaseCache 和 Scope。

## 在工作台维护

1. 打开 **YZForge → 项目工作台 → 项目设置**，保存默认语言和支持语言，例如 `zh-CN, en`。
2. 进入 **多语言**，选择模块、业务资源包和语言。
3. 需要文案时勾选 **同时创建文案工作簿**，然后 **预览创建 → 创建并生成**。默认语言和其他语言统一放到 `localization/业务包/语言`，每种语言一个 Bundle。已有纯资源包也可用此操作添加文案工作簿。
4. 文案填写 Excel 的 `texts` 页；资源放入各语言相同相对位置，再选择 **校验并生成**。面板显示翻译数量、上次生成的资源数量及缺失资源的回退清单。

首次创建同时登记默认语言。以后增加语言，先保存项目支持语言，再到多语言页执行创建。已有工作簿会安全追加空语言列，保留原有文本、格式和其他工作表；不会复制默认文案冒充翻译。纯资源包不创建占位 Excel；声明了工作簿但文件丢失时仍然报错。写入会核对文件摘要、保留备份并使用临时文件替换，外部编辑导致预览过期时拒绝覆盖。

旧目录使用 **预览旧目录迁移 → 迁移并生成**，通过 Creator 移动，保留 UUID 和语言包身份。旧工作簿中的 `assets` 映射需要迁移到相同相对路径，并同步修改代码和组件中的资源键，再移除资源页；生成器会拒绝遗留映射，避免改表无效。普通资源改名仍通过 Creator/工作台完成，不手改 `.meta`。普通业务资源保留原有稳定键规则；语言资源改名或移动会改变路径键，各语言及引用需要同步调整。

```text
assets/game/modules/showcase/
├─ bundles/default/                      普通业务包，保持原位置
├─ localization/default/                 普通分组目录
│  ├─ zh-CN/                             中文 Bundle
│  └─ en/                                英文 Bundle
│     ├─ dynamic/images/greeting.png      示例图片，按需编目和加载
│     ├─ static/                         仅供此包内资源静态引用
│     ├─ yz-index.json                   自动生成的物理资源索引
│     └─ yz-locale.json                  自动生成的文案、字体和路径资源索引
└─ contracts/generated/localization-default.ts

config-source/showcase/localization-default.xlsx   可选，仅维护全部语言的文案
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

工作台在基包的 `module.json` 声明中写入工作簿与存放位置（纯资源包省略 `source`）：

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

不随语言变化的图片、字体仍放普通公共包直接使用。共用的多语言图片可放公共模块的语言包，组件通过“跨包引用”选择该业务包，代码通过 `i18n.use` 获取该包。跨语言直接引用被拒绝，缺失版本回退默认语言。

## 资源路径规则

`zh-CN/dynamic/images/greeting.png` 与 `en/dynamic/images/greeting.jpg` 对应同一个 key：`images/greeting`。不包含模块、业务包、语言、`dynamic` 和扩展名；资源归属由当前业务包确定。大小写保持实际路径，推荐小写英文，目录分隔符统一使用 `/`。

- 只编目 `dynamic` 入口，`static` 依赖和生成文件不参与语言对应。
- 图片优先使用 SpriteFrame；没有精灵帧的纹理使用 Texture2D，不把同一图片的底层 ImageAsset、Texture2D 重复暴露。图集精灵帧使用 `图集相对路径/子图片名`。
- 同一种语言的 key 必须唯一，包括去扩展名冲突和大小写冲突。不同语言相同 key 的资源类型必须一致。
- 默认语言提供全部普通资源 key。其他语言缺少文件时回退默认语言，缺失项由校验和面板列出；默认语言缺少对应项、已有文件类型错误或实际加载失败仍报错。未提供和已删除的版本统一按缺失处理，不保存历史配对记录。
- 改名、移动就是修改 key。组件的旧 key 在生成时检查；代码优先使用生成的路径键，动态拼接路径由业务自行同步。使用 Creator 覆盖同路径内容时语言 key 不变。
- `dynamic/fonts/default.ttf`（或其他受支持字体格式）是可选的该语言默认字体，不作为普通资源 key 输出。当前语言未设置时使用默认语言字体，两者都未设置时保留 Label 原有字体。文案回退时按实际文案语言选择字体。其他路径的字体作为普通语言资源提供，不自动切换 Label 的字体角色。

运行时读取生成索引并通过现有 Assets 加载；不会扫描文件夹或维护另一套资源管理器。

## 工作簿格式

语言工作簿由 `__localization` 的 `formatVersion = 2` 识别，和普通配置表的 `__config` 分开处理；没有类型行、主键行或公式求值。工作簿只保存文案，其归属不重复填写。旧版本 1 的纯文案工作簿仍可读取，有内容的旧 `assets` 页会报迁移提示。

| 工作表  | 固定列           | 后续列                 |
| ------- | ---------------- | ---------------------- |
| `texts` | `key`、`comment` | `zh-CN`、`en` 等语言列 |

文案键示例 `resources.title`、`resources.progress`。内容保留首尾空格、换行和 Unicode；数字必须作为 Excel 文本填写，公式、重复键、生成标识冲突、参数不一致均拒绝导出。语言表头不能留空或带首尾空格，中间空列会按工作表和单元格位置报错；正文中的空单元格仍按下列规则处理。

- 空单元格：未翻译，回退默认语言。
- `#EMPTY`：有意输出空字符串，也算有效翻译。
- `##EMPTY`：输出字面量 `#EMPTY`；需要以 `#` 开头的保留写法可使用双 `#` 转义。
- `{count}`：参数，值只能为字符串或有限数字；`{{`、`}}` 表示字面大括号。
- 默认语言必须覆盖全部文案和资源键，不提供“返回键名”来掩盖漏配。

图片、字体和音频文件仍由 Creator 管理。不要在业务预制体里静态引用全部语言资源；生成的语言目录只保存键，不形成所有语言包的静态依赖。

## 页面与组件

### 编辑器固定配置

在 Label 所在节点添加 **YZForge → 多语言 → 文字绑定（LocalizedLabel）**；在 Sprite 所在节点添加 **图片绑定（LocalizedSprite）**。两者沿用原生检查器，填写：

- **语言键**：文字填写 Excel 的原始 key，如 `example.welcome`；图片填写相对路径，如 `images/greeting`。
- 文字可填写 **固定参数**，如 `name = YZForge`；变化的计数使用下面的代码绑定。
- **跨包引用** 默认关闭，框架按源预制体/场景所在的业务资源包自动确定词条库。引用其他包时再打开并填写 **词条来源**，如 `common/default`。

源资源 UUID 与业务包的对应关系随发布清单生成；共享/嵌套预制体被其他模块使用时仍保留源资源归属。移动资源后重新生成即可，不按调用方模块或全项目同名 key 猜测。未放入业务资源包的独立场景需要显式选择词条来源。已有预制体保存的 `namespace` 仍作为跨包覆盖兼容，关闭“跨包引用”即可改为自动。

组件自动接入框架显示期限。绑定组件保存语言键；原生组件可保存面板应用的初始内容，运行时仍按当前语言通过 Assets 加载。挂载到框架 UI、托管 Prefab/Part 或 `app.bindScene` 管理的节点即可，无需另写页面绑定代码。

在 **YZForge → 项目工作台 → 多语言 → 应用语言到界面** 中选择目标语言，点击 **应用语言**。语言下拉来自项目配置。可更新当前预制体/场景、选中节点及子节点，或明确选择业务资源包批量更新。普通更新自动识别源资源归属，不需要再选择业务包。

当前范围通过 Creator 原生属性操作直接修改 Label 文字、Sprite 图片和语言默认字体，支持一次 Ctrl+Z 撤销和 Ctrl+S 保存。所有语言键、固定参数和资源先验证，失败不留下部分更新。保留颜色、字号、Label 溢出模式和 Sprite 尺寸模式；原生自适应尺寸随新内容正常计算。无语言字体时保留普通字体；上次应用的语言字体没有对应映射时改用系统字体，需要固定默认字体时放入默认语言的 `dynamic/fonts/default`。

批量范围先点击 **检查批量范围** 查看文件，再点击 **应用语言** 直接保存。未保存的目标资源会阻止批量覆盖。**恢复批量更新** 可恢复已有记录；检测到后续编辑时停止恢复并保留当前文件。批量只修改源资源中的绑定，不改嵌套实例覆盖；跨包嵌套预制体在自身所属资源包更新，有覆盖的实例可使用当前场景范围更新。

应用后的内容是真实资源数据，重新选中节点或重启编辑器不会自动还原。修改词条或固定参数后再次点击应用即可。组件不再提供自动预览、每帧预览检查或保存拦截，面板操作完全位于编辑器扩展。运行时仍根据保存的语言键和全局语言绑定，不把面板选择当成游戏启动语言。

框架 UI 首次显示、恢复显示时，会等待当前启用的原生语言绑定完成，成功后才显示并开放交互；准备期间保留上一页，失败或取消不提交新页面。已经接入宿主的语言组件重新启用时会先隐藏自身 Label/Sprite，准备完成后恢复原来的启用状态。运行中切换语言继续保留旧内容，待所有新内容准备完成后统一提交。

运行中用 `addComponent` 新增组件，需要显式接入，框架不会每帧扫描节点。先在 inactive 节点上设置组件和语言键，将节点挂在当前界面内，再接入：

```ts
await show.assets.bindComponents(node); // 只绑定新增组件，重复调用安全
node.active = true;
await show.assets.bindComponents(node); // 等待本次启用的语言资源就绪
```

通过 Assets 创建的实例同样可用其所属 Scope 的资源入口；实例池使用 `ctx.assets.in(lease.scope)`。普通场景先调用 `app.bindScene`，之后使用返回的宿主 Scope。嵌套框架实例保留自己的宿主，不把已有组件转交给另一实例。未接入就启用的语言组件会报告 `I18N_HOST_MISSING`，保留原显示内容，之后仍可显式接入。

发布前将界面应用为项目默认语言并保存。默认语言图片/字体成为预制体的基础依赖；其他语言玩家可能同时加载这份基础资源与当前语言资源。这是手动应用方案接受的取舍。构建前会定位遗留的其他语言直接引用，面板更新不改变打包语言列表；目前构建按已登记语言包输出，没有独立的“本次构建仅包含指定语言”选项。

### 代码动态绑定

目录、强类型文案键和语言资源键由生成器生成到 `contracts/generated/localization-业务包.ts`，路由自动进入 ContentRelease。**GameRoot 不导入或登记业务语言目录。** App 启动只选择默认语言，首次 `use` 才准备该业务包的当前与默认目录。

```ts
const language = await show.i18n.use(ShowcaseBundles.default);

await language.bindText(this.lblTitle, ShowcaseI18n.text.resourcesTitle);
await language.bindSprite(this.sprLogo, ShowcaseI18n.asset['images/logo']);
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

`bindText` 支持普通 Label 和 MarqueeLabel；滚动文字直接传公开组件，不要绑定它内部的 Label。CountdownLabel 使用 `bindCountdownFormat(timer, key)`，文案中的 `{hh}`、`{mm}`、`{ss}`、`{seconds}` 由计时器填写，其他参数照常传值或回调。切换语言会立即刷新文字及字体，不改变截止时间，计时结束后也能刷新且不重复触发完成事件。模板绑定期间不能再传自定义 `format`。

```ts
await language.bindText(this.compMarquee, GameI18n.text.notice);
// 词条示例：中文“剩余 {seconds} 秒”，英文“{seconds} seconds left”。
await language.bindCountdownFormat(this.lblCountdown, GameI18n.text.remaining);
this.lblCountdown.startFor(30);
```

原生 LocalizedLabel 面板绑定适用于普通 Label；CountdownLabel 和 MarqueeLabel 使用上述代码入口，不叠加 LocalizedLabel。语言图片用 Sprite + LocalizedSprite 或 `bindSprite`；AsyncSprite 已自行管理加载，不能同时接受语言图片绑定。这些冲突会在生成检查和运行绑定时明确报错。

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

构建审计读取实际输出，检查语言包是否缺失，并遍历所有包的传递依赖：普通业务包允许静态依赖默认语言包，拒绝依赖非默认语言包；不同语言包不能相互静态依赖，同语言公共资源允许共用。引擎 Bundle 记录按现有规则保持；关闭使用期限会归还实际资源与字典持有，已请求 Bundle 的列表不代表资源仍被持有。

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
node tests/integration/verify-localization-update.mjs
node tests/integration/verify-localization-ready.mjs http://127.0.0.1:7456/
node tests/integration/verify-localization-workbench.mjs
node tests/integration/verify-localization-paths.mjs
node tests/integration/verify-resources-localization.mjs http://127.0.0.1:7456/
```

预览端口以当前 Creator 的预览地址为准。
