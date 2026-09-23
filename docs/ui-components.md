# 通用 UI 组件

这组组件位于 `assets/framework/ui/components`，适用于 Cocos Creator 3.8.8。**默认通过 Inspector 配置使用，不需要先写 bind 或传 Scope。** 在“添加组件 → YZForge → UI”中选择组件。业务样式、预制体、加载规则和数据仍放在业务模块。

| 组件           | 用途                                         | 需要的 Cocos 组件                           |
| -------------- | -------------------------------------------- | ------------------------------------------- |
| SafeWidget     | 指定边避让安全区，保留 Widget 基础边距       | Widget、UITransform、所属 Canvas 的正交相机 |
| AsyncButton    | 防连点、忙碌提示、任务取消                   | Button                                      |
| AsyncSprite    | 占位图、失败图、快速换图与资源释放           | Sprite                                      |
| ViewState      | loading / content / empty / error 四态及重试 | 四个业务子节点，可选 Button                 |
| CountdownLabel | 按绝对截止时间显示，校时及恢复前台后修正     | Label                                       |
| TabGroup       | 拖入 Toggle 与内容节点直接切换；可选动态加载 | ToggleContainer、Toggle、对应内容节点       |

## 先用编辑器配置

放在框架创建的 UI 或 Part 里，生命周期自动接入；直接放到场景里的组件沿用项目现有的 `app.bindScene` 接入方式。除 SafeWidget 外不需要手动调用引擎生命周期，也不要在业务中覆盖它们。静态图片继续直接使用 Cocos Sprite；只有按需加载或运行时换图才需要 AsyncSprite。

| 需要什么          | 在 Inspector 做什么                                            | 普通业务最多写什么                                                                            |
| ----------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 避让刘海          | 挂 SafeWidget，选边和对称策略                                  | 无                                                                                            |
| 防连点            | Button 上挂 AsyncButton，填点击间隔，可拖忙碌提示节点          | 无；普通 Button 点击事件照常配置                                                              |
| 等待真实异步提交  | 同上                                                           | 点击回调里 `await button.run(async task => { ... })`                                          |
| 动态图片          | 填初始资源名，拖占位图、失败图                                 | 换图调用 `await image.setSource(key)`；按钮也可直接连接 `loadFromEvent`，自定义数据填写资源名 |
| 加载/内容/空/失败 | 拖四个根节点，选初始状态，拖重试按钮和重试事件                 | `state.showLoading()` / `showContent()` / `showEmpty()` / `showError()`，也可直接连接按钮事件 |
| 倒计时            | 勾自动开始，填秒数、显示格式和完成事件                         | 固定时长无需代码；服务器截止时间调用 `timer.startUntil(ms)`                                   |
| 普通页签          | 在“页签与内容”数组里逐项拖入 Toggle 和对应内容节点，填默认索引 | 无；也支持 `tabs.selectIndex(1)`、`next()`、`previous()`                                      |

CountdownLabel 默认格式为 `{hh}:{mm}:{ss}`，可填 `{mm}:{ss}` 或 `剩余 {seconds} 秒`。`restart()` 和 `stop()` 可直接连 Button.clickEvents；完成事件每次只触发一次。TabGroup 的普通模式保留业务节点，只切换 active，不重新创建页面，页面内的数据不会因切换自动丢失。

这些方法在组件业务激活后调用；通常来自按钮回调。按钮 `run` 在未激活/正在清理时返回 false。页面 onShow 需要立即启动任务、虚拟列表需要每个 item 独立期限，或页签需要按需创建 Part 时，再使用下文的高级 bind 接口。统一 TypeScript 入口为 `assets/framework/ui/components/index.ts`，也可按文件导入。

**可以直接查看示例预制体的 Inspector：**换图、四态、倒计时、普通页签的事件和引用已经配置，`ComponentsLabPage.ts` 中没有它们的绑定代码。

## 生命周期与自动绑定

除自动布局的 SafeWidget 外，其余组件继承现有 GameComponent，自动使用 UI / Part 激活期。禁用、节点失活、销毁或页面结束时取消任务并解绑；再次激活自动恢复 Inspector 配置。高级 `bind(owner, ...)` 可显式使用 `show.scope`、`activation.scope` 或虚拟列表的 `item.scope`，也能在首次激活前调用；显式绑定优先于自动配置，不会启动两套行为。自定义绑定取消后，业务若要恢复该绑定，需要再次调用 bind。

