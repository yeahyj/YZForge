# 11. YZForge 重构 RFC

## 结论

这份方案是 YZForge 的终局架构契约，不是临时方案。实现可以分阶段推进，但目标形态不分“过渡版”和“长期版”两套。

终局骨架：

```text
ScopeManifest 是事实源
Contract 留在首包
BundleHandle 管物理加载
ReleaseScope 执行释放
OwnershipLedger 记录所有权
Handle 是运行时唯一访问入口
Validator 把规则变成硬约束
Extension 只能通过上下文和 token 进入核心
```

后续实现不能引入另一套临时访问路径、临时资源释放规则或临时 UI 根节点查找机制。任何实现阶段的取舍都必须服务于这份终局契约。

## 为什么要重构

当前框架的方向是对的，尤其是 `Scope / Contract / Bundle / Handle` 四层模型。但实现还存在几类系统性风险：

- 裸目录可以逃过 Scanner 和 Validator。没有 `module.json` 的 `assets/modules/*` 目录不会被视为错误。
- App 启动没有显式 Main 场景绑定，UIManager 通过递归节点名寻找 Layer。
- 第 10 章里的 `ViewportManager`、`SafeAreaRoot`、`FullscreenLayer`、`app.lifecycle` 还没有进入 runtime。
- Module、Library、ContentPack、UI、Asset 都各自处理所有权，但没有统一的释放作用域和所有权账本。
- 卸载流程缺少强制清理语义，生命周期抛错时可能阻断资源释放。
- Library token contract 可以生成，但 runtime provider 绑定还没有形成闭环。
- Config 与 ContentPack manifest 仍偏空壳，不能证明内容包配置的独立加载和释放。

重构目标不是把框架做大，而是把已经写进文档的边界变成代码不可绕过的规则。

## 非目标

本次重构不做这些事：

- 不引入 ECS、MVVM、FairyGUI、行为树或战斗框架。
- 不把 audio、storage、network、platform、i18n 放进核心。
- 不做完整热更新系统。
- 不要求所有项目采用同一种业务目录风格。
- 不为了兼容当前空示例保留旧路径猜测和隐式 fallback。

## Runtime 目录终局命名

两个 `runtime` 目录必须改名解决歧义。终局命名如下：

```text
extensions/yzforge/runtime-template/
  插件携带的运行时代码模板。它是框架分发和同步来源，不参与游戏运行 import。

assets/yzforge/runtime/
  项目实际运行时代码。它是 Cocos 构建和业务 import 的唯一 runtime 入口。
```

规则：

- 废弃 `extensions/yzforge/runtime/` 这个路径名，改为 `extensions/yzforge/runtime-template/`。
- 业务和生成代码只能从 `yzforge` 顶层桶入口 import 框架 runtime API。
- `yzforge/modules/*`、`yzforge/libraries/*`、`yzforge/content-packs/*` 只暴露首包 registry/ref，不是 runtime 深路径。
- 不再提供指向 runtime 子文件的 `yzforge/*` 深路径映射；工具和框架内部如果需要读取 runtime 文件，使用物理路径或相对路径，不经过公共 alias。
- `extensions/yzforge/runtime-template/` 只能被安装、同步、校验工具读取。
- 同步工具负责把 `runtime-template` 写入 `assets/yzforge/runtime`。
- Validator 必须校验模板和项目 runtime 的内容 hash 一致。
- 如果项目刻意 fork runtime，必须在 manifest 中声明 fork 策略，否则视为 drift。

这样命名后，仓库中只有一个“运行中的 runtime”，也只有一个“插件模板 runtime”。两者职责不同，不再用同一个目录名制造歧义。

## 核心设计

### 1. ScopeManifest 是唯一事实源

所有可被框架识别的业务单元都必须有描述文件：

```text
assets/modules/<Name>/module.json
assets/libraries/<Name>/library.json
assets/content-packs/<Owner>/<Name>/content-pack.json
```

规则：

- `assets/modules/*` 下存在目录但没有 `module.json`，Validator 必须报错。
- `assets/libraries/*` 下存在目录但没有 `library.json`，Validator 必须报错。
- `assets/content-packs/*/*` 下存在目录但没有 `content-pack.json`，Validator 必须报错。
- Descriptor 的 `name`、`owner`、`bundle`、Cocos bundle meta 必须一致。
- 生成器只能从 descriptor 生成 registry、contract、entry、assets、config、content-pack manifest。

这会让项目从“目录看起来像模块”变成“被 manifest 承认才是模块”。

### 2. AppKernel 与 App Facade 分离

`App` 对业务保持简洁 facade，但内部应有一个更明确的 kernel：

```text
App
  facade API: start / enterModule / preloadModule / unloadModule / use

AppKernel
  lifecycle
  viewport
  mainBinding
  entries
  bundles
  releaseScope
  ownershipLedger
  modules
  libraries
  contentPacks
  ui
  extensions
```

规则：

