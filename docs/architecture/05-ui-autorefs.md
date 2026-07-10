# 05. UI 与 AutoRefs

## 设计结论

UIManager 不是单纯的层级管理器。终局设计里，它负责 View 的所有权、打开策略、导航协作、生命周期、结果回调和资源释放。

核心原则：

- View 的归属由 `Scope` 决定。
- View 的显示位置由 `ViewLayer` 决定。
- View 的行为由 `ViewPolicy` 决定。
- Module Navigator 只负责模块切换，UIManager 负责模块 UI 的关闭、暂停和恢复。
- View 之间不直接拿节点联动，联动通过 Flow、Service、Model、Event 或 `openForResult` 完成。

## UI 所有权

YZForge 区分两类 UI：

| 类型 | 所属 Scope | 生命周期 |
| --- | --- | --- |
| Global UI | `AppScope/global` | 随 App 存活，由 GlobalRoot 管理 |
| Module UI | `ModuleScope` | 随 Module 进入、暂停、恢复、退出、卸载管理 |

业务模块只能打开自己 Scope 的 View，或通过公开 API 请求 Global UI。模块不能直接打开另一个模块的 View。

Module 卸载时，框架必须关闭该模块拥有的所有 UI，并结束所有 pending 的 `openForResult`。

## 三个维度

UI 不只按层级分类，必须拆成三个维度：

| 维度 | 作用 | 示例 |
| --- | --- | --- |
| `ViewKind` | 语义类型 | Page、Paper、Popup、Toast |
| `ViewLayer` | 物理层级 | PageLayer、PopupLayer、SystemOverlayLayer |
| `ViewPolicy` | 行为策略 | 单例、入栈、遮罩、返回键关闭、模块退出关闭 |

`ViewKind` 不等于 `ViewLayer`。例如系统级确认弹窗的 `kind` 可以是 `Popup`，但物理层级可以放在 `System`。

```ts
export enum ViewKind {
    Page = 'page',
    Paper = 'paper',
    Popup = 'popup',
    Toast = 'toast',
    Top = 'top',
    System = 'system',
}

export enum ViewLayer {
    Page = 100,
    Paper = 200,
    Popup = 300,
    Toast = 400,
    Top = 500,
    System = 900,
}

export enum ViewStackMode {
    Single = 'single',
    Stack = 'stack',
    Queue = 'queue',
    Free = 'free',
}
```

默认物理节点：

```text
UIRoot
  UnderlayLayer
  PageLayer
  PaperLayer
  PopupLayer
  ToastLayer
  TopLayer
  SystemOverlayLayer
```

所有这些 Layer 都是全屏根。`ViewLayer.System` 的运行时物理节点名是 `SystemOverlayLayer`；`System` 保留为代码里的语义枚举，避免业务把它误解成普通页面层。

## ViewPolicy

View 的行为不靠文件名硬编码，而由生成的 `ViewRef` 携带策略。

```ts
export interface ViewPolicy {
    kind: ViewKind;
    layer?: ViewLayer;
    stack?: ViewStackMode;
    modal?: boolean;
    mask?: 'none' | 'dim' | 'transparent';
    singleton?: boolean;
    duplicate?: 'focus' | 'reject' | 'reopen';
    closeOnBack?: boolean;
    closeWithOwner?: boolean;
    pauseWithOwner?: boolean;
    cache?: 'none' | 'asset' | 'node';
}
```

打开时可以临时覆盖少量策略，但不能改变 View 所属 Scope：

```ts
export interface OpenViewOptions {
    key?: string;
    duplicate?: 'focus' | 'reject' | 'reopen';
    closeOnMask?: boolean;
    policy?: Partial<ViewPolicy>;
}
```

默认策略：

| Kind | Layer | Stack | 默认行为 |
| --- | --- | --- | --- |
| `Page` | `Page` | `Single` | 同 owner 互斥，模块退出关闭，模块暂停时隐藏，默认不响应返回键关闭 |
| `Paper` | `Paper` | `Stack` | 可入栈，模块暂停时隐藏，默认响应返回键关闭，模块退出关闭 |
| `Popup` | `Popup` | `Stack` | 默认模态、暗色遮罩、响应返回键关闭，模块退出关闭 |
| `Toast` | `Toast` | `Queue` | 非阻塞，自动关闭，不参与返回键 |
| `Top` | `Top` | `Free` | 常驻顶层，Module Top 随模块暂停隐藏和退出关闭，Global Top 随 App 存活 |
| `System` | `System` | `Single` | Loading、TouchMask、系统弹窗使用，优先级最高 |

