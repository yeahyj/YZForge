# 01. 目录结构

## 先判断归属

YZForge 的目录不是按“文件类型”优先，而是按 `Scope` 所有权优先。

| Scope | 放什么 | 不放什么 |
| --- | --- | --- |
| `app/main` | 启动场景、Main 组件、系统 UI 节点 | 具体业务玩法 |
| `app/global` | 账号、会话、全局 UI、全局服务 | 某个模块独占的业务逻辑 |
| `shared/code` | 无状态、可被多个 Scope 静态 import 的基础代码 | 有业务状态的 Service、Model |
| `modules/<Module>` | 可进入、可打开、可卸载的业务功能 | 给其他模块直接 import 的实现 |
| `libraries/<Library>` | 多模块复用的领域能力 | 页面流程和模块 UI |
| `content-packs/<Owner>/<Pack>` | owner Module 解释的内容资源 | TS 业务源码和可调用 API |

## Module 内部

推荐结构：

```text
assets/modules/Battle/
  module.json
  code/
    BattleModule.ts
    public.ts
    generated/
      entry.ts
      assets.ts
      config.ts
      content-packs.ts
    events/
      index.ts
    flow/
    model/
    service/
    view/
    part/
  res/
    view/
    part/
    runtime/
    content/
    sound/
```

`flow/`、`model/`、`service/`、`view/`、`part/` 是推荐分法，不是框架硬编码。框架真正依赖的是 `module.json`、`code/public.ts`、`code/generated/` 和 `res/` 约定。

## Library 内部

推荐结构：

```text
assets/libraries/BattleCore/
  library.json
  code/
    public.ts
    providers.ts
    generated/
      entry.ts
      assets.ts
      config.ts
    system/
    helper/
  res/
    prefab/
    runtime/
    content/
    sound/
```

Library 通过 `public.ts` 暴露类型和 token，通过 `providers.ts` 提供实现。业务模块不 import Library 内部实现。

## 资源目录

| 目录 | 用途 |
| --- | --- |
| `res/view` | 交给 UIManager 打开的 View prefab |
| `res/part` | View 内动态创建的 UI 片段 |
| `res/runtime` | 代码显式加载的资源，会进入 `generated/assets.ts` |
| `res/content` | 被 prefab 或配置间接引用的内容，默认不作为普通资源 ref |
| `res/sound` | 音频资源，交给音频扩展或项目音频系统扫描 |

如果代码要显式加载一个资源，把它放进 `runtime`。如果只是 prefab 内部引用，放 `content` 更清楚。

## 不推荐的结构

不要这样做：

```text
assets/scripts/
assets/game/
assets/modules/Common/
assets/modules/Utils/
assets/resources/
```

这些目录会把所有权打散。后期最容易出现跨模块 import、资源路径手写、功能无法卸载的问题。

如果一个能力不知道该放哪里，先问两个问题：

- 它有没有业务状态？有状态就不要进 `shared/code`。
- 它是否被两个以上 Module 复用？复用的是领域能力就建 `Library`，只是数据内容就建 `ContentPack`。