- 业务只拿到 `App`、`LoadedModule`、`LoadedLibrary`、`LoadedContentPack` 这些稳定入口。
- Extension 安装时拿到受限的 `ExtensionContext`，而不是裸 `ExtensionRegistry`。
- AppKernel 负责系统协调，业务不直接访问 kernel。

### 3. ReleaseScope 与 OwnershipLedger

释放执行和所有权观察必须拆开。

`ReleaseScope` 是真实运行时机制，负责按顺序清理资源。它应该足够简单，像一个有层级的 dispose stack：

```ts
interface ReleaseScope {
    readonly key: string;
    readonly kind: string;
    child(kind: string, key: string): ReleaseScope;
    add(disposable: OwnedDisposable): void;
    release(reason: unknown): Promise<void>;
}

interface OwnedDisposable {
    dispose(reason: unknown): Promise<void> | void;
}
```

`OwnershipLedger` 是调试和校验账本，负责记录谁持有什么，用于 snapshot、debug HUD 和 Validator 辅助检查。它不应该成为复杂调度器。

所有动态对象都必须登记到释放作用域，并同步记录到账本：

```text
AppOwner
  GlobalOwner
  ModuleOwner(Home)
    ViewOwner(PageHome)
    ContentPackOwner(home.level001)
    AssetOwner(Home)
  LibraryOwner(BattleCore)
  PreloadOwner(Home)
```

账本表达三件事：

- 谁 acquire 了什么。
- 谁负责 release 什么。
- 发生失败时按什么顺序补偿。

规则：

- Module 卸载时，即使 `onExit` 或 `onUnload` 抛错，也必须继续关闭 UI、卸载 ContentPack、释放 assets、释放 libraries、释放 bundle。
- Library token 实例如果实现 `dispose` 或框架约定的 disposable 接口，Library 释放时必须调用。
- 预加载也必须有 owner，不能用 refCount 0 的 bundle 永久漂浮在 runtime 里。
- `releaseAll` 只能被 ReleaseScope 内部或框架卸载流程调用，业务不直接调用。
- OwnershipLedger 只负责记录和展示，不决定释放顺序。

### 4. BundleHandle 取代裸 Bundle 引用

`BundleManager.loadBundle()` 不应该把裸 `AssetManager.Bundle` 当作业务层可传递结果。内部可以持有 Cocos Bundle，但对上层返回的是框架 handle：

```ts
interface BundleHandle {
    readonly name: string;
    readonly state: BundleState;
    release(scope: ReleaseScope): Promise<void>;
}
```

`AssetManager.Bundle` 只能出现在 BundleManager 和 AssetScope 的内部实现中。任何 public API、Module、Library、ContentPack、Extension 都不能直接暴露它。

规则：

- `preloadBundle` 也必须返回可释放 handle 或记录到 `PreloadOwner`。
- 同一个 bundle 的并发加载必须共享任务。
- `releaseBundle` 必须按 owner 或 acquire token 释放，而不是只靠裸数字 count。
- Bundle remove 前必须确保对应 Scope 的 AssetScope 已释放。

### 5. MainBinding 显式绑定 UI 根节点

UIManager 不能长期依赖递归按名字找节点。启动阶段必须从 Main 场景建立显式绑定：

```text
MainBinding
  mainRoot
  worldRoot
  canvas
  uiRoot
  fullscreenLayer
  safeAreaRoot
  pageLayer
  paperLayer
  popupLayer
  toastLayer
  topLayer
  systemLayer
```

规则：

- `App.start` 校验并保存 MainBinding。
- UIManager 只使用 MainBinding 提供的 Layer，不自己扫描场景。
- Editor 可以提供 repair/create 能力，但 runtime 不隐式修复结构。
- Validator 检查 Main 场景节点、组件和 Layer 映射。

### 6. ViewportManager 进入核心

第 10 章的 viewport 设计应进入 AppKernel：

```ts
interface DeviceProfile {
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
```

规则：

- `app.viewport.profile` 是业务读取屏幕信息的唯一入口。
- Module 不直接调用 `setDesignResolutionSize`。
- Module 不直接调用 `sys.getSafeAreaRect`。
- viewport changed 通过 `app.lifecycle` 或 `app.viewport.onChanged` 派发。
- `SafeAreaRoot` 和 `FullscreenLayer` 的适配组件订阅同一份 DeviceProfile。

### 7. UIManager 拆成三个职责

UI 系统保留 `module.ui.open()` 这样的业务 API，但内部拆分：

```text
LayerRegistry
  管 MainBinding 中的层级节点

ViewRuntime
  管 View 打开、关闭、栈、队列、结果、缓存、所有权

SystemUI
  管 Loading、TouchMask、Toast facade、PopupMask
```

规则：

