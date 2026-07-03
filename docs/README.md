# YZForge 文档索引

YZForge 是一个面向 Cocos Creator 3.8 项目的工程治理框架。它的目标不是堆功能，而是用小核心、强契约、强生成器和强校验器，让长期项目仍然保持清晰边界。

终局形态：

```text
小核心 + Scope 边界 + 首包 Contract + 按需 Bundle + 运行时 Handle + 生成器 + Validator + 可插拔 Extension
```

## 核心模型

YZForge 的核心模型从旧的三层模型升级为四层：

| 层 | 作用 | 回答的问题 | 例子 |
| --- | --- | --- | --- |
| `Scope` | 代码所有权边界 | 这段代码属于谁，允许依赖谁 | `AppScope`、`SharedScope`、`ModuleScope`、`LibraryScope` |
| `Contract` | 首包公开契约 | 跨 Scope 可以安全知道什么 | `ModuleRef`、`LibraryRef`、公开参数类型、公开 token |
| `Bundle` | Cocos 物理加载边界 | 哪些代码和资源按需加载 | `yzforge-module-battle`、`yzforge-lib-battle-core` |
| `Handle` | 运行时使用句柄 | 加载后如何访问真实能力 | `LoadedModule`、`LoadedLibrary`、`LoadedContentPack` |

这四层不能混用：

- `Scope` 是架构边界，不等于 Cocos Bundle。
- `Contract` 必须在首包，不能 import 目标 Bundle 内部实现。
- `Bundle` 是 Cocos 的构建与加载结果，不代表业务 API。
- `Handle` 只能在 Bundle 加载完成后获得。

## 硬规则

- 跨 Module 只能通过 `ModuleRef` 进入、预加载或卸载。
- 跨 Library 只能通过 `LibraryRef` 和 `LoadedLibrary` 使用公开 token。
- `ModuleRef`、`LibraryRef`、公开类型和公开 token 都生成到首包 contract/registry。
- `Module`、`Library`、`ContentPack` 才是按需加载 Bundle。
- `global` 属于 `AppScope`，随首包启动，不是普通按需 Scope。
- `shared/code` 属于首包共享代码，允许被所有 Scope 静态 import。
- `ContentPack` 只放内容资源，不放业务 TS 源码，不提供可调用 API。
- `Service` 不直接打开 UI，`Flow` 负责流程编排和 UI 打开。
- 所有 generated 文件由生成器维护，Validator 防止手改和边界退化。

## 阅读顺序

1. [00-overview.md](./00-overview.md)：目标、非目标、四层模型和终局路线。
2. [01-project-structure.md](./01-project-structure.md)：标准目录、Scope 身份、Main 场景。
3. [02-scope-contract-bundle-handle.md](./02-scope-contract-bundle-handle.md)：Scope / Contract / Bundle / Handle 的完整关系。
4. [03-runtime-lifecycle.md](./03-runtime-lifecycle.md)：App、BundleManager、Module 生命周期和并发规则。
5. [04-assets-config-contentpacks.md](./04-assets-config-contentpacks.md)：资源清单、配置系统、ContentPack manifest。
6. [05-ui-autorefs.md](./05-ui-autorefs.md)：UI 分层、View、Part、AutoRefs。
7. [06-editor-validator.md](./06-editor-validator.md)：编辑器生成器、Import Maps、架构校验器。
8. [07-api-examples.md](./07-api-examples.md)：推荐 API 写法。
9. [08-roadmap.md](./08-roadmap.md)：分阶段落地路线。
10. [09-runtime-walkthrough.md](./09-runtime-walkthrough.md)：从启动到卸载的完整运行流程。

## 核心结论

- YZForge 的边界核心不是目录，而是 `Scope`。
- YZForge 的跨包核心不是 import，而是首包 `Contract`。
- YZForge 的加载核心不是业务类，而是 Cocos `Bundle`。
- YZForge 的运行时核心不是单例，而是 `Handle`。
- 任何需要跨模块复用的细粒度能力，都应该抽成 `Library`，而不是让模块互相 import。
- 任何会污染核心的能力，例如音频、存档、网络、平台、热更，都应该以 `Extension` 进入。
