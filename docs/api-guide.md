# API 使用指南

本指南对应当前实现。源码中的中文 TSDoc 会显示在 VS Code 鼠标悬停和参数提示中；输入 `(` 后按 `Ctrl+Shift+Space` 可查看参数说明。生成文件的注释来自生成器，配置字段说明来自 XLSX 第 4 行，请修改源文件后重新生成。

## 先选对上下文和使用期限

固定尺寸列表与网格见 [虚拟列表 API 与使用说明](virtual-list.md)。每次条目绑定拥有独立 `item.scope`，复用前等待旧订阅与异步任务清理。

| 入口               | 含义                       | 适合放什么               |
| ------------------ | -------------------------- | ------------------------ |
| `app.flows`        | 应用中的业务流程所有者     | 导航、账号会话的父级     |
| `ctx.scope`        | 一代模块业务实例           | 共享 Service、模块级订阅 |
| `instance.scope`   | 一个 UI 实例，包括缓存期间 | 实例自身的长期资源       |
| `show.scope`       | 界面本次展示               | 配置、图片、按钮、子弹窗 |
| `activation.scope` | 组件/Part 本次激活         | 激活期间的任务和监听     |

`Scope` 表示“这些工作和资源可以使用到什么时候”。加载器、事件和时间订阅会登记到它；结束时自动取消和清理。业务上下文给出的是 `Lifetime`：可以查看取消信号、登记清理、创建子 Scope，但不能关闭或取消框架拥有的宿主。`scope.child('名称')` 返回由调用方拥有、可提前 `close()` 的子 Scope；父级结束时子级也结束。

```ts
const items = await show.config.load(ItemsTable);
await show.assets.setSprite(this.sprIcon, LobbyRes.sprite.status);
```

`show.assets`、`show.config`、`show.audio`、`show.time` 已绑定本次展示，Part 的 `activation` 提供同样的入口。`ctx.assets`、`ctx.config` 默认跟随模块。切换配置表所有者使用 `ctx.config.in(owner).load(Table)`；已移除 `ctx.config.load(Table, owner)` 重载。应用级入口仍为 `app.config.load(Table, owner, options)`。

自己拥有的 `scope.close()` 先发出取消，再等待登记任务、子级及清理函数。`signal.aborted` 表示已经请求取消，`scope.closed` 表示清理流程已经结束。它不会强行终止任意 Promise，也不会保证节点同一帧就销毁。结束 UI 使用 `show.finish / show.dismiss / show.ui.back`，不要关闭 `show.scope`。

## show.commit 和异步工作

```ts
const items = await show.config.load(ItemsTable);
show.commit(() => {
    this.lblItems.string = items.require(1).name;
});
```

`show.commit` 检查本次展示仍有效后执行同步更新：执行了返回 `true`，界面已结束或挂起则跳过并返回 `false`。它不提交网络事务，不创建额外线程，也不能传 `async` 回调。

`onShow`、`show.listen` 的异步回调已被框架跟踪。其他展示异步任务可用 `show.run`，普通组件则用 `activation.run`；捕获原上下文，`await` 后通过该上下文的 `commit` 写 UI。网络适配需响应 `task.signal`。同次展示内的查询竞态使用 `show.actions.latest`；图片替换可直接用 `setSprite` 的最新请求策略。Actions 用法见下方。

不要在一个被 Scope 跟踪的任务里等待该 Scope 自己关闭。弹窗内部成功结束用 `show.finish(value)`，取消用 `show.dismiss()`，页面返回用 `show.ui.back()`。它们发出请求后立即返回，由外部打开方等待 `handle.result`。

按钮回调失败默认报告错误并保留页面，用户可以重试；可用 `show.listen` 第四个参数显示业务错误。初始化或清理失败仍走 UI 故障处理。

```ts
show.listen(this.btnReload.node, Button.EventType.CLICK, async () => {
    await reload();
}, error => {
    show.commit(() => { this.lblError.string = String(error); });
});
```

