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

当前 AppStateMachine 已经落地：

- `AppState` 暴露 `Created`、`Starting`、`Started`、`Disposing`、`Disposed`、`Failed`。
- `App.state` 和 `AppRuntimeSnapshot.state` 暴露当前状态。
- `start`、`preloadModule`、`loadModule`、`enterModule`、`unloadModule`、`installExtension`、`use`、`useModuleToken`、`dispose` 都有状态守卫。
- `dispose` 支持 `Created`、`Starting`、`Started`、`Failed`，并对 `Disposed` 幂等。
- `dispose` 会等待正在进行的 `start` 和 module load task 收口，再卸载模块。
- 非法状态调用抛出 `app.invalid_state`。

当前 ExtensionTransaction 已经落地第一版：

- 每个 install phase 都有事务记录。
- `ExtensionContext.provide` 和 `provideModule` 在 phase 失败时会恢复到 phase 前状态。
- phase 中已成功执行 hook 的 Extension 会在后续 hook 失败时按反向顺序 dispose。
- late install 失败会从 registry 中移除该 Extension。
- phase error 会保留 extension name、phase、dependency chain、cause，并附带 rollback failure 摘要。

当前 Validator 能检查：

- `package.json.exports`、`tsconfig.paths`、`import-map.json` 和 Cocos project setting 是否一致。
- 旧别名是否重新出现。
- runtime deep import 是否绕过 `yzforge` 顶层入口。
- Cocos editor / preview assembly 是否还存在 unresolved `yzforge` import。
- Main 场景结构、Main script 挂载和 Main 生命周期关键调用。

这些边界让当前框架从“能跑”进入了“有架构边界”的状态。

## 当前仍不够硬的地方

下面这些不是当前实现错误，而是我对当前框架仍不满意的地方。它们应该进入下一版硬化设计。

### App 状态机已落地后的剩余遗憾

当前已经有统一状态：

```text
Created
Starting
Started
Disposing
Disposed
Failed
```

但我仍不满意这些点：

- `start` 失败回滚已经会调用 dispose 路径，但 Extension 安装副作用还不是事务化记录。
- `preloadModule` 目前没有独立 task map，依赖 ReleaseScope 在释放后登记动作时立即执行。
- 状态守卫是 runtime API 级别，Validator 还没有用 AST 强制每个新增 public API 都声明状态规则。
- `Failed` 状态后的二次诊断还比较薄，只能通过原始错误和 snapshot 判断。

后续硬终局要求：每个新增 public API 必须同时增加状态规则、行为 smoke 和文档表格。

### Extension 安装不是事务

当前 Extension 已经通过 `ExtensionContext` 和 token 收窄能力，安装 phase 也已经有第一版事务回滚。

剩余遗憾：

- 事务目前覆盖 token side effect 和本 phase hook dispose，还没有统一记录 lifecycle listener、codec、service、system ui provider 等未来扩展点。
- rollback dispose 使用 Extension 的全局 `dispose/uninstall`，还没有 phase-specific rollback hook。
- Validator 还没有结构化检查所有 `ExtensionContext` 新增副作用都登记到 transaction。

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

### Runtime package 已解耦后的剩余风险

当前第一版 RuntimePackageBoundary 已经落地：

- `packages/yzforge-runtime/package.json` 拥有 `name: "yzforge"` 和 runtime public export。
- 项目根 `package.json.name` 已恢复为游戏项目身份，不再占用 `yzforge`。
- `tsconfig.paths.yzforge` 指向 `packages/yzforge-runtime/src/index.ts`。
- `import-map.json` 的 `yzforge` 指向 `assets/yzforge/runtime/index.ts`，作为 Cocos 可见 copy。
- Generator 会把 `packages/yzforge-runtime/src` 同步到 `extensions/yzforge/runtime-template` 和 `assets/yzforge/runtime`。
- Validator 会检查 root package identity、runtime package exports、source/template/assets drift，以及 runtime deep physical import。

剩余风险：

- 真实 Cocos editor / preview / Web build 对“root package 不叫 yzforge，只靠 import-map”的解析已经由 BuildMatrixValidator 和 Cocos CLI build 证明；Native / 小游戏平台仍需要按项目目标继续扩展。
- 当前 TypeScript、smoke、fresh clone 和 Web build 已证明 source package 路径与 Cocos 可见 copy 可用；仍缺少 fresh Cocos editor restart 的自动化矩阵。
- `extensions/yzforge/runtime-template` 还保留为 copy/cache；未来可以退化成安装缓存或直接由 package 发布物生成。

