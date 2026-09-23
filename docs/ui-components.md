# 通用 UI 组件

入口：**添加组件 → YZForge → UI**。组件挂在节点上，通过自身接口使用；普通操作不需要先 bind 或传 Scope。示例入口：**UI 与 Part → 通用组件**。

| 组件           | 挂载方式                                      | 常用接口                                      |
| -------------- | --------------------------------------------- | --------------------------------------------- |
| SafeWidget     | 挂在固定布局节点，自动补齐 Widget/UITransform | refresh、setBaseOffsets                       |
| AsyncButton    | 直接作为 Button 使用，同节点无需再挂 Button   | run、interactable、clickEvents                |
| AsyncSprite    | 直接作为 Sprite 使用，同节点无需再挂 Sprite   | setSource、spriteFrame、sizeMode              |
| CountdownLabel | 直接作为 Label 使用，同节点无需再挂 Label     | startFor、startUntil、restart、stop、fontSize |
| Switch         | 挂在要切换子节点的父节点上                    | updateCheck、updateCheckByName                |
| MarqueeLabel   | 挂在空 UI 节点，自动创建裁剪与文本            | string、speed、play、pause、restart           |

按钮、图片、倒计时直接继承 Cocos 原生类型。字体、颜色、按钮过渡、九宫格等仍使用原生属性；getComponent(Button/Sprite/Label) 也能取得相应子类。工作台按 btn_、spr_、lbl_ 识别实际项目子类，生成 AsyncButton、AsyncSprite、CountdownLabel 等具体类型，直接调用扩展方法。Switch 等普通组件可用 comp_；多个匹配组件按 Inspector 顺序取第一个，详见[自动绑定](auto-binding.md)。

Switch、SafeWidget、滚动文本以及按钮 run、倒计时可在普通节点使用。AsyncSprite 的 spriteFrame 是普通原生接口；按逻辑资源名 setSource 时需要模块的 Assets，框架 UI/Part 自动注入，手工场景使用已有 app.bindScene。不会另起 resources.load 或全局资源单例绕过框架持有规则。

## Switch：只做子节点切换

在父节点挂 Switch，Inspector 配置“显示的子节点索引”，默认 [0]。直接子节点可自由命名，不需要 ToggleContainer，也不限制只能显示一个。

```ts
const content = this.compState;
content.updateCheck(0);                     // 显示第一个
content.updateCheck(0, 2);                  // 同时显示第一、第三个
content.updateCheck();                      // 全部隐藏
content.updateCheckByName('content');        // 按名字选择
content.updateCheckByName('icon', 'badge');  // 可多选
```

按名字选择会同步保存当前索引，再次启用不会退回旧选择。重复索引去重；不存在的索引或名字忽略，同名节点全部选中。checkIndex 返回副本，直接给 checkIndex 赋新数组也会立即刷新。代码增删或重排子节点后调用 refresh，选择仍按索引解释。

Button.clickEvents 可直接指向 Switch.selectFromEvent，自定义事件数据填写名字；多选用英文逗号分隔。切换不会销毁节点、创建 Part 或发起请求。加载/内容/空/错误可用四个子节点和 Switch 表达；请求取消、重试和数据由业务处理。

## AsyncButton：按钮本身可执行异步工作

默认 autoGuard=true，clickInterval=0.3 秒，普通点击事件仍在本组件的 clickEvents 配置。真实异步任务调用 run，任务与异步清理全部结束后才恢复可点击。

```ts
const button = this.btnSubmit;
await button.run(async task => {
    const result = await service.submit(task.signal);
    task.commit(() => { this.lblResult.string = result.message; });
});
```

在组件启用后的事件中调用。忙碌、禁用、框架尚未允许当前页面工作或旧停用尚未排空时返回 false；成功返回 true，业务失败拒绝 Promise。busyVisual 是可选提示子节点。禁用/销毁同步取消，迟到结果不能通过 task.commit 回写。

## AsyncSprite：保留原生 Sprite，用一行换资源

Inspector 的 source 填当前模块逻辑资源名即可自动加载，留空保留原生静态图；placeholder 和 failure 分别指定加载及失败图。

```ts
const image = this.sprIcon;
await image.setSource('icons/alpha/token');
await image.setSource(null); // 清空并等待旧任务和资源归还
// 已有 SpriteFrame 也可直接使用 image.spriteFrame = frame。
```

setSource 接受 SpriteFrame 资源 Key 或逻辑名称，不是 URL、磁盘路径或 ImageAsset。连续换图取消旧请求，仅最新请求能够显示；每次成功持有资源到替换、清空或禁用。仍使用已有 Assets 的加载合并和引用管理。Button.clickEvents 可指向 loadFromEvent，自定义事件数据填逻辑名称。调用方处理加载失败和 OperationCancelled。

## CountdownLabel：文本本身就是倒计时