命名规则仍然推荐保留：

```text
PageHome.prefab
PaperInventory.prefab
PopupSettings.prefab
ToastReward.prefab
TopDebug.prefab
```

命名只用于可读性和生成器默认推断，最终行为以 `ViewRef.policy` 为准。

## 打开 API

```ts
const page = await module.ui.open(assets.views.pageHome, data);
const result = await module.ui.openForResult(assets.views.popupSettings, data);

await module.ui.close(page);
await module.ui.close(assets.views.popupSettings);
await module.ui.closeLayer(ViewLayer.Popup);
await module.ui.back();
```

推荐接口：

```ts
export interface ModuleUI {
    open<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        options?: OpenViewOptions,
    ): Promise<ViewHandle<TResult>>;

    openForResult<TData, TResult>(
        ref: ViewRef<TData, TResult>,
        data?: TData,
        options?: OpenViewOptions,
    ): Promise<TResult | UiCancelResult>;

    close(target: ViewHandle | ViewRef, result?: unknown): Promise<void>;
    closeLayer(layer: ViewLayer, reason?: UiCloseReason): Promise<void>;
    closeOwned(reason?: UiCloseReason): Promise<void>;
    pauseOwned(): void;
    resumeOwned(): void;
    back(): Promise<boolean>;
}
```

`ViewHandle` 是运行时句柄，用于关闭、聚焦和查询状态。业务不要长期保存其他模块的 handle。

取消结果使用统一结构，方便业务稳定判断：

```ts
export interface UiCancelResult {
    readonly cancelled: true;
    readonly reason?: unknown;
}

export function isUiCancelResult(value: unknown): value is UiCancelResult;
```

## View 状态

```ts
export enum ViewState {
    Closed = 'closed',
    Loading = 'loading',
    Opening = 'opening',
    Open = 'open',
    Paused = 'paused',
    Closing = 'closing',
    Disposed = 'disposed',
    Failed = 'failed',
}
```

规则：

- 同一个 `ViewRef` 打开中时，后续打开按 `duplicate` 策略处理。
- `focus` 返回已有 handle 并把 View 提到当前栈顶。
- `reject` 直接抛出可识别错误。
- `reopen` 先关闭旧实例，再打开新实例。
- 多实例必须显式声明，并提供 instance key 或由框架生成 handle id。

## 打开流程

```text
validate owner and ViewRef
apply ViewPolicy
dedupe by ViewRef and instance key
state = Loading
load prefab through owner AssetScope
instantiate prefab
bind app/module/owner/ref/policy
bind AutoRefs
state = Opening
beforeOpen(data)
attach node to target ViewLayer
push stack or queue
create or update mask
onOpen(data)
state = Open
return ViewHandle
```

失败处理：

- `beforeOpen` 失败时，不进入 UI 栈。
- 加载或实例化失败时，销毁已创建节点并释放本次 acquire。
- 已进入栈后失败，按 `open_failed` 原因执行强制关闭。
- Module 在打开过程中卸载时，打开任务被取消，Promise 不悬挂。

## 关闭流程

```text
if not forced:
  beforeClose(reason)
  if false: cancel close
state = Closing
resolve or cancel openForResult
onClose(result, reason)
remove from stack or queue
remove or update mask
onDispose()
clear disposables
destroy node or move to cache
release owner asset refs according to cache policy
state = Disposed
```

规则：

- `beforeClose` 返回 `false` 时取消关闭。
- 强制关闭会跳过 `beforeClose` 的取消能力，但仍调用 `onClose` 和 `onDispose`。
- `onDispose` 必须只做本 View 的清理，不主动关闭其他 View。
- 第一版默认 `cache = asset`：关闭时销毁节点，prefab 资源跟随 owner Scope 缓存到模块卸载。
- `cache = node` 作为扩展能力，第一版不要求实现。

## 暂停与恢复

暂停用于 `EnterMode.Push` 这类“临时进入另一个模块”的场景，不等于关闭，也不是 Cocos 的 `director.pause()`。

```text
pause:
  state Open -> Paused
  hide node or disable owner layer input
  keep View instance and AutoRefs
  keep owner asset refs
  do not call beforeClose / onClose / onDispose

resume:
  state Paused -> Open
  show node or restore owner layer input
  keep original stack order
```

