# 03. 运行时与生命周期

## App 是公开 facade

业务主要使用这些入口：

```ts
await app.start({ mainRoot, viewport });

const preload = await app.preloadModule(BattleRef);
const lease = await app.loadModule(BattleRef);
await app.enterModule(BattleRef, { levelId: 'level-1' });

await lease.release();       // 释放这一次持有
await app.unloadModule(BattleRef); // 强制卸载当前 record
await app.dispose();
```

`app.lifecycle` 和 `app.viewport` 是只读 reader，只提供订阅与读取；初始化、刷新、emit 和 dispose 留在 AppKernel 内部。

## Module record 与 Module lease

```text
ModuleRecord
  instance / assets / config / libraries / content packs / scope
  leases: Set<ModuleLease>

ModuleLease
  leaseId / released
  readonly instance / assets / config / contentPacks
  release()
```

同一 Module 的并发 load 共享创建任务，但每个调用方在任务完成后获得独立 Lease。旧 generation 的已释放 Lease 再次调用 `release()`，不能卸载后来重新加载的 Module。

## Module 生命周期

正常顺序：

```text
construct
  -> onCreate
  -> onLoad
  -> onEnter
  -> onPause / onResume
  -> onExit
  -> onUnload
  -> unit onDispose
```

生命周期调度通过框架内部 symbol 协议执行。业务子类只能覆写 protected hook，不能调用 load/enter/unload 控制方法。

Model、Service、Flow 由所属 Module 延迟创建。销毁时每个 unit 都会获得清理机会；一个清理失败不会跳过后续 unit。

## 补偿事务

Module 创建的每一步成立后立即登记逆操作：

```text
create module scope
acquire libraries
acquire bundle
resolve and validate entry
create assets/config/UI/content-pack access
construct and bind module
run onCreate/onLoad
commit record
```

任一步失败时，逆序执行所有已登记动作。原始错误是 primary cause，rollback 错误按 step 聚合在同一结构化错误中。

View open、Library record、ContentPack record、导航切换和生成器提交使用同一种补偿思想。

## 导航串行化

`enter`、`back` 和 Module detach 进入同一 transition queue，不能并行改写当前模块和返回栈。

`Push` 会保留前一个 Module lease；`Replace` 按策略退出或卸载前一个 Module。失败时 Navigator 逆序恢复生命周期/UI，并在 snapshot 中记录 `lastFailure`，不会静默停在半切换状态。

## 释放顺序

强制卸载 Module 时，所有步骤都会尝试执行：

1. 从 Navigator 脱离；
2. 关闭该 Module 的 UI；
3. 释放 ContentPack leases；
4. 执行 Module 与 unit dispose；
5. 释放 Module scope 中的 Part、asset、Library 和 Bundle leases；
6. 释放遗留 preload leases。

最终若有失败，返回 `module.unload_failed` 及逐步错误，而不是在第一处清理错误时中止。

## 诊断

`app.snapshot()` 提供只读运行时证据：Module lease count、ownership generations、leaks、bundle cache、entry script/resource residency、Navigator、UI、viewport 和最近失败。
