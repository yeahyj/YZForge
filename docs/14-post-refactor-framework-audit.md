# 14. 重构后审计与硬终局再设计

这份文档记录重构完成后的真实状态，以及下一版更硬、更自洽、更容易迁移到其他项目的终局设计。

这里的“硬终局”不是临时兼容方案，也不是为了绕过当前 Cocos 限制的补丁。它指的是一套可以长期维护、可以跨项目复制、可以被生成器和 Validator 证明的框架契约。

## 当前已成立的边界

当前实现已经把最大的歧义收掉：

```text
业务和生成代码
  -> import 'yzforge'
  -> package.json exports
  -> assets/yzforge/runtime/index.ts
```

当前生成器维护同一份路径事实：

```text
package.json name/private/exports
tsconfig.json compilerOptions.paths
import-map.json
settings/v2/packages/project.json script.importMap
```

当前官方导入命名空间：

```text
yzforge
yzforge/modules/*
yzforge/libraries/*
yzforge/content-packs/*
yzforge/contracts/modules/*
yzforge/contracts/libraries/*
yzforge/contracts/content-packs/*
yzforge/contracts/extensions/*
yzforge/shared/*
```

当前禁止：

```text
yzforge/*
yzforge-contracts/*
yzforge-shared/*
assets/yzforge/runtime/*
extensions/yzforge/runtime-template/*
```

当前 Main 生命周期已经不再只是清除全局引用。`Main.onDestroy` 必须释放 `App.dispose`，并处理启动中被销毁的竞态。

当前 Validator 能检查：

- `package.json.exports`、`tsconfig.paths`、`import-map.json` 和 Cocos project setting 是否一致。
- 旧别名是否重新出现。
- runtime deep import 是否绕过 `yzforge` 顶层入口。
- Cocos editor / preview assembly 是否还存在 unresolved `yzforge` import。
- Main 场景结构、Main script 挂载和 Main 生命周期关键调用。

这些边界让当前框架从“能跑”进入了“有架构边界”的状态。

## 当前仍不够硬的地方

下面这些不是当前实现错误，而是我对当前框架仍不满意的地方。它们应该进入下一版硬化设计。

### App 缺少强状态机

当前 `App.start`、`loadModule`、`unloadModule`、`dispose` 各自有并发保护，但 App 整体没有统一状态：

```text
Created
Starting
Started
Disposing
Disposed
Failed
```

这导致一些问题只能靠调用顺序和 Main 侧保护解决：

- `start` 过程中调用 `dispose`。
- `dispose` 后再次调用 `start`。
- `dispose` 中仍有 module load task 未完成。
- `install extension` 失败后 App 是否已经有副作用。
- `start` 失败后哪些系统已经安装、哪些需要回滚。

硬终局要求：App 的每个 public API 都必须显式声明允许的状态、状态迁移和失败结果。

### Extension 安装不是事务

当前 Extension 已经通过 `ExtensionContext` 和 token 收窄能力，但安装过程还不是强事务。

硬终局要求：

```text
begin extension install transaction
  -> topo sort dependencies
  -> run phase
  -> record installed extensions and side effects
commit

if any phase fails:
  -> dispose already installed extensions in reverse order
  -> clear provided tokens from this transaction
  -> restore App to pre-phase state
  -> throw diagnostic error with extension name and dependency chain
```

Extension 不允许靠“安装一半，之后手工清理”维持正确性。

### 项目根 package 被占用为 yzforge

当前 `package.json.name = "yzforge"` 是 Cocos 3.8.8 下验证过的可靠解，它让裸导入 `yzforge` 能被 Cocos editor / preview 正确解析。

遗憾是：游戏项目自己的包身份被框架占用。

硬终局更理想的形态：

```text
packages/yzforge-runtime/
  package.json name = "yzforge"
  exports = runtime public API

game project package.json
  name = real game project name
  dependencies or workspace alias points to yzforge-runtime

assets/yzforge/runtime/
  generated or synced Cocos-visible runtime copy
```

