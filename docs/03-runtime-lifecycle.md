# 03. 运行时与生命周期

## App

`App` 是运行时总入口，但不能变成万能大单例。

```ts
export class App {
    public readonly event: EventBus<AppEvents>;
    public readonly logger: Logger;
    public readonly shared: SharedRegistry;
    public readonly global: GlobalRoot;
    public readonly modules: ModuleRegistry;
    public readonly libraries: LibraryRegistry;
    public readonly extensions: ExtensionRegistry;
    public readonly navigator: ModuleNavigator;

    public start(): Promise<void>;
    public preloadModule<TParams = unknown>(ref: ModuleRef<TParams>, options?: PreloadOptions): Promise<void>;
    public loadModule<T extends Module, TParams = unknown>(ref: ModuleRef<TParams>): Promise<LoadedModule<T>>;
    public enterModule<T extends Module, TParams = unknown>(
        ref: ModuleRef<TParams>,
        params?: TParams,
        options?: EnterModuleOptions,
    ): Promise<LoadedModule<T>>;
    public unloadModule(ref: ModuleRef, options?: UnloadOptions): Promise<void>;
    public use<T>(token: ExtensionToken<T>): T;
}
```

`App` 负责：

- 启动框架。
- 校验 Main 场景。
- 初始化核心系统。
- 安装 Extension。
- 初始化 `SharedScope`。
- 初始化 `AppScope/global`。
- 解析首包 `Contract` 和 `Registry`。
- 管理模块加载、进入、退出、卸载。

`App` 不负责：

- 直接提供 `app.net`。
- 直接提供 `app.audio`。
- 直接提供 `app.storage`。
- 直接持有业务数据。
- 直接打开某个业务模块内部 View。

扩展能力通过 token 使用：

```ts
const storage = app.use(StorageToken);
```

## Extension 生命周期

Extension 是框架能力包，不是业务 Module。它可以提供 App-level 能力，也可以给 Module 增加局部能力。

安装入口由生成器写入：

```text
assets/app/bootstrap/install.generated.ts
```

安装流程：

```text
read extension refs from app/registry/extensions
sort by dependency order
load extension runtime if needed
call extension.install(app)
register app-level tokens
register module-level token factories
```

Extension 接口：

```ts
export interface Extension {
    readonly name: string;
    readonly dependencies?: ExtensionRef[];
    install(app: App): void | Promise<void>;
    uninstall?(app: App): void | Promise<void>;
}
```

App-level token：

```ts
const storage = app.use(StorageToken);
```

Module-level token：

```ts
const analytics = this.use(ModuleAnalyticsToken);
```

规则：

- Extension 不能直接 import Module 内部代码。
- Extension 可以依赖 `shared`、`global public API` 和其他 Extension token。
- App-level token 随 App 存活。
- Module-level token 随 Module 创建和卸载。
- Extension install 失败时，App 启动失败，并报告 extension name 和 dependency chain。
- Extension 能力必须通过 token 暴露，不往 `app` 上直接挂 `app.audio`、`app.net` 这类字段。

## 启动流程

```text
load Main.scene
Main.ts creates App
validate Main scene nodes
install generated extensions
initialize logger/event/bundle/package registries
load import registry generated in first package
initialize shared code registry
initialize global root
open system UI presets if needed
enter configured first module
```

`registry` 和 `contracts` 必须在首包内完成加载，不允许依赖任何按需业务 Bundle。

## BundleManager

`BundleManager` 是唯一能直接调用 `assetManager.loadBundle` 的系统。

职责：

- 加载 Bundle。
- 预加载 Bundle。
- 复用 in-flight Promise。
- 记录引用计数。
- 记录 Bundle 依赖关系。
- 按 Scope 释放资源。
- 移除 Bundle。
- 统一失败回滚。

规则：

- 同一个 bundleName 同一时刻只能有一个加载任务。
- `loadBundle`、`preloadBundle`、`releaseBundle` 按 bundleName 加锁。
- `preloadBundle` 只下载和准备 Bundle，不创建 Module 实例。
- `loadBundle` 成功后引用计数加一。
- `releaseBundle` 只在引用计数归零后释放资源并 remove bundle。
- 移除 Bundle 前必须先释放该 Bundle 已加载资源。
- 业务代码不保存 `AssetManager.Bundle`。

状态：

```ts
export enum BundleState {
    Empty,
    Loading,
    Loaded,
    Releasing,
    Failed,
}
```

失败处理：

```text
load failed:
  mark state Failed
  clear in-flight task
  rollback dependencies loaded only by this task
  keep existing loaded handle untouched
  throw typed error

release failed:
  keep bundle state Loaded or FailedRelease
  report resource paths
  never silently drop registry record
```

