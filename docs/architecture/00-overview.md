# 00. V2 概览

YZForge 是一套面向 Cocos Creator 的强约束模块化框架。它解决的核心问题不是“如何封装更多 Manager”，而是动态加载之后谁持有、谁释放、失败如何回滚，以及业务能够看到哪些能力。

## 四个基本概念

| 概念 | 职责 | 例子 |
| --- | --- | --- |
| Scope | 代码、资源、配置和依赖的归属边界 | Module、Library、ContentPack、Global |
| Contract | 首包可见的身份与类型投影 | `ModuleRef`、`LibraryRef`、`ContentPackRef` |
| Bundle | Cocos 的物理加载与缓存容器 | `yzforge-module-battle` |
| Lease | 某个调用方的一次独立持有 | `ModuleLease`、`LibraryLease`、`ContentPackLease` |

共享对象与释放权必须分离。例如两个调用方可以共享同一个 Library record，但会拿到两个不同的 `LibraryLease`。释放其中一个不能影响另一个。

## 运行时边界

```text
业务代码
  -> App / Module / View / Part / Ref / Lease
  -> readonly lifecycle / viewport / clock / storage

框架内部
  -> AppKernel
  -> BundleManager / UIManager / ModuleNavigator
  -> EntryRegistry / LibraryRegistry / OwnershipLedger
```

业务入口 `yzforge` 不导出 Kernel、Manager、Registry 和 `ReleaseScope`。生成代码使用 `yzforge/authoring`，Validator 禁止业务代码导入该入口。

## 生命周期原则

- 每个 Scope 有唯一 `OwnerIdentity`；同一路径再次创建时 generation 递增。
- 每次 acquire 返回独立且幂等的 Lease。
- Module、View、Library、ContentPack 的部分失败使用逆序补偿事务。
- 一个清理步骤失败时，其他清理仍继续，并最终返回聚合错误。
- App 的导航、返回和卸载通过同一串行队列协调。

## 资源原则

- Asset/Node 持有由 owner scope 和 asset lease 决定。
- Bundle record 只管理物理 bundle 与共享加载任务。
- 零 lease 后是否保留 bundle 由 cache policy 决定。
- 不使用 `bundle.releaseAll()` 代替所有权释放。
- 已执行脚本视为当前 JS VM resident；resource bundle 是否 resident 是另一项状态。

## 构建期原则

- descriptor、Excel 和 prefab marker 是手工事实源。
- `*.generated.ts`、配置 JSON、ContentPack manifest 和 runtime copy 是派生物。
- 生成器先完成计划并验证，再以可回滚事务提交。
- `tsconfig.json` 属于用户；`tsconfig.yzforge.json` 属于生成器。