如果 Cocos 仍要求 runtime 位于 `assets` 内，生成器可以同步 runtime package 到 `assets/yzforge/runtime`，但项目根 package identity 不再承担框架 package identity。

### runtime-template 双份同步仍然别扭

当前：

```text
extensions/yzforge/runtime-template
assets/yzforge/runtime
```

这是 Cocos AssetDB 和扩展分发之间的现实折中。Validator 可以防漂移，但它不是最干净的源码模型。

硬终局要求 runtime 源码只有一个权威来源：

```text
source of truth:
  packages/yzforge-runtime/src

Cocos visible copy:
  assets/yzforge/runtime

generated copy rule:
  deterministic sync
  hash verified
  never edited by hand
```

`extensions/yzforge/runtime-template` 可以退化为安装模板或缓存，不再是长期源码权威。

### Validator 仍有部分 regex 守门

当前 Validator 很有用，但有一些规则仍是源码文本匹配：

- Main 是否调用 `app.start({ mainRoot: this.node })`。
- Main 是否调用 `app.dispose`。
- 某些 forbidden import / forbidden API 检查。

硬终局要求：

```text
TypeScript AST for code rules
Cocos serialized scene parser for scene rules
generated manifest graph for scope dependency rules
Cocos build / preview assembly for real resolver rules
```

regex 只能作为兜底，不应该作为核心架构规则的唯一证据。

### 工具链含本机路径假设

当前工具链仍包含 Cocos 安装路径假设，例如 TypeScript 路径和 editor 内置资源路径。

硬终局要求：

```text
resolve Cocos editor root from:
  1. environment variable
  2. project local config
  3. Cocos editor profile
  4. known fallback paths

never require one developer's D:/Applications path
```

所有 CLI、Validator、Smoke 都必须能在另一台机器上给出明确错误和修复提示，而不是静默依赖本机路径。

### Bundle 释放策略还偏粗

当前 `BundleManager` 在 refCount 归零后释放 bundle。这个模型清晰，但真实项目中还要面对：

- 跨 Bundle 资源依赖。
- Cocos 内部缓存。
- 原生平台内存释放时机。
- 图集、材质、Spine、音频等资源的特殊生命周期。
- 预加载资源是否应该保留热缓存。

硬终局要求区分：

```text
ownership release
asset release
bundle script lifetime
bundle resource cache
platform memory pressure
hot cache policy
```

`ReleaseScope` 负责所有权，`BundleManager` 负责物理 bundle，`AssetScope` 负责资源实例和 asset 引用，热缓存策略由 Extension 或 App policy 决定。

## 硬终局架构

硬终局不是推翻当前四层模型，而是把四层模型变得更不可绕过。

```text
Scope
  owns code, resources, config, generated manifests

Contract
  first-package visible public shape
  no implementation import
  no Cocos runtime value unless explicitly allowed

Bundle
  physical Cocos load boundary
  script execution boundary
  resource cache boundary

Handle
  only runtime access to loaded capability
  owns release path
  records ownership
```

硬终局增加五个系统级契约：

```text
AppStateMachine
ExtensionTransaction
RuntimePackageBoundary
ToolchainResolver
BuildMatrixValidator
```

## AppStateMachine

App 必须有显式状态。

```ts
export enum AppState {
    Created = 'created',
    Starting = 'starting',
    Started = 'started',
    Disposing = 'disposing',
    Disposed = 'disposed',
    Failed = 'failed',
}
```

允许迁移：

```text
Created -> Starting
Starting -> Started
Starting -> Failed
Starting -> Disposing
Started -> Disposing
Disposing -> Disposed
Disposing -> Failed
Failed -> Disposing
```

禁止迁移：

```text
Disposed -> Starting
Disposing -> loadModule
Created -> enterModule
Failed -> enterModule
```

每个 public API 必须声明状态规则：

