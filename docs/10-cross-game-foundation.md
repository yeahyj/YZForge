# 10. Viewport、SafeArea 与系统 UI 基础设计

## 设计结论

这部分不应该做成“大而全通用游戏框架”。YZForge 核心只接收会影响 `App`、`Main` 场景、`UIRoot`、`UIManager` 和 Validator 的基础能力。

第一版核心只做：

- `ViewportManager`：统一读取屏幕、设计分辨率、可视区域、安全区。
- `AppBootSettings`：启动前渠道和运行 profile 设置。
- 标准 `MainRoot` / `UIRoot` / 全屏 UI Layer 结构。
- 最小安全区与全屏适配组件。
- 系统 UI preset：Loading、TouchMask、Toast、PopupMask。
- App 前后台与 viewport changed 事件。
- Validator 检查 Main 场景和业务绕过规则。

其他能力，例如 Debug HUD、错误上报、音频、存档、网络、平台、多语言、新手引导、红点、热更新，都应该通过 Extension 进入。

## 参考来源

参考框架：

- XForge2：https://gitee.com/cocos2d-zp/xforge2
- Oops Framework：https://gitee.com/dgflash/oops-framework
- Bit Framework：https://github.com/gongxh0901/bit-framework
- MKFramework：https://gitee.com/muzzik/MKFramework

可吸收方向：

| 框架 | 可吸收方向 | YZForge 取舍 |
| --- | --- | --- |
| XForge2 | 轻核心、扩展包、UI 管理、自动化插件、团队协作和 Prefab / Scene 冲突控制。 | 保持核心小，把可选能力做成 Extension。 |
| Oops Framework | 常用游戏技术集合、框架工具、启动流程、Loading、Toast、安全区等经验。 | 吸收 App / UI 基础能力，不照搬大功能库。 |
| Bit Framework | Monorepo 模块化、类型安全、事件、资源、网络、热更、小游戏平台等独立模块。 | 学习“按需模块化”，对应 YZForge 的 Extension / Library。 |
| MKFramework | 资源管理、UI 管理、音频、本地化、网络、模块生命周期、UI 栈。 | 用于校对常见游戏系统清单，但不全部进入核心。 |

Cocos 官方能力：

- `SafeArea` 用于异形屏安全区，内部基于 `sys.getSafeAreaRect` 并通过 `Widget` 调整节点。
- 多分辨率适配以 Canvas 的 `Fit Width` / `Fit Height` 为基础，配合 `Widget` 保证 UI 元素位于可见区域。

## 核心边界

进入核心必须同时满足：

1. 大多数游戏都会遇到。
2. 必须和 `App`、`UIRoot`、`UIManager` 或资源生命周期协作。
3. 不依赖具体平台 SDK。
4. Validator 能检查是否接入正确。

因此：

| 能力 | 归属 | 原因 |
| --- | --- | --- |
| 安全区、刘海屏、长宽屏适配 | 核心 | UIRoot、PopupMask、Toast、Loading 都依赖同一份屏幕信息。 |
| Main 场景 UI 层级 | 核心 | UIManager 需要稳定挂载点。 |
| Loading / TouchMask / Toast / PopupMask | 核心模板 | 属于系统 UI 基础设施。 |
| App 前后台、viewport changed | 核心 | 扩展和 Module 都需要统一事件源。 |
| Debug HUD、性能面板 | Extension | 发布包通常禁用，不应污染核心。 |
| 音频、存档、网络、平台、多语言 | Extension | 策略差异大，依赖项目和平台。 |
| ECS、MVVM、战斗框架、行为树 | 业务 / Library / Extension | 会改变项目架构风格或强玩法相关。 |

## ViewportManager

`ViewportManager` 是 App 级服务，随 `App.start` 初始化。业务 Module 只能读取它，不能修改分辨率策略。

```ts
export interface EdgeInsets {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

export interface RectLike {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface DeviceProfile {
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly visibleWidth: number;
    readonly visibleHeight: number;
    readonly designWidth: number;
    readonly designHeight: number;
    readonly aspectRatio: number;
    readonly orientation: 'portrait' | 'landscape';
    readonly safeArea: RectLike;
    readonly safeInsets: EdgeInsets;
}

export interface ViewportConfig {
    readonly designWidth: number;
    readonly designHeight: number;
    readonly fit: 'width' | 'height' | 'auto';
}
```

推荐用法：

```ts
await app.start({
    viewport: {
        designWidth: 1334,
        designHeight: 750,
        fit: 'auto',
    },
});

const profile = app.viewport.profile;
```

职责：

- 读取 Cocos frame size、visible size、design resolution、safe area。
- 计算 `safeInsets`。
- 监听 viewport 变化，并派发 `viewport-changed`。
- 只在 `App.start` 阶段应用分辨率策略。
- 给 UI 适配组件、UIManager、Validator 提供同一份 `DeviceProfile`。