目标形态保持：

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

### runtime-template 双份同步已收敛后的剩余遗憾

当前：

```text
packages/yzforge-runtime/src
extensions/yzforge/runtime-template
assets/yzforge/runtime
```

runtime 源码已经只有一个权威来源，template 和 assets 都是同步 copy。它仍然不是最干净的最终形态，因为仓库中仍有两份同步 copy。

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

### ToolchainResolver 已落地后的剩余遗憾

当前第一版 ToolchainResolver 已经落地：

- `extensions/yzforge/editor/toolchain.js` 统一解析 Cocos Editor root、Cocos TypeScript、engine editor assets、project settings 和 temp assembly。
- ToolchainResolver 可以解析 `CocosCreator.exe` / Cocos executable，为后续自动 build 提供入口。
- `npm run yzforge:cocos:build:web` 会调用 Cocos CLI 生成 web-desktop debug build，并要求预期 output 目录存在才算成功。
- `runCocosBuild` 会为 Cocos CLI 子进程移除 `ELECTRON_RUN_AS_NODE`，避免 Electron 版 `CocosCreator.exe` 被当前 Node 环境误当成普通 Node 进程解析参数。
- `package.json` 的 `typecheck` 不再硬编码本机 Cocos 路径，而是走 `node extensions/yzforge/editor/cli.js typecheck`。
- `generate` 只维护可提交的稳定 `tsconfig.json`：`db://assets/*` 指向 `assets/*`，不再写入项目根绝对路径、`db://internal/*` 或 Cocos temp 配置。
- `typecheck` 由 ToolchainResolver 在运行时生成 `temp/yzforge/tsconfig.typecheck.json`，动态注入 Cocos `cc` / `jsb` 声明、`cc/env` shim 和 `db://internal/*`。
- `generate` 会生成 `.yzforge/toolchain.schema.json`、`.yzforge/toolchain.example.json` 和 `.yzforge/.gitignore`；真实 `.yzforge/toolchain.json` 是本机配置，不提交。
- `validate` 和 `smoke` 通过 ToolchainResolver 加载 TypeScript。
- strict Validator 会检查 package scripts、`db://assets/*`、禁止提交态 `db://internal/*`、禁止 `extends ./temp/tsconfig.cocos.json`、禁止 `temp/declarations/*`、ToolchainResolver schema/template，并扫描 editor 工具，禁止 Cocos 安装路径散落在 `toolchain.js` 之外。

我仍不满意这些点：

- known fallback paths 仍是实用兜底，不等于真正解析 Cocos Dashboard profile。
- smoke 已经覆盖脚本、path map、Cocos temp tsconfig、`temp/declarations`、项目根绝对路径和提交态 `db://internal/*` 负例，但还没有自动执行“重命名本机 Cocos 路径后重新配置”的物理验收。
- BuildMatrixValidator 已经把 editor / preview / Web build 全目标解析证据统一收口；Native / 小游戏平台仍需要按项目能力扩展。

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
resolveCocosEngineRoot()
resolveCocosEngineAssets()
resolveCocosProjectSettings()
resolveCocosTempAssembly(target)
prepareTypecheckTsconfig()
```

禁止在业务代码、生成器、Validator、Smoke 中散落硬编码路径。

当前实现：

```text
extensions/yzforge/editor/toolchain.js
  resolveCocosEditorRoot
  resolveCocosExecutable
  resolveCocosBuildOutputPath
  resolveCocosTypeScript
  resolveCocosEngineRoot
  resolveCocosEngineAssets
  resolveCocosProjectSettings
  resolveCocosTempAssembly
  prepareTypecheckTsconfig
  runTypecheck
  runCocosBuild

package.json
  typecheck -> node extensions/yzforge/editor/cli.js typecheck
```

`generate --check` 和 `validate --strict` 必须证明这些映射没有漂移。`smoke` 必须证明把 `typecheck` 脚本、`db://assets/*`、`db://internal/*` 或 `temp/tsconfig.cocos.json` 改回本机/临时路径时，strict Validator 会失败，并且 `generate` 可以修复。

失败信息必须可执行：

```text
Cannot resolve Cocos Editor root.
Set YZFORGE_COCOS_EDITOR_ROOT or configure .yzforge/toolchain.json.
```

## BuildMatrixValidator

当前第一版 BuildMatrixValidator 已经落地：