## EntryRegistry

`EntryRegistry` 是运行时注册表：

- 首包加载时读取 `assets/app/registry` 里的轻量 refs。
- Module 或 Library Bundle 加载后，把真实 `ModuleEntry`、`LibraryEntry` 注册进来。
- `App` 通过它把轻量 ref 解析成真实 entry。
- Entry 注册必须校验 ref 和 entry 的 name、bundle、libraries 是否一致。

动态 Bundle 的 `code/entry.generated.ts` 负责顶层注册：

```ts
registerModuleEntry(defineModuleEntry(...));
registerLibraryEntry(defineLibraryEntry(...));
```

运行时要求：

- `entry.generated.ts` 必须位于对应 Bundle 目录内，并参与 Cocos Bundle 构建。
- `entry.generated.ts` 只能 import 当前 Scope 内部实现、`yzforge` runtime、首包 contract/registry 和 `shared`。
- `entry.generated.ts` 不允许 import 其他动态 Bundle 内部脚本。
- `BundleManager.loadBundle(ref.bundle)` 返回后，`EntryRegistry` 必须能在同一 tick 或一个明确超时时间内解析到对应 Entry。
- 如果 Bundle 加载成功但 Entry 未注册，视为 `EntryMissingError`，加载流程失败并回滚本次 acquire。

## Module

```ts
export abstract class Module<TEnter = unknown> {
    public readonly app: App;
    public readonly name: string;
    public readonly state: ModuleState;
    public readonly assets: ModuleAssets;
    public readonly config: ModuleConfig;
    public readonly libraries: ModuleLibraryManager;
    public readonly contentPacks: ContentPackManager;
    public readonly ui: ModuleUI;
    public readonly event: EventBus;

    public useModel<T extends Model>(type: ModelType<T>): T;
    public useService<T extends Service>(type: ServiceType<T>): T;
    public useFlow<T extends Flow>(type: FlowType<T>): T;
    public use<T>(token: ModuleExtensionToken<T>): T;

    protected onCreate(): void | Promise<void>;
    protected onLoad(): void | Promise<void>;
    protected onEnter(params?: TEnter): void | Promise<void>;
    protected onPause(): void | Promise<void>;
    protected onResume(): void | Promise<void>;
    protected onExit(): void | Promise<void>;
    protected onUnload(): void | Promise<void>;
}
```

`preloadModule` 不属于模块生命周期，它只加载 Bundle 和可选资源，不创建模块实例。

## LoadedModule

```ts
export interface LoadedModule<T extends Module = Module> {
    readonly ref: ModuleRef;
    readonly bundleName: string;
    readonly instance: T;
    readonly assets: ModuleAssets;
    readonly config: ModuleConfig;
    readonly contentPacks: ContentPackManager;
    unload(): Promise<void>;
}
```

## Module 状态

```ts
export enum ModuleState {
    Empty,
    Preloading,
    BundleReady,
    Creating,
    Loading,
    Ready,
    Entering,
    Active,
    Paused,
    Exiting,
    Unloading,
    Unloaded,
    Failed,
}
```

## 加载流程

```text
read ModuleRef.libraries
load declared Library bundles recursively
load module bundle
wait ModuleEntry registration
validate ModuleEntry == ModuleRef
create Module instance
bind assets/config/libraries/contentPacks/ui/event
onCreate
onLoad
state = Ready
return LoadedModule
```

加载失败：

```text
if failure before Module instance:
  rollback bundle refs acquired by this operation
  state = Failed

if failure after Module instance created:
  call safe dispose for partial model/service/flow
  close opened UI owned by this module
  release acquired pack/library refs
  state = Failed
```

## 预加载流程

```text
read ModuleRef.libraries
preload/load declared Library bundles recursively
preload module bundle
optional preload selected asset refs
optional preload selected pack bundles
state = BundleReady
```

预加载不创建 `Module`，不调用 `onCreate`，不打开 UI。

## 进入流程

`ModuleNavigator` 管理模块导航。第一版支持两种模式：

```ts
export enum EnterMode {
    Replace = 'replace',
    Push = 'push',
}
```

进入选项：

```ts
export interface EnterModuleOptions {
    mode?: EnterMode;
    unloadPrevious?: boolean;
    closePreviousUi?: boolean;
    restorePreviousUiOnBack?: boolean;
    cancelPendingEnter?: boolean;
}
```

默认值：

```text
mode = Replace
unloadPrevious = false
cancelPendingEnter = true

Replace:
  closePreviousUi = true
  restorePreviousUiOnBack = false

Push:
  closePreviousUi = false
  restorePreviousUiOnBack = true
```

