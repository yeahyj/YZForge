# 多语言与语言资源包

多语言以**业务资源包**为单位维护。同一模块里的 `default`、`shop` 等资源包可以各自有独立工作簿；专用语言包只承载其中一个业务包的一种语言。框架复用已有 Bundle、Assets、LeaseCache 和 Scope，不另建加载系统。

## 在工作台维护

1. 打开 **YZForge → 项目工作台 → 项目设置**，保存默认语言和支持语言，例如 `zh-CN, en`。
2. 进入 **多语言**，选择模块、业务资源包、语言和存放方式。
3. **预览创建**后执行 **创建并生成**。可以放在业务包内部，也可以创建专用语言包。
4. 打开生成的 Excel，填写文案与资源映射，再选择 **校验并生成**。面板显示各语言的翻译数量和存放位置。

首次创建同时登记默认语言。以后增加语言，先保存项目支持语言，再到多语言页执行创建。已有工作簿会安全追加空语言列，保留原有文本、格式和其他工作表；不会复制默认文案冒充翻译。写入会核对文件摘要、保留备份并使用临时文件替换，外部编辑导致预览过期时拒绝覆盖。

已有语言的存放位置不由“创建”覆盖。调整包归属需要显式迁移和重新校验。普通资源改名应通过 Creator/工作台完成，不手改 `.meta`。同包改名保留 UUID 和物理资源逻辑键；跨包移动被拦截，需同步更新资源身份和所有引用后迁移，不能只拖动文件再忽略生成错误。

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
    "variants": { "zh-CN": "default", "en": "default-en" }
  }
}
```

`default-en` 是同一模块下正常的资源 Bundle，其归属由上面的映射推导。一个专用包不能同时承载两个业务包/两种语言，也不能作为另一个基包、包含普通配置表或业务界面。公共图片、字体仍可引用现有公共资源键。

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

删除预览检查语言归属、UUID/逻辑键引用。删除整个模块会安全停用其工作簿，恢复时还原原配置；存在其他模块语言引用时阻止删除。删除单个基包或专用语言包前需先解除/迁移语言声明。

构建审计读取实际输出，检查语言包是否缺失、基包是否静态依赖专用语言包，同时保留现有体积和重复文件报告。引擎 Bundle 缓存按现有规则保持；发布更新需要重启运行时，不在同一运行会话混换发布清单。

当前实现不包含 ICU 复数、地区数字/日期格式、富文本自动转义和 RTL 排版；字体文件必须包含实际展示字符。

## 示例与验证

Bootstrap 首页 → **资源准备、实例池与多语言**：中文目录在 `showcase/default`，英文目录在专用 `showcase/default-en`；英文缺一条翻译以演示默认语言回退。文案来源是 `config-source/showcase/localization-default.xlsx`。按钮、图标和池内实例随语言一起更新，归还的实例不保留旧绑定。

实现见 [ResourceLabPage.ts](../assets/game/modules/showcase/code/ui/ResourceLabPage.ts)。

```sh
npm run verify
node tests/integration/verify-resources-localization.mjs http://127.0.0.1:7457/
```

预览端口以当前 Creator 的预览地址为准。
