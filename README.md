# YZForge

面向 Cocos Creator 3.8.8 的通用游戏框架。运行时放在 `assets/framework`，Creator 工作台放在 `extensions/yzforge-editor`，生成工具放在 `tools/yzforge`。`assets/game` 当前是一套可以替换的演示应用，不是框架必须具备的游戏结构。

框架不内置大厅、战斗、章节、关卡、奖励、签到或商业化规则。模块组织业务边界，Cocos Bundle 组织资源交付，Scope 管理使用期限。没有运行时 Extension 安装体系，也没有另一套 ContentPack 对象体系。

## 开始使用

1. 用 Creator **3.8.8** 打开本目录；安装 **Node.js ≥ 22.7**，执行 `npm ci`。
2. 在扩展管理器中启用项目扩展 `yzforge-editor`，打开菜单 **YZForge → 项目工作台**。
3. 打开 `assets/game/boot/Bootstrap.scene`，运行预览。当前示例演示 UI、配置、动态图片、音频和日历查询。
4. 在工作台的“项目设置”中配置稳定的应用标识、音频分组、日历和绑定规则。应用标识决定本地存档前缀，正式使用后保持稳定。
5. 创建自己的模块和资源包，替换 `GameRoot.onBoot` 的启动流程。删除示例前，先移除对示例的导入和配置表映射，再使用工作台的删除预览。

设计分辨率和横竖屏属于 Creator 项目设置。新建 UI 读取这些设置；框架不修改它们。现有演示的 `720×1280` 和 SHOW_ALL 只存在于演示启动代码中。

## 工作台

| 页面 | 可用操作 |
| --- | --- |
| 模块与资源包 | 创建普通模块或纯代码模块、添加资源包、声明依赖、创建节点组件与普通服务 |
| 界面与绑定 | 在指定资源包创建 UI 预制体及配套脚本、按节点命名生成 Binding 并写入引用 |
| 动态资源清单 | 用 UUID 登记类型和逻辑名、保留 UUID 移动文件 |
| 配置表 | 创建 CSV 模板、登记 XLSX/CSV、预览校验结果、导出、移除导入项 |
| 项目设置 | 应用标识、清理超时、音频分组、日历规则、绑定前缀及平台计时单位 |
| 删除与恢复 | 预览模块/UI/资源包/脚本的文件与引用，移入回收区，按记录 ID 恢复 |

创建、删除、调整声明后，点击“生成资源目录与配置”，再“检查项目”。源配置在 `config-source`；生成的 JSON 进入声明的 Bundle，TS 类型和引用进入模块的 `generated`。不编辑生成文件。移除导入项后，有旧生成文件需要回收时使用工作台生成；CLI 会要求先在编辑器检查引用。

删除检查包括序列化资源引用、显式 TS 导入和逻辑名引用；运行时拼接字符串无法被静态检查完整证明。被引用时会说明位置，不会直接强制删除。恢复不覆盖原位置的新文件，也不覆盖删除后又被修改的模块清单。历史与回收文件位于 `.yzforge`。

## 自动绑定和生命周期

节点命名例如 `btn_confirm`、`lbl_title`、`spr_icon`、`node_content`。前缀到组件类型的映射在项目设置中维护。工作台生成隐藏序列化字段与受保护 getter，并由 Creator 写入引用，**不需要手动拖节点**。同一绑定范围内重名、缺少对应组件会报错；嵌套 Prefab 的内部不由外层自动扫描。

业务继承 `ExampleViewBinding`，Binding 继承 `UIView<ExampleViewParams, ExampleViewResult>`。参数和结果由业务自行定义，初始模板使用 void。

| 对象 | 业务钩子 |
| --- | --- |
| `UIView` | `onCreate`、`onShow`、`onHide`、`onDispose`、`onTick`、`onLateTick` |
| `GameComponent` | `onInit`、`onActivate`、`onReady`、`onTick`、`onLateTick`、`onDeactivate`、`onDispose` |
| `AppEntry` | `appOptions`、`onBoot`、`onBootFailed` |

业务不覆盖引擎的 onLoad/start/onEnable/update 等入口，不依赖调用 super 来补救顺序。组件钩子同步执行，异步工作用 `activation.run`；UI 的 onCreate/onShow/onHide 可以异步。使用捕获的 `show` 或 `activation`，提交异步结果前调用其 `commit`。不要在正在关闭的界面回调里等待自己的 `handle.close()`；按钮结束界面调用 `show.finish(result)`。页面返回按钮使用 `void ctx.ui.back()`。

## 常用 API

下面的 `ctx` 是注入的 ModuleContext，`show` 是当前显示周期的 ViewShowContext；实际导入路径以工作台生成的文件为准。