- 新增 `extensions/yzforge/editor/build-matrix.js`。
- 新增 `npm run yzforge:validate:build-matrix`。
- 读取 Cocos editor / preview assembly record。
- 输出每个 target 的 resolver evidence：path、chunks、`yzforgeImports`、unresolved details。
- 对 unresolved `yzforge` import 失败。
- build output 存在时扫描 JS / JSON / HTML / TXT / log 产物，检查裸 `yzforge` import、unresolved resolver marker 和 MissingScript marker。
- build output 未存在时输出 `not_collected` evidence，不把它伪装成已证明。
- 已通过真实 `npm run yzforge:cocos:build:web` 生成 `build/yzforge-build-matrix`。
- 随后 `npm run yzforge:validate:build-matrix` 已证明 `build:yzforge-build-matrix` 产物中裸 `yzforge` import、unresolved marker 和 MissingScript marker 都为 0。
- MissingScript 检查会忽略 Cocos 引擎自身导出的 `MissingScript` 符号，只对日志诊断、`cc.MissingScript` 或序列化资产中的 MissingScript 类型失败。

当前 editor / preview / Web build 已经有结构化证据；fresh clone bootstrap 已经通过 `generate:check`、`validate:strict`、`typecheck`、`smoke`。仍未覆盖的是 Native / 小游戏平台和 fresh Cocos editor restart 的自动化矩阵。

fresh clone bootstrap 证据：

```text
clone to temp directory
apply current working diff
npm run yzforge:generate:check   -> passed, changed = []
npm run yzforge:validate:strict  -> passed, issues = []
npm run typecheck                -> passed, generated temp/yzforge/tsconfig.typecheck.json
npm run yzforge:smoke            -> passed
```

硬终局验收矩阵：

```text
typecheck
generate --check
validate --strict
smoke
yzforge:cocos:build:web
validate-build-matrix
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

当前第一版 ResourceOwnershipPolicy 已经落地：

- `OwnershipLedger.snapshot()` 暴露 `leaks`，即 released scope 仍持有的资源记录。
- `ReleaseScope.release` 会继续执行所有 child/action，聚合失败为 `release.scope_failed`。
- `AssetScope.releaseAll` 会逐项释放节点和 asset；某个 asset release 失败时继续释放其他资源，并保留失败 asset 作为 leak evidence。
- `BundleManager` 区分 owner release 与物理 bundle purge，snapshot 暴露 `cacheState`。
- `BundleManager.purgeUnusedBundles` 可以清理零引用 hot bundle cache。
- `App.purgeResourceCache` 作为 facade API 触发 cache purge。

ReleaseScope 和 OwnershipLedger 继续保留，但资源释放已经拆成更细的策略。

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

剩余遗憾：

- MemoryPressurePolicy 还没有平台事件输入，只能由 `App.purgeResourceCache` 或内部策略主动触发。
- Bundle cache policy 目前以 Bundle 为粒度，还没有区分图集、材质、Spine、音频等资源类别。
- leak evidence 已可见，但还没有 editor 面板专门展示 ownerKey -> resource 的释放链路。

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

状态：已实现第一版。

已落地：

- 增加 `AppState`。
- 所有 public API 加状态断言。
- `dispose` 支持 Starting / Failed 回滚。
- Smoke 覆盖重复 start、start 中 dispose、disposed 后 enterModule。
- `dispose` 等待 pending module load task 后再卸载模块。

验收：

```text
npm run typecheck
npm run yzforge:smoke
strict validator sees App state guards
```

后续增强：

- Validator 使用 AST 检查新增 public API 是否有状态守卫。
- `preloadModule` 增加 task map，让 preload 与 dispose 的关系和 module load 一样显式。
- App failure snapshot 展示最后一次失败 API、状态迁移和错误摘要。

### Phase B：Extension 事务

状态：已实现第一版。

已落地：

- `ExtensionRegistry` 支持 transaction。
- `ExtensionContext.provide` 等副作用可回滚。
- 安装失败 dispose 已完成部分。
- 错误包含 extension name、phase、dependency chain、rollback failures。
- Smoke 覆盖 phase 失败后 token 回滚和 completed extension rollback dispose。

验收：

```text
extension install fails halfway
previous tokens removed
installed extensions disposed in reverse order
App returns to defined state
```

后续增强：

- 将 lifecycle listener、codec、service、system ui provider 等副作用纳入同一个 transaction。
- 为 Extension 增加可选 phase-specific rollback hook。
- Validator 使用 AST 检查 `ExtensionContext` 新增方法必须有 rollback 记录。

### Phase C：ToolchainResolver

状态：已实现第一版。

已落地：

- 移除硬编码 Cocos 路径。
- 支持 `.yzforge/toolchain.json` 和环境变量。
- `typecheck` 通过 YZForge CLI 调用 Cocos TypeScript。
- `generate` 只写可迁移 root `tsconfig.json`，不提交 Cocos temp、项目根绝对路径或 `db://internal/*`。
- `typecheck` 运行时生成 `temp/yzforge/tsconfig.typecheck.json`，由 resolver 注入 Cocos engine declarations 和 `db://internal/*`。
- `generate` 生成 `.yzforge/toolchain.schema.json`、`.yzforge/toolchain.example.json` 和 `.yzforge/.gitignore`，让本机 toolchain 配置有稳定模板且默认不提交真实路径。
- strict Validator 检查 package scripts、可迁移 path map、Cocos temp 依赖和 editor 工具硬编码路径。
- Smoke 覆盖 typecheck script、Cocos temp tsconfig、项目根绝对路径、`db://internal/*` 和 ToolchainResolver template 负例。