- PopupMask 和 TouchMask 属于 SystemUI，不是业务 prefab 的一部分。
- 核心只规定 SystemUIHost、Loading、TouchMask、Toast facade 和 PopupMask；系统确认框由 AppScope preset 或 Extension 提供，不进入核心硬依赖。
- Page、Paper、Popup、Toast、Top 默认挂在 SafeAreaRoot 下的标准 Layer。
- FullscreenLayer 用于背景、全屏特效、场景遮罩。
- SystemLayer 使用 FullScreenRoot 适配，不被 SafeArea 裁剪。
- `openForResult` 在 owner 卸载时必须 resolve cancel，不允许悬挂。

### 8. Library Provider 闭环

Library contract 和 runtime provider 必须形成闭环。

推荐结构：

```text
assets/libraries/BattleCore/code/public.ts
assets/libraries/BattleCore/code/providers.ts
assets/libraries/BattleCore/code/entry.generated.ts
```

`public.ts` 只声明类型和 token map。`providers.ts` 绑定实现：

```ts
export const providers = defineLibraryProviders<BattleCoreTokenMap>({
    damageSystem: classToken(DamageSystem),
});
```

`entry.generated.ts` 只组装：

```ts
registerLibraryEntry(defineLibraryEntry({
    name,
    bundle,
    assets,
    config,
    libraries,
    tokens: providers,
}));
```

规则：

- provider key 必须完全匹配 public token map。
- provider 文件可以 import Library 内部实现。
- contract generated 不能 import provider 或实现类。
- Validator 检查 token map、contract、providers、entry 的一致性。

### 9. Config 与 ContentPack 变成真实 runtime

Config 不是普通 asset ref，也不是空对象。它应有独立 manifest、loader 和 runtime scope：

```text
res/content/config/manifest.json
code/config.generated.ts
```

规则：

- `config.generated.ts` 生成 typed table ref，不内嵌大表。
- Runtime 通过 ConfigManager 加载表数据并创建 `ConfigScope`。
- ContentPack 的 `LoadedContentPack.config` 必须来自自身配置 manifest。
- ContentPack manifest generated 文件必须被 runtime 或构建索引实际使用，而不是只作为编辑器产物存在。

### 10. Extension 安装使用 ExtensionContext

Extension 不应该只拿到 registry。它需要受限但足够的上下文：

```ts
interface ExtensionContext {
    readonly app: App;
    readonly lifecycle: AppLifecycle;
    readonly viewport: ViewportManager;
    readonly logger: Logger;
    provide<T>(token: ExtensionToken<T>, value: T): void;
    provideModule<T>(token: ModuleExtensionToken<T>, factory: ModuleTokenFactory<T>): void;
}
```

规则：

- Extension 生命周期分为 `installBeforeStart`、`installAfterMainBinding`、`installBeforeFirstModule` 和 `dispose`。
- 只注册 token 的 Extension 使用 `installBeforeStart`。
- 依赖 viewport 或 MainBinding 的 Extension 使用 `installAfterMainBinding`。
- 必须在首个 Module 进入前完成的 Extension 使用 `installBeforeFirstModule`。
- Extension 依赖必须拓扑排序。
- 安装失败时 App 启动失败，并报告 dependency chain。
- Extension 不能直接 import Module 内部代码。
- Extension 不能往 `app` 上挂任意字段。

## 必须守住的不变量

- 首包 registry/contract 不能 import 动态 Bundle 内部实现。
- Module 不能 import 其他 Module 内部代码。
- Module 不能 import Library 内部代码。
- Library 不能 import Module。
- ContentPack 不能包含 TS 源码。
- 业务不直接调用 `assetManager.loadBundle`。
- 业务不手写动态资源路径。
- 业务不绕过 `app.viewport` 读取安全区。
- UI prefab 必须通过 owner UI runtime 打开。
- 任何动态加载出来的资源和节点都必须进入 ReleaseScope。
- 任何 ReleaseScope 释放都必须幂等。
- OwnershipLedger 不能代替 ReleaseScope 执行释放。
- `extensions/yzforge/runtime-template` 是模板源码，`assets/yzforge/runtime` 是唯一运行时代码入口。

## 终局性说明

这是 YZForge 当前重构的终局方案。它不是临时架构，也不预留一套“以后再换”的隐藏方案。

我有把握的部分：

- 四层模型应该保留。
- Manifest 作为事实源应该保留。
- 显式 MainBinding 比递归找节点更稳。
- ReleaseScope 是释放闭环的核心，OwnershipLedger 是观察和调试核心。
- Library provider 闭环必须做。
- Viewport/SafeArea 应进入核心，而不是后补工具。
- runtime 双目录必须改名，`runtime-template` 和 `assets/yzforge/runtime` 必须职责分离。

仍需要平台验证但不改变架构的部分：

- Cocos Creator 在不同平台上 Bundle 脚本注册和 removeBundle 的边界时序。
- 不同平台 resize、orientation、safe area 事件触发时机。
- Bundle remove 前后的资源释放细节。
- 小游戏平台对 `assets/yzforge/runtime` 这类首包 runtime 目录的构建行为。

这些验证只影响适配实现，不改变终局契约。