非职责：

- 不让业务 Module 调用 `setDesignResolutionSize`。
- 不替代所有布局组件。
- 不处理平台 SDK 的特殊安全区补偿。平台补偿由 `yzforge-platform` 扩展注入。

## Main 场景结构

当前 UI 文档已有 `UIRoot -> PageLayer / PaperLayer / PopupLayer / ToastLayer / TopLayer / SystemOverlayLayer`。最终结构不再设置全局 `SafeAreaRoot` 父节点，而是让所有标准层都占满真实可视区域；某个 View 内部是否使用安全区，由该 View prefab 自己决定。

标准结构：

```text
MainRoot
  AppBootSettings
  Canvas
    UIRoot
      UnderlayLayer
      PageLayer
      PaperLayer
      PopupLayer
      ToastLayer
      TopLayer
      SystemOverlayLayer
```

节点职责：

| 节点 | 作用 |
| --- | --- |
| `UnderlayLayer` | 全局底层背景、场景遮罩、全屏特效，可延伸到刘海和边缘。 |
| `PageLayer` | Page。全屏背景和安全区内容都由 Page prefab 自己组织。 |
| `PaperLayer` | Paper。允许一个 Paper 同时拥有全屏背景和安全区内容。 |
| `PopupLayer` | Popup 和 PopupMask。 |
| `ToastLayer` | Toast。 |
| `TopLayer` | 常驻顶层 UI。 |
| `SystemOverlayLayer` | Loading、TouchMask、系统确认框，优先级最高。 |

默认规则：

- 所有标准 Layer 都直接挂在 `UIRoot` 下，并挂载 `YZFullScreenRoot`。
- `UIManager` 只负责把 View 挂到正确 Layer，不负责替 View 创建安全区结构。
- 如果某个 View 需要“全屏背景 + 安全区内容”，在该 View prefab 内部自行拆节点。
- Loading、TouchMask 和系统弹窗挂在 `SystemOverlayLayer`。
- Popup 遮罩仍由 UIManager 创建，不放进业务 prefab。

## 适配组件

核心组件保持最小。

| 组件 | 是否核心 | 用途 |
| --- | --- | --- |
| `YZSafeAreaRoot` | 是 | 将节点约束到 `app.viewport.profile.safeArea`。由业务 View prefab 按需使用，不挂在 Main 场景全局根上。 |
| `YZFullScreenRoot` | 是 | 将节点约束到真实可视区域。默认挂在所有标准 Layer。 |
| `YZScreenFitter` | 是 | 对背景或容器执行 contain / cover 适配。 |
| `YZEdgePin` | 否 | 作为模板工具组件，可后续提供。 |
| `YZAspectFitter` | 否 | Cocos 和业务可自行处理，第一版不进核心。 |

这样设计的原因：

- Cocos 已有 `SafeArea`、`Widget`、Canvas 适配能力，YZForge 不应该重复造完整 UI 布局系统。
- 核心只需要确保框架 Layer、系统 UI、PopupMask、Toast 能拿到统一 viewport 信息。
- 更细的 UI 布局应该留给业务 prefab、Cocos Widget 或后续工具组件。

View prefab 内部推荐模式：

```text
PaperShop
  FullscreenBackground
  SafeContent
    YZSafeAreaRoot
```

这里 `PaperShop` 挂到 `PaperLayer` 后仍然占据全屏 Layer。背景节点可以铺满屏幕，`SafeContent` 再通过 `YZSafeAreaRoot` 避开刘海和系统手势区域。框架生成 prefab 时不预设这个结构，开发者根据界面需要自行创建。

## 分辨率策略

第一版只支持三种 App 级策略：

| 策略 | 说明 |
| --- | --- |
| `width` | 固定设计宽度，高度随设备变化。适合竖屏项目。 |
| `height` | 固定设计高度，宽度随设备变化。适合横屏项目。 |
| `auto` | 根据设计比例和设备比例自动选择 `width` 或 `height`。 |

不在第一版暴露 `show-all`、`no-border` 等细节命名。底层如果需要可以映射到 Cocos Canvas 配置，但 YZForge 对业务只提供这三种项目级策略。

约束：

- 分辨率策略在 `App.start` 之前确定。
- 运行时切换策略只允许 App 或 Platform Extension 发起。
- Module 不允许直接修改 Canvas 或 Design Resolution。
- Validator 检查业务代码是否直接调用 Cocos 分辨率 API。

## App 生命周期事件

核心提供统一事件源：

```ts
app.lifecycle.on('foreground', callback);
app.lifecycle.on('background', callback);
app.lifecycle.on('viewport-changed', callback);
app.lifecycle.on('memory-warning', callback);
```

用途：

