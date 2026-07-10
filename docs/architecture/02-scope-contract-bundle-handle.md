# 02. Scope / Contract / Bundle / Lease

文件名保留旧称以避免链接失效；V2 的第四个概念是 `Lease`，不是共享的可释放 Handle。

## Scope

| Scope | 适合内容 | 依赖方向 |
| --- | --- | --- |
| Module | 功能拥有的玩法、UI、Service、Model、Flow | 可依赖 Library 和自己的 ContentPack |
| Library | 跨 Module 的服务、数据和 token contract | 只依赖其他 Library |
| ContentPack | 某个 Module 拥有的可选内容 | 依赖声明的 Library，不能提供业务 View |
| Global | App 级共享 UI 和资源 | 不承载模块私有业务 |

代码和资源应留在最小 owning Scope。跨 Module 不导入对方的 `code/**`，只使用首包 Contract 或共享 Library。

## Contract

生成的 ref 位于 `assets/app/registry`，公开类型位于 `assets/app/contracts`。这些文件在动态 bundle 加载前可见，描述：

- 稳定 identity；
- bundle 名；
- Library 依赖；
- Module enter params；
- ContentPack 的 key/kind/type contract。

Contract 不包含业务实现，也不复制 ContentPack 的运行时资源路径。

## Bundle

Bundle 是 Cocos 资源容器。`BundleManager` 内部共享物理加载任务，但每个调用方获得自己的 `BundleLease`。

```text
BundleRecord
  bundle / loading task / cache state
  leases: Map<leaseId, OwnerIdentity>

BundleLease
  unique leaseId
  owner-specific
  idempotent release
```

`removeBundle` 只移除资源容器。已执行的脚本可能继续驻留在 JS VM，因此 Entry diagnostics 分别报告：

- `script: resident`
- `resources: resident | absent`

## OwnerIdentity

```ts
interface OwnerIdentity {
    readonly id: string;
    readonly path: string;
    readonly generation: number;
}
```

`id` 是 ledger 主键，`path` 只是可读诊断。旧 generation 的泄漏不会被同路径的新 Scope 覆盖。

## Lease 规则

- 每次 acquire 返回不同对象和不同 lease id。
- Lease 释放只删除自己的持有。
- 手工释放会注销 owner scope 中对应的自动清理动作。
- owner scope 关闭时，仍存活的 Lease 自动释放。
- 最后一个 Lease 释放后，共享 record 才进入 dispose/purge。

Module 也分为共享 `ModuleRecord` 与调用方 `ModuleLease`。多次 `app.loadModule(ref)` 共享实例，但拿到独立 Lease；最后一个 Lease 释放才自动卸载。`app.unloadModule(ref)` 是显式强制卸载，会使当前全部 Lease 失效。