## 生命周期

### 命名操作 Actions

| 入口                                         | 同名操作行为                                   | 用途                 |
| -------------------------------------------- | ---------------------------------------------- | -------------------- |
| `show.actions.latest(key, work)`             | 新请求取消旧等待；旧 `task.commit` 不再执行    | 搜索、筛选、刷新查询 |
| `show.actions.exclusive(key, work)`          | 运行期间忽略重复触发，重复调用返回 `undefined` | 打开弹窗、确认提交   |
| `show.actions.serial(key, work, maxPending)` | 顺序执行，默认最多 32 项，包含运行项；超限报错 | 必须保序的本地操作   |
| `show.actions.busy(key)`                     | 查询是否在执行或排队                           | 控制按钮状态         |

```ts
await show.actions.latest('search', async task => {
    const result = await searchService.query(keyword, task.signal);
    task.commit(() => { this.render(result); });
});
```

Part 使用 `activation.actions`。同一个 key 固定一种策略。这些入口不保证服务端幂等，不撤销业务变更，也不自动重试支付或领奖。旧任务若不响应取消，仍需等待其物理结束后才回收资源。`task.scope` 只覆盖单次操作；显示到页面结束的图片、Part 应使用 `show.assets` 持有。操作完成后不要保留 `task` 用于后续更新。

### 启动与失败重试

`AppEntry` 自动调用异步的 `App.create(options)`，核心构造失败时清理已创建的引擎节点与服务。业务启动使用下面的钩子：

```ts
protected async onBoot(app: App, boot: BootContext): Promise<void> {
    await app.ui.pushPage(StartViews.home, {}, boot.scope);
}
```

首屏和会话持有放在 `boot.scope`。失败必须抛出，不能在钩子中吞掉错误后假装成功；框架会先回收本次尝试，再交给 `onBootFailed` 展示错误。业务入口可在用户重试按钮中调用并处理 `this.retryBoot()`。并发重试共享当前尝试，已经启动成功不会再次执行。`app.inspect().boot` 给出状态与尝试次数。

自己装配 App 时使用 `await App.create(options)` 和 `app.boot.start(boot => ...)`。核心服务失败与业务启动失败分开处理；后者保留 App 核心用于错误界面和重试。不要在启动钩子里等待关闭、重试它自己。

### 框架钩子

| 对象                   | 钩子                                   | 使用规则                                                  |
| ---------------------- | -------------------------------------- | --------------------------------------------------------- |
| `AppEntry`             | `appOptions`、`onBoot`、`onBootFailed` | 装配应用与选择启动流程；`onBoot` 可异步                   |
| `UIView`               | `onCreate`                             | 一个实例执行一次，可异步；缓存复用不重复调用              |
| `UIView`               | `onShow`                               | 每次展示执行，可异步；完成后才允许交互                    |
| `UIView`               | `onHide`                               | 关闭或挂起时执行，可异步；旧 show 已取消                  |
| `UIView`               | `onDispose`                            | 实例最终销毁时同步执行                                    |
| `UIView`               | `onTick`、`onLateTick`                 | 可交互期间逐帧同步执行，参数含当前 show                   |
| `GameComponent` / Part | `onInit`                               | 绑定和宿主就绪后同步执行一次                              |
| `GameComponent` / Part | `onActivate`、`onDeactivate`           | 每次业务激活和失活；同步钩子，异步工作放 `activation.run` |
| `GameComponent` / Part | `onReady`                              | 首次有效业务帧执行一次                                    |
| `GameComponent` / Part | `onTick`、`onLateTick`                 | 激活期间逐帧同步执行；参数只有 dt                         |
| `GameComponent` / Part | `onDispose`                            | 已初始化实例最终销毁时同步执行                            |

`onTick(dt)` 的 `dt` 是**秒**，60 FPS 时约为 `0.0167`。它是逐帧更新接口，与跨日、跨月通知无关。业务不覆盖引擎的 `onLoad`、`start`、`update` 等保留入口。自动绑定 getter 直接给出对应节点或组件；无需手动拖引用，节点变化后通过工作台更新绑定。

