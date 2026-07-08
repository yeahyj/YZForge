# 13. YZForge 重构验收标准

## 总验收

重构完成不是指代码能编译，而是下面这条链路可以被生成器、runtime 和 Validator 同时证明：

```text
创建 Scope
  -> 生成 Contract / Registry / Entry / Assets / Config
  -> App.start 绑定 Main / Viewport / Lifecycle
  -> preload / load / enter Module
  -> 打开 UI
  -> 使用 Library token
  -> 加载 ContentPack 和 config
  -> unload Module
  -> ReleaseScope 释放干净
  -> OwnershipLedger 快照无泄漏
  -> Validator 能阻止绕过
```

## 命令验收

以下命令必须通过：

```text
npm run typecheck
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run yzforge:cocos:build:web
npm run yzforge:validate:build-matrix
npm run yzforge:smoke
```

`validate:strict` 的 scope 数量不能意外为 0。除非仓库确实是空工程，否则必须扫描到示例 Module / Library / ContentPack。

`yzforge:cocos:build:web` 必须通过 Cocos CLI 生成真实 Web Desktop build。`validate:build-matrix` 必须证明 Cocos editor / preview assembly 中的 `yzforge` import 没有 unresolved error，并且真实 build output 中没有裸 `yzforge` import、unresolved marker 和 MissingScript marker。如果 build output 还没有产物，`validate:build-matrix` 必须在 evidence 中明确显示 `not_collected`，这表示验收证据不完整，不能当作终局完成。

fresh clone 自举也属于硬验收。必须在一个不同目录的干净 clone 中直接通过下面命令，不能先靠手动 `generate` 修复本机绝对路径：

```text
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
```

这条验收证明提交态本身可迁移：root `tsconfig.json` 不能依赖 `temp/tsconfig.cocos.json`，不能提交项目根绝对路径，也不能把 `db://internal/*` 的 Cocos 安装路径写进仓库。

## Scanner / Manifest

必须满足：

- `assets/modules/<Name>` 没有 `module.json` 时 Validator 失败。
- `assets/libraries/<Name>` 没有 `library.json` 时 Validator 失败。
- `assets/content-packs/<Owner>/<Name>` 没有 `content-pack.json` 时 Validator 失败。
- Descriptor 的 `name` 与目录名不一致时 Validator 失败。
- Descriptor 的 `bundle` 与算法不一致时 Validator 失败。
- Cocos bundle meta 缺失或 bundleName 不一致时 Validator 失败。

验收用例：

```text
创建 assets/modules/Foo/res
运行 validate:strict
必须报 orphan module scope
```

## Generated 文件

必须满足：

- generated 文件有 header、source、hash。
- 手改 generated 文件后 Validator 失败。
- `generate --check` 能发现 stale generated 文件。
- `generate` 输出稳定排序，重复运行没有 diff。
- root `package.json` scripts、`packages/yzforge-runtime/package.json` exports、`tsconfig.paths`、`import-map.json` 与 `settings/v2/packages/project.json` 的 `script.importMap` 由同一份源数据生成。
- root `tsconfig.json` 是可提交、可迁移的项目契约：`db://assets/*` 指向 `assets/*`，`yzforge` 指向 `packages/yzforge-runtime/src/index.ts`，不能 `extends` Cocos `temp` 配置，不能包含 `db://internal/*`，不能包含项目根绝对路径。
- `npm run typecheck` 由 ToolchainResolver 在运行时生成 `temp/yzforge/tsconfig.typecheck.json`，再动态注入 Cocos engine declarations、`cc/env` shim 和 `db://internal/*`。这些本机路径只允许出现在 `temp` 派生产物里，不能出现在提交态配置中。
- `.yzforge/toolchain.schema.json` 和 `.yzforge/toolchain.example.json` 必须由生成器维护；`.yzforge/.gitignore` 必须忽略真实本机 `.yzforge/toolchain.json`，但保留 schema/example 可提交。

## Runtime 目录

必须满足：

- `packages/yzforge-runtime/src` 是 runtime 权威源码。
- `extensions/yzforge/runtime-template` 是安装模板 / 缓存 copy。
- `assets/yzforge/runtime` 是 Cocos 可见运行时入口 copy。
- 仓库中不存在正式用途的 `extensions/yzforge/runtime` 路径。
- 项目根 `package.json` 不能占用 `name: "yzforge"`，runtime package 才能使用这个包身份。
- `import-map.json` 和 `tsconfig.paths` 只能暴露 `yzforge` 顶层 runtime 入口、首包 registry/contract 子路径和 shared 子路径，不能暴露 runtime deep alias。
- Validator 能发现 `packages/yzforge-runtime/src`、`runtime-template` 与 `assets/yzforge/runtime` 的内容漂移。
- 业务代码、生成代码、文档示例都不能 import `extensions/yzforge/runtime-template`、`packages/yzforge-runtime/src` 或 `assets/yzforge/runtime` 物理路径。
- 业务和生成代码只能从 `yzforge` 顶层桶入口导入 runtime API，不能 deep import `yzforge/bundle-manager` 或物理 runtime 子路径。

## App / Main / Viewport

必须满足：

- `App.start` 需要明确执行 MainBinding 校验。
- `MainRoot`、`UIRoot`、`FullscreenLayer`、`SafeAreaRoot`、标准 UI Layer、`SystemLayer` 缺失时 Validator 失败。
- `SafeAreaRoot` 挂载安全区适配组件。
- `FullscreenLayer` 和 `SystemLayer` 挂载全屏适配组件。
- `app.viewport.profile` 可读取。
- viewport changed 能触发订阅。
- 业务代码直接调用 `sys.getSafeAreaRect` 时 Validator 失败。
- 业务代码直接调用 Cocos 分辨率策略 API 时 Validator 失败。

