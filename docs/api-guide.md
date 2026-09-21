# API 使用指南

本指南对应当前实现。源码中的中文 TSDoc 会显示在 VS Code 鼠标悬停和参数提示中；输入 `(` 后按 `Ctrl+Shift+Space` 可查看参数说明。生成文件的注释来自生成器，配置字段说明来自 XLSX 第 4 行，请修改源文件后重新生成。

## 先选对上下文和使用期限

| 入口               | 含义                       | 适合放什么               |
| ------------------ | -------------------------- | ------------------------ |
| `app.flows`        | 应用中的业务流程所有者     | 导航、账号会话的父级     |
| `ctx.scope`        | 一代模块业务实例           | 共享 Service、模块级订阅 |
| `instance.scope`   | 一个 UI 实例，包括缓存期间 | 实例自身的长期资源       |
| `show.scope`       | 界面本次展示               | 配置、图片、按钮、子弹窗 |
| `activation.scope` | 组件/Part 本次激活         | 激活期间的任务和监听     |

`Scope` 表示“这些工作和资源可以使用到什么时候”。加载器、事件和时间订阅会登记到它；结束时自动取消和清理。`scope.child('名称')` 创建可提前结束的子期限，父级结束时子级也结束。

```ts
const assets = this.ctx.assets.in(show.scope);
const items = await this.ctx.config.load(ItemsTable, show.scope);
await assets.setSprite(this.sprIcon, LobbyRes.sprite.status);
```

`ctx.assets`、`ctx.config` 默认跟随模块。只为当前页面准备的东西应使用 `show.scope`，否则页面结束后可能仍由模块持有。

`scope.close()` 先发出取消，再等待登记任务、子级及清理函数。`signal.aborted` 表示已经请求取消，`scope.closed` 表示清理流程已经结束。它不会强行终止任意 Promise，也不会保证节点同一帧就销毁。

## show.commit 和异步工作

```ts
const items = await this.ctx.config.load(ItemsTable, show.scope);
show.commit(() => {
    this.lblItems.string = items.require(1).name;
});
```

`show.commit` 检查本次展示仍有效后执行同步更新：执行了返回 `true`，界面已结束或挂起则跳过并返回 `false`。它不提交网络事务，不创建额外线程，也不能传 `async` 回调。

`onShow`、`show.listen` 的异步回调已被框架跟踪。其他展示异步任务可用 `show.run`，普通组件则用 `activation.run`；捕获原上下文，`await` 后通过该上下文的 `commit` 写 UI。网络适配需响应 `task.signal`。同一次展示中的多个请求仍可能先后倒置，业务自行处理顺序；图片替换可直接用 `setSprite` 的最新请求策略。

不要在一个被 Scope 跟踪的任务里等待该 Scope 自己关闭。弹窗内部结束使用 `show.finish(value)`，由外部打开方等待 `handle.result`。

## 生命周期

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
const text = show.time.calendar.format(show.time.nowMs(), 'datetime', 480);
```

这里 `datetime` 表示“日期 + 时分秒”，`480` 是 **UTC+8 的分钟偏移**，不是时间误差或延迟。时间戳不因显示时区改变。当前 `calendar` 是纯工具，格式化和日期快捷函数默认 UTC+0，**不会自动继承面板偏移**；周期订阅会继承项目日历规则。

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
const assets = this.ctx.assets.in(show.scope);
const address = await assets.resolve('status', 'SpriteFrame');
await assets.setSprite(this.sprIcon, LobbyRes.sprite.status);
```

`resolve` 取得清单中的 Bundle 路径，可能读取清单 JSON，但不加载目标图片。`load` 才加载资源；`instantiate` 另外创建托管节点。推荐用生成键消除拼写和重名问题，短名称有多个候选时会报错。不同资源种类分别编目，`SpriteFrame`、`Texture2D` 与 `ImageAsset` 含义不同。