可选的存档隔离使用 `const accountStorage = ctx.storage.in(accountId)`。同一账户可复用已有 StorageKey，其他账户的主存档及备份各自独立；不会自动迁移应用级旧存档。调用方决定账号会话何时开始与结束，框架不新增账号管理器。

## 时间、偏移和周期

| API                                 | 用途                                   |
| ----------------------------------- | -------------------------------------- |
| `show.time.nowMs()`                 | 当前估计 UTC 毫秒时间戳                |
| `show.time.nowSeconds()`            | 当前估计 Unix 秒时间戳，向下取整       |
| `show.time.nowDate()`               | 独立的 `Date` 对象                     |
| `show.time.snapshot()`              | 查看来源、质量、样本年龄、误差         |
| `show.time.sync()`                  | 调用项目注入的服务器适配器校时         |
| `show.time.requireNowMs()`          | 时间质量达标才返回，否则报错           |
| `show.time.remainingMs(deadlineMs)` | 距截止时刻的毫秒数，过期为 0           |
| `show.time.calendar.format(...)`    | 把时间戳转成显示文本                   |
| `show.time.onChanged(...)`          | 来源、校时或质量变化通知，不是每秒回调 |

```ts
const text = show.time.calendar.format(show.time.nowMs(), 'datetime');
const utc8Text = show.time.calendar.format(show.time.nowMs(), 'datetime', 480);
```

这里 `datetime` 表示“日期 + 时分秒”，`480` 是 **UTC+8 的分钟偏移**，不是时间误差或延迟。时间戳不因显示时区改变。`app.time.calendar`、`ctx.time.calendar` 和 `show.time.calendar` **统一继承面板日历设置**；显式参数可覆盖。只有从 `framework/time/calendar` 独立导入的纯工具默认 UTC+0。

注入 `TimeOptions.source` 后，框架默认在前台首次校时，并在质量到期前刷新；失败指数退避，后台停止请求，恢复时重试。`autoSync: false` 可交给登录流程完全控制。自动校时不保证网络成功；严格判断仍检查 `requireNowMs()`，不得把过期样本当作可信时间。应用查询日期不会各自发起网络请求。

```ts
// 跨业务日：UTC+8，每日 04:00 切换；注册后先通知当前业务日。
show.time.onBoundary('day', (event, task) => {
    task.commit(() => {
        this.lblPeriod.string = event.occurrenceKey;
    });
}, { offsetMinutes: 480, resetMinute: 240, emitCurrent: true });

// 从现在起满一周通知一次。
show.time.afterPeriod({ unit: 'week', count: 1 }, onOneWeekLater);

// 以保存的起点为基准，每满一个日历月通知。
show.time.everyPeriod({ unit: 'month', count: 1 }, onMonthly, { anchorMs });

// 到达某个绝对时刻通知一次；deadlineMs 必须是 UTC 毫秒时间戳。
show.time.at(deadlineMs, onDeadline);
```

`onBoundary('week' | 'month' | 'year', ...)` 分别监听进入新周、新月和新年。`weekStartsOn` 默认 `1`（周一），`resetMinute` 默认 `0`（零点）。月/年按日历计算，月末不存在的日期收敛到月末；固定偏移不处理夏令时。

后台不保证准点回调，恢复后合并错过期次。配置服务器源时，时间未达质量要求会暂停日历派发。`nowMs()` 只是估计值，单调时钟连续性失效时可能暂时保持上次估计；严格业务判断应使用 `requireNowMs()`。回调报错会取消该订阅；业务自行处理重试、保存期次及结算去重，框架不会自动发奖励或跨进程恢复回调。

## 资源与动态 Part

```ts
const assets = show.assets;
const address = await assets.resolve('status', 'SpriteFrame');
await assets.setSprite(this.sprIcon, LobbyRes.sprite.status);
```