规则：

- Page、Paper、Module Top 默认可以暂停。
- Popup、Toast 默认不暂停，模块被压到后台时直接关闭。
- Paused View 不接收输入，也不刷新动画。
- 如果模块在 Paused 状态下卸载，仍然按强制关闭流程销毁 UI。

## View

View 是 Cocos Component，可以持有 `Node`、`Label`、`Sprite`、`Button`、`Animation` 等显示组件。

职责：

- 展示界面。
- 绑定节点。
- 响应用户输入。
- 调用本模块 Flow 或 Service。
- 刷新 Model 快照。

生命周期：

```ts
export abstract class View<TData = unknown, TResult = unknown> extends Component {
    public readonly app: App;
    public readonly owner: UiOwner;
    public readonly module?: Module;
    public readonly handle: ViewHandle<TResult>;

    protected beforeOpen(data: TData): void | Promise<void>;
    protected onOpen(data: TData): void | Promise<void>;
    protected beforeClose(reason: UiCloseReason): boolean | void | Promise<boolean | void>;
    protected onClose(result: TResult | undefined, reason: UiCloseReason): void | Promise<void>;
    protected onDispose(): void;

    protected close(result?: TResult): Promise<void>;
    protected cancel(reason?: unknown): Promise<void>;
    protected listen<T extends Node>(
        node: T,
        type: string,
        callback: (...args: unknown[]) => void,
        target?: unknown,
    ): void;
    protected addDisposer(disposer: () => void): void;
}
```

规则：

- View 不长期持有其他模块的 Handle。
- View 可以调用本模块 Service 或 Flow。
- View 订阅事件、按钮、计时器、tween 必须通过 `listen` 或 `addDisposer` 登记。
- `onDispose` 后，框架会统一清理登记过的 listener 和 disposer。
- View 不直接读取或修改另一个 View 的节点。

## Part

Part 是无栈 UI 片段。

典型场景：

- 列表项。
- 卡片。
- 弹窗内部局部组件。
- 动态创建的 UI 片段。
- ContentPack 提供的可挂载内容片段。

生命周期：

```ts
export abstract class Part<TData = unknown> extends Component {
    protected onInit(data: TData): void | Promise<void>;
    protected onDispose(reason?: unknown): void | Promise<void>;
}
```

Part 不进入 UI 栈，不拥有 Page、Paper、Popup 生命周期。业务通过 `module.assets.createPart()` 获得独立 `PartLease`；手工 release 或 Module owner scope 关闭都会执行 dispose、销毁 Node 并释放 prefab asset。初始化控制方法不出现在业务 API。

## UI 联动

推荐方向：

```text
View -> Flow -> Service -> Model/Event -> View refresh
Popup -> openForResult -> Flow continues
Global UI request -> Global public API -> Global View
```

规则：

- View A 不直接拿 View B 的节点。
- Service 不直接打开 UI，也不长期持有 Node 或 Component。
- Flow 可以打开、关闭、等待 UI 结果。
- 多个 View 需要同步时，优先通过 Model 快照和 EventBus。
- Popup 的确认、取消、选择结果用 `openForResult`，不要用全局临时变量。
- Global UI 只通过公开 facade 提供能力，例如 toast、loading、system confirm。

## 模块导航协作

Module Navigator 与 UIManager 的边界：

| 场景 | Navigator | UIManager |
| --- | --- | --- |
| `Replace` | 退出旧模块，进入新模块 | 默认关闭旧模块所有 Module UI |
| `Push` | 暂停旧模块，压入新模块 | 暂停旧模块 Page、Paper、Top，关闭旧模块 Popup、Toast |
| `back` | 退出当前模块，恢复上一个模块 | 关闭当前模块 UI，恢复上一个模块暂停的 UI |
| `unload` | 销毁模块实例 | 强制关闭该模块所有 UI 和 pending result |

`Push` 下不建议保留旧模块 Popup，因为弹窗通常绑定当前流程上下文，跨模块恢复容易产生错误。需要跨模块保持的提示应做成 Global UI。

## 返回键

硬件返回键或 `app.back()` 应先交给 UIManager：

```text
if System modal blocks back:
  consume
else if top Popup closeOnBack:
  close Popup and consume
else if top Paper closeOnBack:
  close Paper and consume
else:
  ModuleNavigator.back()
```

规则：

