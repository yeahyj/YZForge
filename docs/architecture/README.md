# 架构说明

这些文档解释 YZForge 为什么这样设计。新用户不需要先读这里；当你想理解边界、生命周期、资源释放和生成器规则时，再看这些文档。

## 推荐阅读顺序

1. [00. 概览](./00-overview.md)
2. [01. 项目结构](./01-project-structure.md)
3. [02. Scope / Contract / Bundle / Handle](./02-scope-contract-bundle-handle.md)
4. [03. 运行时与生命周期](./03-runtime-lifecycle.md)
5. [04. 资源、配置与 ContentPack](./04-assets-config-contentpacks.md)
6. [05. UI 与 AutoRefs](./05-ui-autorefs.md)
7. [06. Editor 与 Validator](./06-editor-validator.md)
8. [07. API 示例](./07-api-examples.md)
9. [08. 路线图](./08-roadmap.md)
10. [09. 运行流程](./09-runtime-walkthrough.md)
11. [10. 跨游戏基础能力](./10-cross-game-foundation.md)

## 核心结论

- YZForge 的边界核心不是目录，而是 `Scope`。
- YZForge 的跨包核心不是 import，而是首包 `Contract`。
- YZForge 的加载核心不是业务类，而是 Cocos `Bundle`。
- YZForge 的运行时核心不是单例，而是 `Handle`。
- 业务代码应该使用生成入口，不应该跨 Scope import 私有实现。