| API | 允许状态 | 失败行为 |
| --- | --- | --- |
| `start` | `Created` | 启动事务回滚，进入 `Failed` 或 `Disposed` |
| `preloadModule` | `Started` | 失败释放 preload scope |
| `loadModule` | `Started` | 失败释放 module scope |
| `enterModule` | `Started` | 导航状态回滚 |
| `unloadModule` | `Started` / `Disposing` | 聚合错误，继续释放 |
| `dispose` | `Created` / `Starting` / `Started` / `Failed` | 幂等，聚合错误 |

`Main.ts` 不应该承担框架状态机职责。Main 只负责把 Cocos 节点生命周期转成 `app.start` / `app.dispose`。

## ExtensionTransaction

Extension 安装必须可回滚。

ExtensionContext 提供能力时，必须登记到 transaction：

```text
provide app token
provide module token
listen lifecycle
register service
register codec
register system ui provider
```

每个登记动作都必须有反向操作：

```text
remove app token
remove module token
unlisten lifecycle
unregister service
unregister codec
unregister provider
```

事务提交前，外部不可观察到半安装状态。

硬规则：

- Extension 不能直接改 App 字段。
- Extension 不能直接持有 AppKernel。
- Extension 不能 import Module 内部实现。
- Extension 只能通过 token、policy、codec、lifecycle listener 扩展框架。
- Extension dispose 失败不能阻断其他 Extension dispose。

## RuntimePackageBoundary

硬终局要把 runtime 从项目身份里拆出来。

目标结构：

```text
packages/
  yzforge-runtime/
    package.json
    src/
    exports

extensions/
  yzforge/
    editor/
    templates/

assets/
  yzforge/
    runtime/
      generated copy from packages/yzforge-runtime/src
```

项目根 `package.json` 保留游戏项目身份：

```json
{
  "name": "my-game",
  "private": true
}
```

框架包身份只属于 runtime package：

```json
{
  "name": "yzforge",
  "exports": {
    ".": "./src/index.ts",
    "./modules/*": "./generated/registry/modules/*.ts",
    "./contracts/modules/*": "./generated/contracts/modules/*.ts"
  }
}
```

如果 Cocos 当前版本无法直接从 workspace package 解析，生成器必须产出 Cocos 可见映射，但这仍然是构建适配，不改变 runtime package 的权威身份。

## ToolchainResolver

所有工具必须通过统一 resolver 获取 Cocos 和项目环境。

```text
resolveProjectRoot()
resolveCocosEditorRoot()
resolveCocosTypeScript()
resolveCocosEngineAssets()
resolveCocosProjectSettings()
resolveCocosTempAssembly(target)
```

禁止在业务代码、生成器、Validator、Smoke 中散落硬编码路径。

失败信息必须可执行：

```text
Cannot resolve Cocos Editor root.
Set YZFORGE_COCOS_EDITOR_ROOT or configure .yzforge/toolchain.json.
```

## BuildMatrixValidator

当前 editor / preview 通过不等于框架跨项目稳定。

硬终局验收矩阵：

```text
typecheck
generate --check
validate --strict
smoke
Cocos editor assembly
Cocos preview assembly
Web build
Native build
Mini game build if target project enables it
fresh clone bootstrap
fresh Cocos editor restart
```

每个目标都要证明：

- `yzforge` 可解析。
- Main script 不 MissingScript。
- generated refs/contracts 可解析。
- runtime deep alias 未暴露。
- 首包 contract 不引入动态 Bundle 实现。
- Bundle 加载后 Entry 注册成功。

## ResourceOwnershipPolicy

ReleaseScope 和 OwnershipLedger 继续保留，但资源释放要拆成更细的策略。

```text
ReleaseScope
  when owner lifetime ends

OwnershipLedger
  what owner currently holds

AssetScope
  which assets and nodes are tracked

BundleManager
  physical bundle load/unload

CachePolicy
  whether released resources stay warm

MemoryPressurePolicy
  when cache must be purged
```

Module 卸载时的顺序：

```text
navigator detach
close owned UI
unload owned ContentPacks
dispose flows/services/models
call module onUnload
release module assets
release acquired libraries
release content pack handles
release module bundle owner
apply cache policy
record ownership snapshot
```

失败策略：