- UI 适配组件刷新布局。
- Module 可选择刷新显示数据。
- Audio、Platform、Storage、Net 等 Extension 订阅前后台事件。
- Runtime 订阅 `memory-warning`，在 Cocos 低内存事件到来时清理零引用热缓存 Bundle。

这些事件只表达 App 状态，不等同于 Module Navigator 的 `pause` / `resume`。Module 被 Push 到后台仍由 Navigator 管理。

## 系统 UI Presets

系统 UI preset 属于 `AppScope`：

```text
assets/app/main/presets/
  UILoading.prefab
  UITouchMask.prefab
  UIToast.prefab
  UIPopupMask.prefab
```

规则：

- Module 只能通过 `module.ui`、Extension token 或框架提供的公开 facade 请求系统 UI，不能直接访问 `app.ui`。
- Module 不能直接持有系统 UI 节点。
- `UIPopupMask` 由 UIManager 自动挂到 `PopupLayer`，业务 Popup prefab 不自带遮罩。
- `UITouchMask` 挂到 `SystemOverlayLayer`，用于阻断所有普通 UI 输入。

## Editor

编辑器插件第一版需要支持：

- 创建或修复 Main 场景 UIRoot 结构。
- 创建系统 UI preset。
- 创建 View prefab 时按 ViewKind 选择默认挂载层。
- 创建 View/Part prefab 时只生成最小根节点和对应脚本，不预设全屏背景、安全区内容或业务控件。
- 面板提供 Main 场景检查入口。

不做：

- 复杂设备预览器。
- 可视化窗口动画编辑器。
- 平台 SDK 安全区补偿配置。

## Validator

第一版必须检查：

- Main 场景存在 `MainRoot`、`Canvas`、`UIRoot`、`UnderlayLayer`、标准 UI Layer 和 `SystemOverlayLayer`。
- `MainRoot` 挂载 `Main` 和 `AppBootSettings`。
- Main 场景不允许全局 `SafeAreaRoot`。
- 所有标准 Layer 挂载 `YZFullScreenRoot` 或等价内置适配组件。
- UIManager 的层级映射指向标准 Layer。
- 业务 Module 不直接调用 Cocos 分辨率 API。
- 业务 Module 不直接读取 `sys.getSafeAreaRect`，必须通过 `app.viewport.profile`。

暂不检查：

- 交互按钮是否放在背景层下。这个规则静态误报率高，第一版不做硬校验。
- 所有节点是否都完美适配安全区。这个应由视觉验收和示例约束。

## Extension 划分

官方 Extension 优先级：

| Extension | 职责 |
| --- | --- |
| `yzforge-debug` | FPS、内存、Bundle、Asset、UI、Navigator 快照面板。 |
| `yzforge-audio` | BGM、SFX、Voice、音量、前后台暂停恢复。 |
| `yzforge-storage` | 本地存档、设置、加密 / 压缩 codec。 |
| `yzforge-platform` | 登录、渠道、支付、广告、分享、平台安全区补偿。 |
| `yzforge-net` | HTTP、WebSocket、重连、心跳、请求取消。 |
| `yzforge-i18n` | 文本表、多语言资源、字体 fallback、运行时语言切换。 |
| `yzforge-guide` | 新手引导。 |
| `yzforge-redpoint` | 红点与条件系统。 |

这些能力可以复用 `App`、`EventBus`、`Config`、`AssetScope` 和 `ExtensionRegistry`，但不能反过来要求核心依赖它们。

## 实现顺序

建议顺序：

1. 新增 `ViewportManager`、`DeviceProfile`、`ViewportConfig`。
2. `App.start` 接入 viewport 初始化。
3. 新增 `YZSafeAreaRoot`、`YZFullScreenRoot`、`YZScreenFitter`。
4. 统一 Main 场景标准结构，并让 UIManager 使用 `UIRoot` 下的标准全屏 Layer。
5. Editor 增加 Main 场景创建 / 修复能力。
6. Validator 增加 Main 场景和 viewport API 边界检查。
7. 用 MCP 创建真实 Main 场景验收：普通屏、长屏、带安全区三种配置。
8. 再做 `yzforge-debug`，把 viewport / UI / resource 快照可视化。

## 第一版验收

第一版闭环标准：

```text
App.start
  -> 读取 AppBootSettings
  -> 初始化 ViewportManager
  -> 生成 DeviceProfile
  -> 校验 MainRoot / UIRoot
  -> UIManager 绑定标准 Layer
  -> Page / Popup / Toast / System UI 打开到正确层
  -> 所有标准 Layer 覆盖真实屏幕区域
  -> View prefab 按需使用 YZSafeAreaRoot 避开刘海和系统手势区域
  -> viewport changed 触发适配组件刷新
  -> Validator 阻止业务绕过 app.viewport
```

这个闭环完成后，再考虑音频、存档、平台、网络、多语言等 Extension。否则核心会过早变重，偏离 YZForge 的 Scope / Contract / Bundle / Handle 主线。
