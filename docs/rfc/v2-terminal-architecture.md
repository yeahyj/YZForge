# 15. YZForge V2 终局架构契约

## 状态

本文件取代此前 RFC 中与运行时所有权、公开 API、ContentPack manifest、生成器宿主配置所有权有关的设计。

V2 是不兼容重构，不提供旧 API 适配层，不保留双轨运行时，也不允许以“稍后迁移”为理由增加临时入口。

## 保留的主轴

YZForge 继续使用四层模型：

```text
Scope
  代码、资源、配置和依赖的所有权边界

Contract
  动态 Scope 加载前可见的类型和身份契约

Bundle
  Cocos 物理资源加载、缓存和移除边界

Lease
  某个唯一 Owner 对已加载能力的一次持有
```

旧称 `Handle` 只保留为通用只读访问概念。凡是带释放责任的运行时对象，统一使用 `Lease` 语义。

## 一、OwnerIdentity 是唯一身份

Owner 不再使用 `module:Home` 这类可重复字符串作为身份。

```ts
interface OwnerIdentity {
    readonly id: string;
    readonly path: string;
    readonly generation: number;
}
```

规则：

- 同一路径每创建一次 Scope，`generation` 必须递增，`id` 必须全局唯一。
- Released Scope 必须立即从父 Scope 的活动 child 集合移除。
- OwnershipLedger 以 `OwnerIdentity.id` 为主键，以 `path` 作为诊断信息。
- 新一代 Scope 不能覆盖、合并或清除旧一代 Scope 的泄漏证据。
- Scope 一旦进入 releasing，禁止再登记新资源；并发 acquire 必须通过 Lease 协调，保证加载完成后立即补偿释放。

## 二、每次 acquire 返回独立 Lease

共享运行时记录和 owner 持有必须分离：

```text
LibraryRecord
  共享 bundle / assets / config / token instances

LibraryLease(ownerId, leaseId)
  owner-specific
  idempotent release
```

规则：

- 不同 owner 不能共享同一个带 `release()` 的对象。
- 同一 owner 多次 acquire 也必须返回不同 lease，除非 API 明确命名为 `getOrAcquireOnce`。
- Lease 释放只能减少自己的持有，不能通过捕获的旧 owner key 释放其他 owner。
- Lease release 必须幂等。
- Owner Scope 释放时自动释放仍存活的 Lease。

Bundle、Library、ContentPack、预加载能力都遵守同一语义。

Module 同样拆分 `ModuleRecord` 与调用方 `ModuleLease`。同一 record 可有多个独立 lease；最后一个 lease 释放时自动卸载，显式 `app.unloadModule(ref)` 则强制使全部 lease 失效。

## 三、所有生命周期使用补偿事务

Module load、Module enter、View open、ContentPack load、Library load、Extension install 必须使用同一类补偿模型：

```text
begin
  execute step
  register inverse action
  execute next step
commit

on failure
  run every inverse action in reverse order
  aggregate rollback failures
  retain the original failure as primary cause
```

规则：

- 清理步骤自身失败不能阻断后续清理。
- 部分创建的 Module 必须执行已成立的 unit/module dispose 生命周期。
- 部分打开的 View 必须执行 disposer 和结果取消，不允许只 destroy Node。
- Navigator rollback 失败后必须留下结构化状态，不允许静默处于半切换状态。
- 所有聚合错误必须包含 operation、primary cause、compensation step 和 rollback error。

## 四、Manifest 是运行时唯一事实源

Scope descriptor 是构建期事实源，ContentPack 内 manifest 是加载后的运行时事实源。

```text
content-pack.json
  构建身份、owner、bundle、dependencies

manifest.generated.json
  实际内容 refs、config、schemaVersion、contentHash

generated TypeScript
  类型投影、资源构造器和 manifest compatibility contract
  不保存第二份运行时路径数据
```

规则：