- Toast 不消费返回键。
- Page 默认不被返回键直接关闭。
- Loading 和 TouchMask 默认阻断返回键。
- Popup 可以配置 `closeOnBack = false`，用于强确认或强制流程。

## 遮罩与阻塞

Popup 遮罩由 UIManager 统一创建，不由业务 prefab 自己创建。

规则：

- 遮罩数量由 Popup 栈决定，默认只显示当前最高模态 Popup 的遮罩。
- 透明遮罩只吞触摸，不改变视觉。
- 暗色遮罩可配置透明度，但第一版只提供全局默认值。
- 点击遮罩是否关闭由 `OpenViewOptions.closeOnMask` 或 `ViewPolicy` 决定。
- System Layer 的 TouchMask 优先级高于所有普通 Popup 遮罩。

## openForResult

`openForResult` 用于 Popup 或 Paper 的结果回调：

```ts
const result = await module.ui.openForResult(assets.views.popupConfirm, {
    title: 'Exit?',
});
```

View 内部关闭：

```ts
await this.close({ confirmed: true });
await this.cancel('user_cancel');
```

规则：

- 同一个 `ViewRef` 同一时刻只能有一个 pending result，除非显式允许多实例。
- View 调用 `close(result)` 时，Promise resolve result。
- View 调用 `cancel(reason)` 时，Promise resolve `UiCancelResult`，不悬挂。
- Module 卸载、导航退出、强制关闭导致关闭时，Promise resolve `UiCancelResult`。
- `Toast` 不支持 `openForResult`。

## AutoRefs

目标：

- 避免大量手拖 `@property`。
- 避免节点重命名后隐藏错误。
- 让 View/Part 拥有类型安全节点引用。

生成方式：

```text
res/view/PageHome.prefab
  -> code/view/refs/PageHome.refs.generated.ts

res/part/PartRewardCell.prefab
  -> code/part/refs/PartRewardCell.refs.generated.ts
```

这是默认生成路径。项目可以配置 AutoRefs 输出目录；框架只要求 View/Part prefab、业务脚本和 refs generated 文件之间能被生成器稳定映射。

业务类：

```ts
import { PageHomeRefs } from './refs/PageHome.refs.generated';

export class PageHome extends PageHomeRefs {
    protected onOpen(): void {
        this.title.string = 'Home';
    }
}
```

推荐标记：

```text
@title
@startButton
@avatar:Sprite
@countLabel:Label
```

规则：

- generated 文件不允许手改。
- 手写 View 文件不允许被覆盖。
- 生成器只读取约定标记的节点。
- 节点缺失时启动或打开 UI 直接报清晰错误。
- 组件类型不匹配时报错，不降级为 `Node`。
- View prefab 必须挂载对应 View 类。
- Part prefab 必须挂载对应 Part 类。

## UI 资源归属

```text
assets/app/global/res/view      Global UI
assets/modules/Home/res/view    Home Module UI
assets/modules/Home/res/part    Home Module Part
```

禁止：

```text
Home Module 打开 Battle Module 的 View
Home Module import Battle Module 的 PageBattle
Global UI import Module 内部 View
ContentPack 提供 Page/Paper/Popup
```

ContentPack 可以提供内容 prefab 或 Part prefab，但不作为 UIManager View 打开。若某个关卡内容需要 UI，应由 owner Module 的 View/Flow 解释和打开。

## 系统 UI

系统 UI preset 放在：

```text
assets/app/main/presets/
```

包括：

- `UILoading.prefab`
- `UIShadow.prefab`
- `UITouchMask.prefab`
- `UIToast.prefab`

系统 UI 属于 `AppScope`，不属于任意 Module。Module 可以请求显示 Loading 或 Toast，但不能持有系统 UI 节点。

## 第一版边界

第一版必须支持：

- View 所有权。
- ViewPolicy。
- Page 互斥。
- Paper/Popup 栈。
- Popup 遮罩。
- Loading。
- Toast。
- TouchMask。
- 打开中防重复。
- 关闭中防重入。
- openForResult。
- 返回键处理。
- Module UI 暂停和恢复。
- Module 卸载时关闭本模块 UI。
- Global UI 与 Module UI 隔离。
- View listener 和 disposer 自动清理。

第一版不做：

- 复杂窗口动画编辑器。
- 新手引导。
- 红点系统。
- FairyGUI。
- 多场景 UI。
- 节点级 UI 缓存池。

这些作为扩展。