`resolve` 取得清单中的 Bundle 路径，可能读取清单 JSON，但不加载目标图片。`load` 才加载资源；`instantiate` 另外创建托管节点。推荐用生成键消除拼写和重名问题，短名称有多个候选时会报错。不同资源种类分别编目，`SpriteFrame`、`Texture2D` 与 `ImageAsset` 含义不同。

实际 Bundle 是 `bundles/default` 或其他资源包根目录；`dynamic` 自动进入清单，`static` 保留静态引用资源，两者都在资源包内部。打开一个 Bundle 不会自动加载全部内容；依赖资源仍可能由引擎一起加载。关闭 Scope 归还本调用者的持有，其他调用者仍使用的资源不会因此释放，也不会卸载已注册 JS。

动态 Part 放在资源包的 `dynamic/prefabs` 并用生成的 Prefab 键实例化：

```ts
const node = await show.assets.instantiate(partKey, this.node, {
    active: false,
});
// 在此给部件设置业务数据，再接通框架生命周期。
show.assets.activate(node);
// 父页面需要提前替换或移除部件时：
await show.assets.destroyInstance(node);
```

资源入口会传入当前业务宿主；复用另一个模块的资源不会自动把宿主改为资源所属模块。Part 使用数据和回调组合，不进入 UI 页面栈。`destroyInstance` 等待子任务、节点与资源持有回收；调用 `node.destroy()` 也会在实际销毁后归还托管持有。部件自己正在执行的受管任务不要等待自身销毁，可通知父级处理。游戏暂停时，实际节点销毁要等引擎恢复帧处理。

## 配置表与生成的 TS 合同

`Items.types.ts` 定义行、主键和索引类型，`Items.table.ts` 提供轻量加载合同，`tables.ts` 汇总合同。`import ItemsTable` 不加载配置数据；JSON 留在目标资源包，`config.load` 才校验并加载它。

```ts
const items = await show.config.load(ItemsTable);
items.size;          // 当前数据分片的行数
items.get(1);        // 无记录返回 undefined
items.require(1);    // 无记录抛 CONFIG_ROW_NOT_FOUND
items.has(1);        // 是否存在
items.all();         // 只读行数组；当前导出器按主键排序
// 配置中声明索引后：table.by('category', value)，总是返回只读数组。
```

数据及嵌套值只读；保存玩家状态时应创建业务数据对象。Scope 取消后，表句柄的数据查询会报取消错误。字符串主键和数字主键不互相转换。

一张表有多个 Bundle 路由时，必须通过 `{ bundle: SomeBundles.extra }` 指定一份，或使用 `bundleHandle.tables.load`；框架不自动合并。`show.config.loadMany({ items: ItemsTable, ... })` 成组加载，首个失败立即取消本批等待并清理持有，不被另一张未完成的表拖住。其他所有者共享的加载继续；最后一个已交付的持有归还时会等待异步清理。

命名枚举从 XLSX `__enums` 导出同名 `as const` 值对象与联合类型。表格中的字段说明和枚举成员说明也会进入生成注释。`ref` 是外键值，不会自动加载另一张表；导出时做引用校验，运行时按需明确加载目标表。

### 大厅读取战斗模块的表

先在工作台配置页勾选该表的“允许其他模块引用此表合同”，保存并导出。生成的合同在战斗模块 `contracts/generated/config`，数据仍在原资源包。下面假设已创建公开的 `EnemiesTable`，在大厅 `code/ui` 脚本中：

```ts
import { EnemiesTable } from '../../../battle/contracts/generated/config/Enemies.table';

const enemies = await show.config.load(EnemiesTable);
show.commit(() => { this.lblName.string = enemies.require(101).name; });
```

只有一个发布路由时自动定位所属 Bundle，**不要求先进入战斗、打开战斗界面或启动 BattleModule 业务工厂**，也不需要为“仅用表数据”添加业务模块依赖。禁止直接引用另一模块的 `code/generated/config` 私有合同。若表体现战斗内部规则、外部只需要“推荐战力”等计算结果，则通过战斗的公开 API 查询更合适，避免大厅耦合内部字段。