原生 Label 属性直接可用。autoStart 默认 true，duration 默认 60 秒；textFormat 支持 {hh}、{mm}、{ss}、{seconds}，默认 {hh}:{mm}:{ss}。mm 是小时内分钟，seconds 是剩余总秒数。

```ts
const timer = this.lblCountdown;
timer.textFormat = '剩余 {seconds} 秒';
timer.startFor(30);
timer.startUntil(offer.endsAtMs); // UTC 毫秒截止时间
timer.stop();                    // 保留最后文字
timer.restart();                 // 使用 Inspector 中的 duration
```

普通独立节点读取设备时间，框架实例自动使用现有 TimeService。根据绝对截止时刻计算，不靠 dt 累减；每秒变化才更新文字。前台恢复与校时立即重算。completedEvents 每次计时只触发一次，时钟回拨不会重复；重新开始会取消旧的待执行完成通知。禁用时取消订阅与完成任务，再次启用按 autoStart 配置启动。

## MarqueeLabel：固定宽度，超宽自动滚动

挂在空 UI 节点，UITransform 的宽高就是可见区域。填 string、字体、字号、行高、颜色；速度 speed 是每秒设计像素，pauseDuration 是首尾各停留的秒数。默认单行、左对齐、往返滚动：读完末尾后平滑返回开头。短文本和空文本保持静止，换行会转为空格。

```ts
const text = this.nodeMessage.getComponent(MarqueeLabel)!;
text.string = message;
text.speed = 60;
text.pauseDuration = 1;
text.pause();   // 保持位置
text.play();    // 继续
text.restart();// 从开头重新播放
```

string、字体、字号或容器宽度变化会重新测量并从开头开始。普通赋值下一帧生效，需要同帧测量可调用 refresh。只改文字子节点的位置，不改根节点尺寸或位置，能配合外部 Widget；稳定滚动不重新生成文字贴图。禁用隐藏自有文字且不再更新，重新启用按 autoPlay 从开头播放。

这个组件采用容器组合，因为 [Cocos Mask 只裁剪子节点，不能和 Label 放在同一个渲染节点](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/mask.html)。组件会自动创建文本子节点，使用方不必搭层级。Mask 与 MarqueeText 由组件管理，不要再在根节点叠加 Sprite/Label。字体资源使用原生 Label 的字体行为，编辑器只预览内容，不播放滚动。

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

## 列表复用与自定义期限

普通操作使用上面的组件接口；需要 item.scope、自定义时间源或指定资源入口时，可使用高级 bind。每次返回的句柄只操作自己的绑定，旧 dispose 不会影响新绑定。

```ts
const image = this.sprIcon.getComponent(AsyncSprite)!.bind(item.scope, this.ctx.assets);
await image.set(ItemRes.sprite.icon);

const click = this.btnSubmit.getComponent(AsyncButton)!.bind(item.scope, async task => {
    await service.submit(task.signal);
    task.commit(() => this.renderDone());
});
click.setInteractable(true);
await click.press();

this.lblCountdown.getComponent(CountdownLabel)!.bind(item.scope, this.ctx.time, {
    deadlineMs: offer.endsAtMs,
    format: seconds => seconds + ' 秒',
    onComplete: task => { task.commit(() => this.renderExpired()); },
});
```

显式绑定允许在首次启用前配置，优先于自动 Inspector 行为。bind 同步取消旧绑定，旧任务由原 Scope 继续排空；停用后的完整清理期间重绑会报 UI_COMPONENT_DRAINING，应在下一次激活/列表 render 时绑定。图片句柄提供 set/state/dispose，状态为 empty/loading/ready/error；set(null) 同步清空但不等待旧请求物理退出，dispose 等待。倒计时句柄提供 refresh/dispose。

clear 关闭组件当前绑定，dispose 关闭指定绑定，均返回排空 Promise。不要在一个任务内部等待自己的 clear/dispose，否则会等待自身。业务必须响应 signal，await 后用 task.commit；不响应取消的物理任务仍会阻塞完整清理。原生继承没有放弃 Scope：内部是普通 TypeScript 生命周期对象，不是额外挂载的组件；UI、Part、场景绑定与 VirtualList 的现有实例遍历都会收集它们并等待关闭。

## 示例与验证

业务示例位于 [ComponentsLabPage](../assets/game/modules/showcase/code/ui/ComponentsLabPage.ts) 和同名预制体。换图、Switch、倒计时和长短文本切换可查看 Inspector 事件配置。

```sh
npm run verify
npm run test:showcase
node tests/integration/verify-ui-components.mjs http://127.0.0.1:7456/
```

将示例 URL 替换为当前项目的本机预览或 Web 运行地址。脚本通过 MCP 创建独立隐藏预览，检查真实鼠标输入、资源、独立节点、框架生命周期、切换与滚动、安全区和横竖屏，并保存截图；结束恢复预览选项并关闭窗口。平台边界见 [实现范围与验证](implementation-status.md)，微信及原生真机仍需设备验收。