## Bundle / ReleaseScope / OwnershipLedger

必须满足：

- `BundleManager` 是唯一直接调用 `assetManager.loadBundle` 的 runtime 系统。
- 业务 Module / Library 直接调用 `assetManager.loadBundle` 时 Validator 失败。
- `BundleHandle` public API 不暴露 `AssetManager.Bundle`。
- `preloadModule` 创建可释放 ReleaseScope。
- `loadModule`、`loadLibrary`、`loadContentPack` 都登记 ReleaseScope。
- OwnershipLedger snapshot 能显示 bundle、asset、view、contentPack、library 的持有关系。
- release scope 后对应资源引用清零。
- 重复 release scope 幂等。
- OwnershipLedger 不能代替 ReleaseScope 执行释放。

失败验收：

```text
Module onUnload 抛错
  -> UI 仍关闭
  -> ContentPack 仍卸载
  -> assets 仍释放
  -> libraries 仍 release
  -> module bundle 仍 release
  -> 错误被记录
```

## Module Lifecycle

必须满足：

- `preloadModule` 不创建 Module 实例。
- `loadModule` 调用 `onCreate` 和 `onLoad`，不调用 `onEnter`。
- `enterModule` 调用 `onEnter`。
- `Replace` 默认关闭旧模块 UI。
- `Push` 默认暂停旧模块 Page / Paper / Top，关闭 Popup / Toast。
- `back` 优先交给当前模块 UI，再退模块栈。
- `unloadModule` 幂等。
- 正在进入的模块不能被半卸载。
- `onEnter` 失败时导航状态回滚。

## UI

必须满足：

- UI Layer 来自 MainBinding，不靠递归查找。
- Module 只能打开自己 Scope 的 View。
- ContentPack 不能提供 UIManager View。
- Page 默认同 owner 单例。
- Paper / Popup 默认可入栈。
- Toast 默认队列。
- PopupMask 由框架创建，不放在业务 prefab。
- TouchMask 属于 SystemUI。
- SystemUI 核心不强制包含 SystemConfirm。
- `openForResult` 在正常关闭时 resolve result。
- `openForResult` 在强制关闭、模块卸载、打开取消时 resolve cancel。
- View 直接 `node.on`、未登记 timer、未登记 tween 时 strict Validator 失败。

## Library

必须满足：

- Module 使用 Library 前必须在 `module.json` 声明。
- Module import 未声明 Library ref 或 contract 时 Validator 失败。
- Module import Library 内部代码时 Validator 失败。
- Library import Module 时 Validator 失败。
- public contract 只能导出 type/interface，不 import `cc`，不导出 runtime value。
- token map、contract tokens、providers、entry tokens 必须一致。
- `LoadedLibrary.use(token)` 返回 provider 创建的实例。
- Library refCount 为 0 后释放 assets、token instances、bundle 和依赖 Library。

## Config

必须满足：

- Config 不混入普通 assets manifest。
- `config.generated.ts` 只生成 typed table refs。
- JSON table MVP 支持 `get / require / all`。
- 主键重复时 Validator 失败。
- 表文件缺失时 Validator 失败。
- Module 不能直接读取另一个 Module config。
- 跨 Scope 共用配置必须提升到 Library、Global 或 ContentPack。

## ContentPack

必须满足：

- ContentPack 必须有 owner Module。
- 非 owner Module 不能 import 或 load 该 ContentPack。
- ContentPack 不包含 TS 源码。
- ContentPack prefab 挂载脚本只能来自 shared、owner Module 或声明 Library。
- `LoadedContentPack.assets.instantiate` 登记 pack owner。
- ContentPack unload 销毁自己实例化的节点。
- ContentPack unload 释放自己的 assets、bundle 和 library refs。
- `LoadedContentPack.config` 可读取自身配置。

## Extension

必须满足：

- Extension 通过 `ExtensionContext` 安装。
- Extension 支持 `installBeforeStart`、`installAfterMainBinding`、`installBeforeFirstModule`、`dispose` 阶段。
- Extension 不能直接写 `app.audio`、`app.net` 等字段。
- Extension 通过 token 暴露能力。
- Extension 依赖按拓扑顺序安装。
- 循环依赖失败。
- 安装失败会阻止 App.start，并输出 extension name 和 dependency chain。
- Module-level token 随 Module 使用，不污染其他 Module。

## 文档一致性

必须满足：

- docs 中的核心 API 与实现一致。
- 文档中出现的新核心类型，runtime 或 editor 中必须有实现或明确标注为未来阶段。
- README 阅读顺序包含重构文档。
- 过时 API 示例被更新或标注迁移。

## 不通过的状态

出现以下任一情况，不能认为重构完成：

- `validate:strict` 通过但扫描到 0 个 scope，而仓库里实际存在业务目录。
- Main 场景没有 `SafeAreaRoot`，但第 10 章仍声称安全区闭环完成。
- `LibraryTokens` 能生成，但 `LoadedLibrary.use(token)` 无法拿到 provider。
- `ContentPack manifest.generated.json` 只生成不使用。
- Module 卸载时生命周期抛错会阻断资源释放。
- UIManager 仍在 runtime 中递归全场景找 Layer。
- 业务仍能直接调用 `assetManager.loadBundle` 而 Validator 不报错。
- 仓库仍把 `extensions/yzforge/runtime` 当作正式 runtime 路径。