```text
every step runs
errors are aggregated
ownership snapshot records unreleased holdings
Validator or runtime diagnostic reports leaked ownerKey
```

## Validator 重新分层

硬终局 Validator 分成四层：

```text
Static Validator
  TypeScript AST
  import graph
  generated hash
  descriptor schema

Cocos Asset Validator
  scene/prefab serialization
  script uuid/meta
  bundle meta
  missing script

Runtime Contract Validator
  entry/ref consistency
  token/provider consistency
  content pack manifest identity
  release ownership smoke

Build Resolver Validator
  Cocos assembly
  preview assembly
  build output module resolution
```

regex 只允许用于补充提示，不作为唯一验收依据。

## 当前实现到硬终局的路线

这不是临时方案路线，而是同一终局契约的硬化顺序。

### Phase A：App 状态机

目标：

- 增加 `AppState`。
- 所有 public API 加状态断言。
- `dispose` 支持 Starting / Failed 回滚。
- Smoke 覆盖重复 start、start 中 dispose、disposed 后 enterModule。

验收：

```text
npm run typecheck
npm run yzforge:smoke
strict validator sees App state guards
```

### Phase B：Extension 事务

目标：

- `ExtensionRegistry` 支持 transaction。
- `ExtensionContext.provide` 等副作用可回滚。
- 安装失败 dispose 已完成部分。
- 错误包含 extension name、phase、dependency chain、rollback failures。

验收：

```text
extension install fails halfway
previous tokens removed
installed extensions disposed in reverse order
App returns to defined state
```

### Phase C：ToolchainResolver

目标：

- 移除硬编码 Cocos 路径。
- 新增 `.yzforge/toolchain.json` 或环境变量。
- CLI 输出可执行修复提示。

验收：

```text
rename local Cocos path
tool reports missing resolver with clear message
configure resolver
typecheck/validate/smoke pass again
```

### Phase D：Runtime package 解耦

目标：

- runtime 源码权威迁到 `packages/yzforge-runtime/src`。
- `assets/yzforge/runtime` 变成生成/同步产物。
- 项目根 package name 可恢复为游戏项目名。
- Cocos editor / preview / build 仍能解析 `yzforge`。

验收：

```text
fresh clone
generate
Cocos restart
editor assembly yzforgeErrors = 0
preview assembly yzforgeErrors = 0
build target yzforgeErrors = 0
```

### Phase E：BuildMatrixValidator

目标：

- 把 Cocos editor / preview / build 解析验证做成 CLI。
- 记录每个 target 的 resolver evidence。
- CI 可运行不依赖人工打开面板。

验收：

```text
npm run yzforge:validate:build-matrix
```

### Phase F：资源释放策略硬化

目标：

- 区分 owner release、asset release、bundle release、cache purge。
- OwnershipLedger 能显示 leaked ownerKey。
- MemoryPressurePolicy 可触发缓存清理。

验收：

```text
module unload with onUnload error
all release steps still run
leaked holdings are visible
cache policy result is visible
```

## 不再接受的设计

硬终局下不接受：

- 为了某个 Cocos 解析问题再新增第二套业务 import 路径。
- 让业务 deep import runtime 子路径。
- 让 Extension 直接写 `app.audio`、`app.net` 等字段。
- 让 Main 代替 App 状态机。
- 让 generated 文件成为手写维护点。
- 让本机 Cocos 路径成为框架前提。
- 用“当前 editor 能跑”替代 build target 验证。
- 只用日志没有结构化 evidence 的验收。

## 最终判断

当前重构已经完成了第一层终局：

```text
Scope / Contract / Bundle / Handle
yzforge package boundary
generated path maps
runtime-template drift guard
Main lifecycle guard
Cocos assembly import guard
```

但我心里更硬的终局是：

```text
强 App 状态机
事务化 Extension
独立 runtime package identity
可迁移 ToolchainResolver
多目标 BuildMatrixValidator
分层 ResourceOwnershipPolicy
AST / Cocos 结构化 Validator
```

只有到这一层，YZForge 才真正从“这个项目里稳定”变成“换项目也稳定”。