### 跨资源包与分片

表所在包与调用方所在包不同不影响用法。只有同一张逻辑表导出了多个分片，或需要约束目标包时，才传 Bundle：

```ts
import { BattleBundles } from '../../../battle/contracts/generated/bundles';

const enemies = await show.config.load(EnemiesTable, { bundle: BattleBundles.extra });
// 或先持有包，再读取其中的表；两种方式共用同一缓存。
const bundle = await show.assets.openBundle(BattleBundles.extra);
const sameEnemies = await bundle.tables.load(EnemiesTable);
```

分片漏选报 `CONFIG_TARGET_REQUIRED`，指定了不包含该表的包报 `CONFIG_TARGET_MISMATCH`。查询只看所选分片，不搜索其他包补齐主键。远程资源包首次读取可能发生下载；小游戏分包下载粒度由平台决定，不能等同于只下载这一张 JSON。

### 全局公共配置

公共数据放普通 `common` 模块的资源包并导出公开合同。它是可选的内容组织约定，没有第二套全局配置管理器。当前演示可直接运行：

```ts
import { EconomyTable } from '../../../common/contracts/generated/config/Economy.table';

const economy = await show.config.load(EconomyTable);
const reward = economy.require(1);
```

“公共”表示可复用，不表示全量预加载、永不释放。页面使用 `show.config`，模块服务使用 `ctx.config`；确需整个账号会话共用时由应用流程 `app.config.load(EconomyTable, accountScope)` 持有。多个调用方共享底层只读数据，各自有独立表句柄；大厅退出不会释放战斗仍在使用的那份持有。不要为了复用把同一表复制到多个模块，也不要把账号数据、库存等可变状态存入配置表。

## 模块、UI 与事件通信

模块引用放在 `public.ts`，资源键、ViewKey 等轻量合同放在 `contracts`。跨模块调用使用 `app.modules.use(ModuleRef, owner)` 返回的 `handle.api`。`defineModule` 把公开合同、内部服务与依赖 API 连接起来，工厂仍显式创建普通 Service：

```ts
// LobbyServices 放在本模块 code，引用值不包含服务实例。
export const LobbyServices = moduleServices<{ lobby: LobbyService }>('lobby');

// 来自 module.json 的 "dependencies": { "profile": "profile" }。
import { dependencies } from './generated/dependencies';

export const createLobbyModule = defineModule(
    LobbyModule,
    { services: LobbyServices, dependencies },
    (ctx, deps) => ({
        api: { moduleId: ctx.id },
        services: { lobby: new LobbyService(ctx, deps.profile) },
    }),
);
// 同模块页面在 onShow 中取本代服务：
const service = this.ctx.services(LobbyServices).lobby;
```

业务依赖仅在 `module.json.dependencies` 维护“别名 → 模块 ID”，面板可选择目标，生成器产生带类型的 `dependencies.ts`。`deps.profile` 具有 `ProfileApi` 类型，工厂返回值也受 `LobbyModule` 合同检查。其他模块通过 `public.ts` API 通信，不能读取私有服务。旧代结束后，其 ctx 不能访问新一代服务。完整示例见 `lobby/code/LobbyModule.ts`、`LobbyService.ts`、`profile/code/services/WalletService.ts`。

公开 API 方法开始前会登记调用，最后一份模块持有归还时等待这些方法返回的 Promise 结束，再销毁服务。方法内部脱离返回链的任务仍需显式登记；API 应优先返回只读数据，嵌套逃逸对象不自动代理。不要在方法里等待结束承载自己的模块。

只有资源与配置的模块设置 `"code": { "mode": "none" }`，无需 `public.ts` 或空业务工厂。common 示例已采用此模式。引用公开表与资源合同无需业务依赖；资源模块不能声明业务服务、UI 或 Part 脚本。