验收：

```text
npm run typecheck
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run yzforge:smoke
```

后续增强：

- 结构化读取 Cocos Dashboard profile，而不是只依赖环境变量和 known fallback paths。
- 增加真实物理验收：临时移除本机 fallback，确认 tool 报错，配置 resolver 后恢复通过。

### Phase D：Runtime package 解耦

状态：已实现第一版。

已落地：

- runtime 源码权威迁到 `packages/yzforge-runtime/src`。
- `assets/yzforge/runtime` 变成生成/同步产物。
- 项目根 package name 可恢复为游戏项目名。
- `extensions/yzforge/runtime-template` 也变成 source package 的同步 copy。
- `packages/yzforge-runtime/package.json` 拥有 `name: "yzforge"`。
- root `package.json` 不再拥有 runtime exports，也不再占用 `name: "yzforge"`。
- TypeScript 解析 `yzforge` 到 source package，Cocos Import Map 解析到 assets copy。
- Validator 和 Smoke 覆盖 source/template/assets drift、root package identity、runtime package exports、runtime deep physical import。

验收：

```text
npm run typecheck
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run yzforge:smoke
```

仍未完成的验收：

```text
Cocos restart
editor assembly yzforgeErrors = 0
preview assembly yzforgeErrors = 0
build target yzforgeErrors = 0
```

这些进入 Phase E：BuildMatrixValidator。

### Phase E：BuildMatrixValidator

状态：已实现第一版。

已落地：

- 把 Cocos editor / preview / build 解析验证做成 CLI。
- 记录每个 target 的 resolver evidence。
- editor / preview assembly 中 unresolved `yzforge` import 会失败。
- build output 存在时会扫描产物中的裸 `yzforge` import、unresolved marker 和 MissingScript marker。
- build output 缺失会以 `not_collected` evidence 暴露。
- `yzforge:cocos:build:web` 会先生成真实 web-desktop build；当前 `build/yzforge-build-matrix` 已被 build-matrix 扫描通过。
- Cocos CLI 环境会隔离 `ELECTRON_RUN_AS_NODE`，避免命令行构建被 Node/Electron 环境变量污染。

验收：

```text
npm run yzforge:cocos:build:web
npm run yzforge:validate:build-matrix
```

后续增强：

- 扩展到 Native / 小游戏 build evidence。
- fresh Cocos editor restart 后自动刷新 editor / preview assembly evidence。
- 对 build artifact 做 resolver-level 检查，而不是只记录 build 目录存在。

### Phase F：资源释放策略硬化

状态：已实现第一版。

已落地：

- 区分 owner release、asset release、bundle release、cache purge。
- OwnershipLedger 能显示 leaked ownerKey。
- `App.purgeResourceCache` 可触发零引用 hot bundle cache 清理。
- Smoke 覆盖 release failure 聚合、leak evidence、Bundle hot cache 和 purge result。

验收：

```text
npm run typecheck
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run yzforge:validate:build-matrix
npm run yzforge:smoke
```

后续增强：

- 接入真实平台 memory pressure 事件。
- 按资源类型拆分 cache policy。
- 在 editor 面板展示 leaked ownerKey、resource key、scope release 状态和失败原因。

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