- LoadedContentPack 的 refs 和 config 路径必须来自已加载 manifest。
- TypeScript contract 只提供 key、kind、asset constructor、row type 和兼容 hash。
- manifest 与 contract 的 key/kind/type 不兼容时加载失败。
- manifest identity 校验必须覆盖 schemaVersion、id、owner、bundle、dependencies 和 content hash。
- 不允许同时从 TypeScript ref 和 manifest 读取路径。

## 五、公开 API 是能力接口，不是 Kernel 对象

顶层 `yzforge` 只导出业务稳定 API：

```text
AppFacade
Module / Model / Service / Flow
View / Part
Ref / Contract / Lease interfaces
readonly lifecycle / viewport / clock ports
Extension contracts and tokens
```

生成代码使用独立入口 `yzforge/authoring`。

规则：

- `UIManager`、`ModuleNavigator`、`LibraryRegistry`、`EntryRegistry`、`OwnershipLedger`、`ReleaseScope`、`ConfigManager` 不从 `yzforge` 导出。
- App 不暴露可调用 `install/dispose/emit/initialize/refresh` 的控制器。
- ViewHandle 不暴露可写 state、原始 owner 或内部 ViewRuntime。
- Module 生命周期控制函数不属于公共 Module API。
- View/Part 生命周期控制使用框架内部 symbol；Part 由 `ModuleAssets.createPart()` 返回的 `PartLease` 持有。
- Validator 必须禁止业务代码导入 `yzforge/authoring`。

## 六、Viewport 只有一个 profile source

ViewportController 负责读取 Cocos screen/view/sys，并输出设计坐标系中的 DeviceProfile。

所有 ScreenFitter、SafeAreaRoot、FullScreenRoot 和业务观察者订阅同一 profile source，不得再次直接读取安全区并自行换算。

## 七、资源释放分层

```text
OwnerScope
  决定谁负责释放

AssetLease
  记录具体 asset/node 持有

BundleRecord
  记录物理 bundle 和加载任务

CachePolicy
  决定零 lease 后保留或 purge

PlatformPurgeAdapter
  处理平台差异和内存压力
```

禁止把 `bundle.releaseAll()` 当作所有权模型。跨 Bundle 依赖、共享材质、图集、Spine、音频等必须先由 AssetLease 释放策略处理。

Cocos 已执行的脚本是否能从 JS VM 卸载属于平台事实，不能用 `removeBundle` 伪装成代码卸载。Entry catalog 必须明确区分 script resident 与 resource bundle resident。

## 八、生成器只拥有派生物

生成器拥有：

- `*.generated.ts`
- `manifest.generated.json`
- `assets/yzforge/runtime` Cocos-visible copy
- `tsconfig.yzforge.json`
- YZForge 自己的 import-map entries 和 npm scripts

生成器不拥有：

- 用户的整个 `tsconfig.json`
- 用户的非 YZForge `compilerOptions.paths`
- 用户的 package scripts、dependencies、exports
- 用户 import map 中的其他 entries

生成流程必须 plan-first、validate-first、atomic-commit。任一步失败时不得留下半套生成物。

## 九、正式 Schema 与版本

- Module、Library、ContentPack descriptor 必须引用提交到仓库的 JSON Schema。
- Schema、runtime ABI、generator version、framework version 分别版本化。
- V2 runtime/generated entry ABI 由 `YZFORGE_RUNTIME_ABI = 2` 固定，ref 与 entry 在加载时必须一致。
- 创建器版本必须绑定确定的模板 tag 或内置归档，禁止默认 clone 浮动的 `main`。
- 升级必须从可验证的发布物获得框架文件，再执行连续 migration。

## 十、验收原则

静态校验全绿不等于运行时正确。V2 必须额外覆盖：

- 同名 Module 连续 load/unload 100 次。
- 两个 owner 共享 Library，交错 release。
- dispose 与 bundle/config/view 异步加载竞态。
- 每个生命周期步骤的失败注入。
- compensation 自身失败。
- ContentPack manifest 与 contract 篡改。
- Viewport resize/safe-area 单一数据源。