“随应用启动加载”和“按需加载”控制的是代码何时可用。两种模式都在首次 `use` 或打开所属 UI 时按需初始化业务工厂；代码准备完成不代表业务已 ready。最后一份外部持有归还后清理该代业务实例，后续可再初始化。

UI 之间传参数、返回结果，不访问对方内部节点：

```ts
// 同模块从 code/generated/views.ts 导入内部 Key。
const popup = await show.ui.open(LobbyViews.rewardPopup, {
    title: '奖励', amount: 100,
});
const result = await popup.result;
if (result.status === 'completed') {
    show.commit(() => {
        this.lblResult.string = result.value.claimed ? '已选择领取' : '未领取';
    });
}
```

`show.ui.open` 等待局部界面打开，`handle.result` 等待结束。默认持有期为当前 show，也可传 `{ owner: task.scope }` 缩短到任务，不能传入其他会话或祖先 Scope。`completed` 来自 `show.finish`，`cancelled` 来自取消/外部关闭，`failed` 提供错误和 `cleanupPending`；后者为 `true` 时实际清理仍未结束。

页面内调用 `show.ui.back()`。外部流程使用 `await app.ui.back().completed` 等待返回完成；`back()` 本身返回非 Promise 的请求句柄，不能再用 `await app.ui.back()` 表示清理完成。连续对同一栈顶发出返回请求只关闭该页。`handle.close()` 的 Promise 也只供外部协调等待，不要在该界面自己的受管回调中等待它。

页面前进使用 `show.ui.pushPage(PageKey, 参数)`，返回 `opened` 或 `ignored/busy`，只等待切换，不提供下一页关闭结果。新页面继承页面栈的外部所有者；旧页面 show 被挂起取消时，新页面继续存在。下一页准备完成并再次核验来源后才入栈；慢加载期间返回会取消本次前进，源页面关闭也会撤销准备。失败保留原页；失败实例收尾中，同 Key 再次打开会报 `UI_CLEANUP_PENDING`，需等待收尾完成。

`onShow`、非页面、非栈顶或不可交互状态不能发起导航；失效的 `show.ui.pushPage/open` 会拒绝，失效的 `back` 无操作。每次返回恢复页面都会取得全新的 show。避免在 Service 保存 `show.ui`。

```ts
// 页面可交互后的按钮回调中：
const navigation = await show.ui.pushPage(WorkshopViews.workflowPage, undefined);
if (navigation.status === 'ignored') return;
// 不在旧 show 内等待新页面关闭，也不再写旧页面节点。
```

启动和外部会话使用 `app.ui.pushPage(PageKey, 参数, owner)`，返回 `ViewHandle`，可以在这个外部所有者中等待页面结果。它要求显式所有者，并发准备时抛 `UI_NAVIGATION_BUSY`；页面业务优先使用 `show.ui`。`app.ui.open` 仅接受非 Page 的 Key。

工作台新建界面默认内部；勾选“公开界面合同”才输出到 `contracts/generated/views.ts`，供启动入口或其他模块使用。同模块使用 `code/generated/views.ts` 的全部 Key。已有界面的 `module.json.views.<id>.visibility` 可设置 `public` / `internal` 后重新生成。Key 包含 `kind`，类型检查和运行时都校验层级；跨模块导入私有 Key 会被源码边界检查拒绝。界面公开合同的 import 不加载预制体，也不启动业务模块。

长期业务由模块 Service 持有。启动入口或账号会话显式 `app.modules.use(ModuleRef, owner)`，持续保留这份 Handle；Service 用 `ctx.time.onBoundary`、UI 用模块 API/事件订阅状态，关闭界面不影响仍被持有的 Service。`code.mode: eager` 只代表代码可用，不会自动保活模块。`app.flows` 是现有的运行时 Scope 名称，不要求项目有同名业务目录。

跨天重置属于业务规则：初始化和登录时也要用持久化的周期标记检查是否跨天；重置及标记保存成功后再发布变化，保持幂等，并明确失败后的重试。时间订阅不会替业务自动重试抛错的回调。框架提供时间与持有能力，不内置每日重置或玩家数据规则。