重新 `bind` 会同步取消旧绑定，旧任务在原 Scope 中继续排空。每次返回的句柄只操作自己的绑定，旧句柄的 `dispose()` 不会关闭新绑定。组件的 `clear()` 关闭当前绑定。两者都返回排空 Promise；需要等待资源归还时必须 `await`。**不要在绑定自己的回调中等待自己的 dispose/clear 或宿主关闭**，否则会等待当前任务本身。回调应响应 `task.signal`，异步后通过 `task.commit` 写界面。不配合取消的业务 Promise 仍会阻塞完整清理。

保留现有自动绑定：节点继续命名为 `btn_submit`、`spr_icon`、`lbl_countdown`、`node_state`、`node_tabs`、`toggle_goods` 等；工作台生成 Button、Sprite、Label、Node、Toggle 引用，业务用 `getComponent(AsyncButton)` 等取得增强组件，无需增加绑定前缀。

程序调用 `press/set/reload/select` 的错误由调用方处理；真实点击由 `onError` 接收非取消错误，默认交给框架日志。取消使用 `OperationCancelled`。清理错误仍由 Scope 聚合并上报，不能把日志吞掉视为成功。输入校验和已取消状态可能同步抛错，推荐在 `async` 流程中 `try/await/catch`。

## SafeWidget

适合顶部操作栏、底部按钮、固定容器和只需处理部分边的节点。全屏背景、动画位移节点不应挂载；动画放在布局节点的子级。已有整屏 `SafeArea` 可以继续使用；子孙 SafeWidget 会根据真实参考矩形只补偿仍越界的部分。同一个节点不能同时挂 SafeArea 和 SafeWidget。

在 Inspector 勾选 Widget 对齐边，并填写设计边距，再挂 SafeWidget。`edges` 默认四边全选，但只处理 Widget 已启用的对齐边；不会强制改变对齐方式。安全区从 `sys.getSafeAreaRect(false)` 获取，保留真实的不对称值。组件不缓存全局边距，也不按屏幕长宽比猜测刘海。

| API / 属性                                   | 含义                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `edges`                                      | `SafeEdge.Top / Bottom / Left / Right / All`，通过 `\|` 组合，0 表示不选边                         |
| `symmetry`                                   | `SafeSymmetry.None` 默认真实边距；`LandscapeSides` 只在横屏统一左右；`BothAxes` 同时统一上下、左右 |
| `refresh()`                                  | 立即读取安全区和参考节点，重复调用不累加；修改配置后显式调用                                       |
| `setBaseOffsets({top, bottom, left, right})` | 修改指定基础边距并重算；每边的单位跟随 Widget 的绝对/百分比设置                                    |
| `simulate`、`previewTop/Bottom/Left/Right`   | 显式预览模拟，单位是视图设计坐标；只有 `PREVIEW` 生效，正式构建使用设备返回值                      |

组件监听窗口、方向、设计分辨率、前台恢复，以及参考节点祖先的尺寸、锚点、位移和缩放变化，在本帧末合并刷新。禁用时恢复基础边距并退订。启用期间不要直接改 Widget 的四个边距；用 `setBaseOffsets`。切换绝对/百分比模式时，应同时把对应基础值改成新单位，再刷新。

计算流程为设备安全矩形 → UI 相机 → Widget 实际 target 的局部坐标 → 基础值加必要补偿。参考节点已在安全区内时补偿为零；百分比边按参考节点宽高换算。支持正缩放、非中心锚点和祖先 target；限制为同一正交 Canvas 下轴对齐的固定布局，不支持旋转、翻转、透视相机或跨 Canvas target。无效配置会明确报 `SAFE_WIDGET_*`；自动刷新失败时禁用并恢复基础值，修正后重新启用。

```ts
const safe = this.nodeToolbar.getComponent(SafeWidget)!;
safe.edges = SafeEdge.Top | SafeEdge.Left | SafeEdge.Right;
safe.symmetry = SafeSymmetry.LandscapeSides;
safe.setBaseOffsets({ top: 16, left: 24, right: 24 });
```