`Replace`：

```text
load target if needed
if current module exists:
  current.onExit
  if closePreviousUi:
    close current module UI
  else:
    pause current module UI
target.onEnter(params)
target becomes Active
if target enter succeeds:
  previous module remains Ready or unloads according to options
```

`Push`：

```text
load target if needed
if current module exists:
  current.onPause
  if closePreviousUi:
    close current module UI
  else:
    pause current module Page/Paper/Top UI
    close current module Popup/Toast UI
  current becomes Paused
target.onEnter(params)
target becomes Active
push previous module into module stack
```

返回：

```text
current.onExit
close current module UI
if previous module exists:
  if restorePreviousUiOnBack:
    resume previous module UI
  previous.onResume
  previous becomes Active
else:
  enter fallback module or show global shell
```

规则：

- 同一时间只能有一个前台 Active Module。
- `global` UI 不属于模块栈。
- Module 卸载时必须关闭本模块拥有的 UI。
- UIManager 负责 Module UI 的关闭、暂停和恢复，ModuleNavigator 不直接操作 UI 节点。
- `Push` 默认暂停上一个模块的 Page/Paper/Top，关闭上一个模块的 Popup/Toast；需要跨模块保持的提示应做成 Global UI。
- `enterModule` 对同一目标的并发调用串行处理。
- `cancelPendingEnter = true` 时，新进入请求会取消尚未执行 `onEnter` 的旧请求。
- `onEnter` 失败时，导航状态回到进入前。

## 卸载流程

```text
if Active:
  onExit
if Paused:
  remove from navigator stack
close module UI
dispose module Part
dispose Flow
dispose Service
dispose Model
unload ContentPack handles
release module-owned loaded assets
onUnload
release module bundle ref
release declared library refs if no other owner
state = Unloaded
```

卸载规则：

- 正在 `Entering` 的模块不能直接卸载，必须等待进入任务结束或被取消。
- 卸载是幂等操作，重复调用返回同一个任务。
- `onUnload` 不负责释放资源，资源释放由框架统一做。
- 如果 `onExit` 抛错，仍然继续关闭 UI 和释放资源，但错误要被记录。

## Library 生命周期

```text
read LibraryRef.libraries
load dependency libraries recursively
load library bundle
wait LibraryEntry registration
validate LibraryEntry == LibraryRef
create LoadedLibrary handle
bind tokens/assets/config
acquire library for owner Scope
```

Library 没有 `onEnter`，不拥有 UI 栈。Library 可有资源、配置和公开 token。

引用计数规则：

- Library refCount 按 owner Scope 计数，不按每次方法调用计数。
- Module 加载时，会 acquire `ModuleRef.libraries` 中声明的 Library，并保存到 `ModuleLibraryManager`。
- 同一个 Module 多次 `this.libraries.load(BattleCoreRef)` 返回同一个 `LoadedLibrary`，不重复增加 refCount。
- 如果支持懒加载可选 Library，也必须先在 `module.json` 声明；第一次 `load` 时 acquire，后续调用复用。
- Module 卸载时释放自己 acquire 的 Library。
- 只有 refCount 归零后，Library 才允许释放 token 实例、资源和 Bundle。
- Library 依赖其他 Library 时，也按 owner Library acquire 和 release。

推荐 API：

```ts
const battleCore = await this.libraries.load(BattleCoreRef);
const damage = battleCore.use(BattleCoreTokens.damageSystem);
```

Library 卸载：

```text
if ref count > 0:
  refuse direct unload or defer
dispose token instances if disposable
release library loaded assets
release library bundle ref
release dependency libraries
```

## ContentPack 生命周期

```text
validate owner module is loaded
load declared libraries
load pack bundle
read manifest.generated.json
create LoadedContentPack handle
```

卸载：

```text
destroy instantiated nodes owned by pack if registered
release pack loaded assets
remove pack bundle
release pack library refs
```

ContentPack 不调用业务生命周期，必须由 owner Module 的 Flow 或 Service 解释。

## Model / Service / Flow

`Model`：

- 保存纯数据。
- 提供状态修改方法。
- 不持有 `Node` 或 `Component`。
- 不调用 UI、Audio、资源加载。

`Service`：

- 执行纯业务逻辑。
- 调用 Model、Config、Asset、Event、Extension。
- 不直接打开 UI。
- 不长期持有 View 节点。

`Flow`：

- 编排多个 Service。
- 打开和关闭 UI。
- 加载 ContentPack。
- 处理进入参数。
- 处理模块内长流程。

小模块可以直接让 `Module` 承担 Flow 职责；复杂模块应创建独立 Flow。