事件用于广播已经发生的事实。`eventKey<T>('module/event')` 定义合同，`ctx.events.on(key, handler, owner)` 订阅，`emit` 发布。发布不等待异步订阅者完成，不提供请求结果；需要结果或严格顺序时使用明确的模块方法。音频则通过 `ctx.audio.play(key, owner)` 取得独立播放句柄，播放期限由 owner 决定。

## 红点、HTTP 与引导

`ctx.badges` / `app.badges` 提供数量来源、sum/any 分组和 Scope 订阅，业务在状态保存成功后更新来源；UI 的 `Badge.bind` 使用 show、Part activation 或虚拟条目 item 的期限。见 [红点 API 与示例](badges.md)。

`ctx.http` / `app.http` 提供 HTTP 文本请求和经过业务 decode 验证的 JSON，请求显式传 owner，默认不重试。`AppOptions.http` 可注入服务地址、传输与超时；查询界面结合 Actions.latest / task.commit 拦截旧响应。见 [HTTP API、平台适配和本机演示](network.md)。

业务使用 `GuideRunner` 执行步骤，`GuideTargets` 以稳定业务 ID 注册页面或虚拟条目目标，`StorageGuideProgress` 保存检查点。`GuideFocusOverlay.begin` 创建整次引导共用的视觉使用期，每步只移动和变形镂空，结束时统一 close。见 [引导 API、动画设计及 Creator 配置](guide.md)。

## 存档迁移与恢复

普通业务通过 `ctx.storage` 或 `app.storage` 使用小型 JSON 存档。`StorageKey<T>` 声明稳定 id、当前 version、validate 和逐版本 migrations；例如 `{ 1: old => ({ coins: old.gold }) }` 表示版本 1 升级到 2。完整可运行示例见 `profile/code/services/WalletService.ts`。

`read(key)` 返回 `loaded`、`migrated`、`recovered`、`missing`、`invalid` 或 `incompatible`。迁移和备份恢复只在内存中进行；业务明确接受后再 `set`，不要用默认值覆盖损坏或未来版本存档。`get` 是严格读取主存档，错误直接抛出。`set` 先保留上一份有效备份再写新数据，主数据和备份中的未来版本都拒绝覆盖；写入失败抛错。`remove` 删除指定数据及备份，不清空整个应用。它不是加密、联网校验或大文件存储系统。

## 诊断与制作流程恢复

模块中的诊断页面可用 `ctx.diagnostics.snapshot()` 获取页面、模块、资源包和持有计数摘要，用 `.module(id)` 区分代码可用与业务就绪。它没有 UI 操作或模块启动能力，不承担业务状态查询。外部工具使用 `app.inspect()` 返回只读快照，包含模块使用数/清理状态、UI、Scope 树、任务标签、资源/配置持有者和时间质量。查询不会启动模块或加载资源，不返回可直接修改的内部 Node/Map。卡住时先看哪些 Scope 仍有任务、哪个持有者还没结束；快照不是完整的引擎 GPU/原生内存统计。

工作台创建失败会在 `.yzforge/creations` 保留前后快照，可在“删除与恢复”预览撤销；生成失败可修复源文件后重试生成。撤销遇到后续修改或外部引用会停止，任意进程崩溃若没有完整后快照不能自动撤销。已有删除备份保留原流程。

构建后报告写到 `.yzforge/build-reports`，统计真实输出的未压缩字节、分包/remote 目录、至少 1 KiB 的同内容重复文件及 Bundle 依赖。可在 `project-settings/build-budgets.json` 设置总量、本地根目录与重复文件预算，`null` 表示不限制；超限使构建失败。该数字不是平台压缩包大小或网络首屏下载量。公式环境可通过工作台“检查公式环境”或 `node tools/yzforge/cli.mjs formula-status` 检测，检测通过后仍需对具体工作簿执行重算。