```ts
// 当前模块默认命名空间。类型写为 AssetKind 字符串。
const assets = ctx.assets.in(show.scope);
const address = await assets.resolve('icon', 'SpriteFrame');
const frame = await assets.load('icon', 'SpriteFrame');
await show.setSprite(this.sprIcon, ExampleRes.sprite.icon);

// 完整逻辑名跨模块区分重名；同名 SpriteFrame / Texture2D 也分开。
await assets.load('common/default/sprite/icon', 'SpriteFrame');

// ViewKey 自动携带 Params/Result 类型，不导入真实 Prefab 或 View 类。
const popup = await ctx.ui.open(ExampleViews.exampleView, params, show.scope);
const result = await popup.result;
if (result.status === 'completed') show.commit(() => applyResult(result.value));

const sound = await ctx.audio.play(ExampleRes.audio.confirm, show.scope);
await sound.ended;
ctx.audio.setVolume('sfx', 0.5);
```

逻辑资源标识是 `<module>/<group>/<kind>/<name>`。短名只在当前命名空间解析，不自动搜索所有模块。静态序列化引用和动态加载可以使用同一资源；清单不会复制资产，也不会让静态引用自动变为按需加载。框架持有自己的引用，不调用 `releaseAll` 清空其他使用者的资源。

登记图集帧时，选择 SpriteFrame 类型，使用 SpriteAtlas 的 UUID 并填写帧名。一次加载同时持有图集与该帧的引用，随所属 Scope 释放。

模块通过 `app.modules.use(ModuleRef, owner)` 获得有使用期限的公开 API。运行依赖声明在 `module.json`；事实通知使用 `eventKey<T>`、`ctx.events.on(key, handler, owner)`、`emit(key, data)`。UI 之间优先使用参数和结果，不访问其他界面的内部节点。长于当前 UI 的流程使用独立的流程 Scope。

`Scope.close()` 先取消，再等待登记任务和真实清理。`defer` 返回撤销登记的函数。清理超时只能报告并隔离尚未排空的实例，不能杀死 Promise 或提前释放其资源。

## 配置表

输入支持 UTF-8 CSV、XLSX 的指定 Sheet。四行表头依次为 **字段名、类型、默认值、说明**，第五行起是数据。字段名以字母开头，使用字母和数字；`#` 开头或空表头的列忽略。布尔值接受 true/false、1/0；false 与 0 不按空值处理。字符串 ID 应使用文本单元格以保留前导零。

支持：`int`、`float`、`bool`、`string`、`enum<a,b>`、`ref<table>`、`asset<SpriteFrame>` 等资源引用、`vec2`、`vec3`、`color`，以及这些类型的一维 `[]` 与末尾 `?` 可空标记。数组填写 JSON；向量填写 `[x,y]` / `[x,y,z]`；颜色填写 `#RRGGBB` / `#RRGGBBAA`。日期使用 string 加 `format: date` / `date-time` 约束；带时间的 ISO 文本必须明确偏移。暂不处理公式、Excel 日期值、富文本或数据区合并单元格。

面板高级选项可声明主键、唯一/非唯一单字段索引、范围/长度约束、外键以及分片字段与资源包映射。分片字段由用户指定，不预设章节等业务含义。导出前检查跨分片主键、外键与资源逻辑名。强引用不隐式拉取其他分片；跨模块外键需要声明模块依赖。

输出为每个目标包内的 JSON，以及 `<Table>.types.ts`、`<Table>.table.ts`、`tables.ts`。TS 只有类型、表合同与引用，**不包含整张数据表**。

```ts
const table = await ctx.config.load(EntriesTable, show.scope);
table.get(1);        // 不存在时为 undefined
table.require(1);    // 不存在时报错
table.has(1);
table.all();
table.by('category', 'normal'); // 仅可查询声明过的索引

// 同一张表有多个分片时，必须明确目标资源包。
const extra = await ctx.config.load(EntriesTable, show.scope, {
  bundle: ExampleBundles.extra,
});
```

配置行及嵌套值只读。保存数据、当前时间、玩家状态不写回配置表。`loadMany` 在一组加载失败时回收这次取得的使用权。

## 时间

`app.time` 提供 `nowMs`、`nowSeconds`、`nowDate`、`snapshot`、`remainingMs`、`sync(owner)`、`resetSync()`、`requireNowMs`，以及 `calendar` 日期工具。服务器校时通过注入 `ServerTimeSource` 完成；默认只有本地估计时间，不伪称服务器时间。业务不直接覆写设备时间。

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

```text
npm test
npm run typecheck
npm run check
npm run generate
node tests/integration/verify-workbench.mjs
node tests/integration/verify-preview.mjs
```

集成检查需要开启本项目 Creator 与 Funplay MCP；预览检查还需要运行示例 Game View。工作台检查会临时创建测试模块、验证恢复并移入回收区，不用于生产游戏运行。构建前钩子检查生成产物、源码规则和 TypeScript。Creator 当前构建转换下，展开 Map/Set 等迭代器前使用 `Array.from`，检查器会提示。

详见 [实现和验证范围](docs/implementation-status.md)、[完整设计规格](docs/framework-redesign.md)。小游戏/原生的设备、后台、缓存、平台权限与网络行为必须单独验证；代码分包与原生热更新不因资源分包可用而自动成立。