实际 Bundle 是 `bundles/default` 或其他资源包根目录；`dynamic` 自动进入清单，`static` 保留静态引用资源，两者都在资源包内部。打开一个 Bundle 不会自动加载全部内容；依赖资源仍可能由引擎一起加载。关闭 Scope 归还本调用者的持有，其他调用者仍使用的资源不会因此释放，也不会卸载已注册 JS。

动态 Part 放在资源包的 `dynamic/prefabs` 并用生成的 Prefab 键实例化：

```ts
const node = await this.ctx.assets.in(show.scope).instantiate(partKey, this.node, {
    active: false,
});
// 在此给部件设置业务数据，再接通框架生命周期。
this.ctx.assets.activate(node);
```

`ctx.assets` 会传入当前业务宿主；复用另一个模块的资源不会自动把宿主改为资源所属模块。Part 使用数据和回调组合，不进入 UI 页面栈。

## 配置表与生成的 TS 合同

`Items.types.ts` 定义行、主键和索引类型，`Items.table.ts` 提供轻量加载合同，`tables.ts` 汇总合同。`import ItemsTable` 不加载配置数据；JSON 留在目标资源包，`config.load` 才校验并加载它。

```ts
const items = await this.ctx.config.load(ItemsTable, show.scope);
items.size;          // 当前数据分片的行数
items.get(1);        // 无记录返回 undefined
items.require(1);    // 无记录抛 CONFIG_ROW_NOT_FOUND
items.has(1);        // 是否存在
items.all();         // 只读行数组；当前导出器按主键排序
// 配置中声明索引后：table.by('category', value)，总是返回只读数组。
```

数据及嵌套值只读；保存玩家状态时应创建业务数据对象。Scope 取消后，表句柄的数据查询会报取消错误。字符串主键和数字主键不互相转换。

一张表有多个 Bundle 路由时，必须通过 `{ bundle: SomeBundles.extra }` 指定一份，或使用 `bundleHandle.tables.load`；框架不自动合并。`loadMany({ items: ItemsTable, ... }, owner)` 成组加载，任何一张失败都会清理本批持有。

命名枚举从 XLSX `__enums` 导出同名 `as const` 值对象与联合类型。表格中的字段说明和枚举成员说明也会进入生成注释。`ref` 是外键值，不会自动加载另一张表；导出时做引用校验，运行时按需明确加载目标表。

## 模块、UI 与事件通信

模块引用放在 `public.ts`，资源键、ViewKey 等轻量合同放在 `contracts`。跨模块调用使用 `app.modules.use(ModuleRef, owner)` 返回的 `handle.api`，所需依赖也可通过模块工厂第二个参数取得。

“随应用启动加载”和“按需加载”控制的是代码何时可用。两种模式都在首次 `use` 或打开所属 UI 时按需初始化业务工厂；代码准备完成不代表业务已 ready。最后一份外部持有归还后清理该代业务实例，后续可再初始化。

UI 之间传参数、返回结果，不访问对方内部节点：

```ts
const popup = await this.ctx.ui.open(LobbyViews.rewardPopup, {
    title: '奖励', amount: 100,
}, show.scope);
const result = await popup.result;
if (result.status === 'completed') {
    show.commit(() => {
        this.lblResult.string = result.value.claimed ? '已选择领取' : '未领取';
    });
}
```

`open` 等待打开，`result` 等待结束。`completed` 来自 `show.finish`，`cancelled` 来自外部关闭，`failed` 提供错误和 `cleanupPending`；后者为 `true` 时实际清理仍未结束。页面栈用 `pushPage/back`；导航所有者应覆盖页面存活期，不能是马上挂起的上一页 `show.scope`。

事件用于广播已经发生的事实。`eventKey<T>('module/event')` 定义合同，`ctx.events.on(key, handler, owner)` 订阅，`emit` 发布。发布不等待异步订阅者完成，不提供请求结果；需要结果或严格顺序时使用明确的模块方法。音频则通过 `ctx.audio.play(key, owner)` 取得独立播放句柄，播放期限由 owner 决定。