预览模拟以整个实际窗口为参考，包括固定设计尺寸周围已有的留白。缺口仍在留白内时，内容无需移动。这与真机安全区相交的判断一致；示例页的“模拟刘海”会越过已有留白，让避让可见。

## AsyncButton 的高级绑定

```ts
this.btnSubmit.getComponent(AsyncButton)!.bind(show.scope, async task => {
    const result = await service.submit(task.signal);
    task.commit(() => { this.lblResult.string = result.message; });
}, error => this.showFailure(error));
```

- `busyVisual`：可选子节点，忙碌时显示；节点样式由业务预制体提供。
- `handle.press(): Promise<boolean>`：程序触发；执行成功返回 true，忙碌、不可交互或节点尚未激活返回 false，失败拒绝。
- `handle.setInteractable(value)`：修改空闲时的可交互状态；忙碌期间保持禁用。
- `handle.dispose()`：立即取消、移除本组件点击监听，恢复绑定前的 interactable 和忙碌节点状态，等待任务清理。

忙碌覆盖业务 Promise **和本次 task.scope 的异步清理**，避免清理未结束就接受下一次点击。组件绑定期间接管 Button.interactable；不要同时通过 Button.clickEvents 或其他监听重复执行提交业务。页面长期显示的数据/资源应由 show.scope 持有，按钮 task.scope 只覆盖本次操作。组件没有自动重试，也不能撤销已经成功提交到服务器的变更。

## AsyncSprite 的高级绑定

在 Sprite 所在节点挂载，Inspector 可指定静态 `placeholder`、`failure`。静态引用由所属预制体管理，不能拿其他短期 Scope 加载的资源随意充当长期占位图。

```ts
const image = this.sprIcon.getComponent(AsyncSprite)!.bind(item.scope, this.ctx.assets);
void image.set(ItemRes.sprite.icon).catch(error => {
    if (!(error instanceof OperationCancelled)) reportError(error);
});
```

`set(key)` 接收 `AssetKey<'SpriteFrame'>` 或当前资源入口可解析的逻辑名称，不是 URL、磁盘路径或 ImageAsset。每次调用先显示占位图并取消前一次请求；成功后持有该图片至替换、清空或绑定结束。只有最新请求能写入显示和 `state`（empty/loading/ready/error）。失败显示 failure，并向调用方抛原错误。

`set(null)` 同步清空显示并取消旧请求；它不等待旧请求实际排空。`dispose()` 清空图片并等待资源归还。复用条目时每次 render 传新的 item.scope 重新绑定即可；旧请求和旧句柄不会覆盖新条目。仍使用现有 Assets 的共享加载和引用管理，不另外下载远程图片、不建立另一套缓存，不要手动 decRef。

## ViewState 的异步加载模式

组件根节点下准备四个不同的**直接子节点**，分别填写 `loading/content/empty/error`，它们的内容完全由业务决定。可选 `retryButton` 位于 error 子树；不要再给它绑定第二个加载处理器，也不要叠加会随 error 隐藏而取消的 AsyncButton。

```ts
const region = this.nodeState.getComponent(ViewState)!.bind(show.scope, async task => {
    const rows = await service.query(task.signal);
    task.commit(() => { this.renderRows(rows); });
    return rows.length ? 'content' : 'empty';
}, error => this.renderError(error));
await region.reload();
```

`bind` 初始显示 loading，但**不自动调用加载函数**。`reload()` 使用 Actions.latest：再次调用立即取消旧结果等待，最后一次成功返回 content 或 empty；失败切到 error 并拒绝。点击 retryButton 调用同一 reload，支持反复失败后重试。业务更新同样使用 task.commit；需要持续显示的资源用外部 show/item Scope，不要绑定到一次请求的 task.scope。

手动模式使用 `component.show('empty')` 等，它会结束旧异步绑定，再显示指定状态。绑定结束时四个区域全部隐藏；`handle.state` 记录本次最后状态。四态会触发子树的引擎启停，子树中需持续工作的组件应在重新显示时重新绑定。

## CountdownLabel 的高级绑定

```ts
this.lblCountdown.getComponent(CountdownLabel)!.bind(show.scope, show.time, {
    deadlineMs: offer.endsAtMs,
    format: seconds => `${seconds} 秒`,
    onComplete: task => { task.commit(() => this.renderExpired()); },
    onError: reportError,
});
```

每帧读取现有 TimeService 的当前时间，以 `max(0, ceil((deadline-now)/1000))` 得到剩余秒数，仅秒数变化时改 Label；不使用 dt 累加。校时通知、前台恢复或 `handle.refresh()` 会立即重算。默认格式 `HH:mm:ss`，小时允许超过 24；也导出纯函数 `countdownSeconds` 和 `formatCountdown`。

每次绑定只完成一次，时间回拨不会重新触发完成；重新 bind 可更换截止时间。已经到期时立即显示 0，在受跟踪任务中执行 onComplete；禁用或关闭会取消未执行的通知、退订并等待已开始的任务。dispose 保留最后文字。默认时间可能来自本机，组件只负责显示；服务器校时、时间可信度和最终奖励结算沿用 TimeService 与业务服务的规则。

## TabGroup 的动态内容模式

普通页签使用上方 Inspector 配置即可。只有内容需要按需创建、离开销毁时，使用这里的高级模式。组节点挂 ToggleContainer 和 TabGroup，每个 Toggle 位于它的直接子节点。`contentRoot` 是同一业务预制体中的空 UITransform 节点，可以放背景组件，但不要预放业务内容或放进 Toggle 子树。定义必须覆盖本组全部启用的 Toggle，ID 和 Toggle 均唯一。

```ts
const tabs = this.nodeTabs.getComponent(TabGroup)!.bind(show.scope, [
    {
        id: 'goods',
        toggle: this.toggleGoods,
        open: async task => {
            const assets = show.assets.in(task.scope);
            const node = await assets.instantiate(ShopRes.prefab.goodsPart, task.parent, { active: false });
            task.commit(() => {
                node.getComponent(GoodsPart)!.render(model);
                assets.activate(node);
            });
        },
    },
    { id: 'details', toggle: this.toggleDetails, open: task => this.openDetails(task) },
]);
await tabs.select('goods');
```

`bind` 清除选择；由业务显式 `select(id)`。准备期间 `selected` 已是目标 ID，整个内容容器保持隐藏，open 完成后才显示。切换先取消并隐藏旧内容，等待旧任务、Part 和资源清理后才打开下一项。A→B→C 快速选择时，未启动的 B 不会打开，C 仍等待 A 的真实清理；同一有效 ID 复用当前操作，不重复创建，重复点击当前 Toggle 保持选中。

创建内容要使用提供的 `task.scope` 和 `task.parent`；不要从其他页面搬已有节点进来，也不要自行改变 Toggle 选择或重复绑定加载事件。每次重新进入都创建新内容，本组件不缓存页面。保持跨页签数据时把业务状态放在外部 Service，而非依赖 Part 实例存活。

加载失败向调用方/点击上报器交付原错误，清理失败内容并清除选中，可再次选择重试。关闭时恢复绑定前的 Toggle 状态与 allowSwitchOff。重绑前必须 `await` 旧句柄 dispose，确保 contentRoot 已为空；否则报 `TAB_SETUP`。非法 ID 报 `TAB_ID_INVALID`，不关闭当前页签。

## 示例与验证

预览 Bootstrap → **UI 与 Part → 通用组件 / 安全区与异步交互**。滚动页面可体验全部组件。示例代码为 `showcase/code/ui/ComponentsLabPage.ts`，业务预制体为 `showcase/bundles/default/dynamic/ui/ComponentsLabPage.prefab`。动态页签的测试示例使用同模块的 `ComponentTabPart.prefab`，继承现有自动 Binding 和 GameComponent。

```sh
npm run verify
npm run test:showcase
node tests/integration/verify-ui-components.mjs http://127.0.0.1:7456/
```

集成测试通过当前 Cocos MCP 创建独立隐藏预览窗口，使用真实引擎、Sprite 资源、Toggle、Widget、Part 与 Scope，验证 Inspector 配置、异步竞态、重复重试、校时、禁用/重绑/销毁、窗口旋转、嵌套及百分比安全区，并保存截图。结束时恢复设备与方向选项、关闭窗口。`author-ui-components.mjs` 和后续 `configure-ui-components.mjs` 是一次性制作记录，不属于日常测试，不能在已有内容上重复执行。

审查与实际验证范围见 [通用组件审查](ui-components-review.md)。微信和原生的真实安全区、前后台通知仍需目标设备验收。
