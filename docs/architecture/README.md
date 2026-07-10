# 架构说明（V2）

这里描述当前唯一有效的 YZForge 架构。V2 是破坏性重构，不存在旧 Handle API、双轨 ContentPack ref 或公开 Kernel controller 的兼容层。

设计合同与验收标准分别见：

- [V2 终局架构契约](../rfc/v2-terminal-architecture.md)
- [V2 验收标准](../rfc/v2-acceptance.md)

## 推荐阅读顺序

1. [00. 概览](./00-overview.md)
2. [01. 项目结构](./01-project-structure.md)
3. [02. Scope / Contract / Bundle / Lease](./02-scope-contract-bundle-handle.md)
4. [03. 运行时与生命周期](./03-runtime-lifecycle.md)
5. [04. 资源、配置与 ContentPack](./04-assets-config-contentpacks.md)
6. [05. UI 与 AutoRefs](./05-ui-autorefs.md)
7. [06. Editor 与 Validator](./06-editor-validator.md)
8. [07. V2 API 示例](./07-api-examples.md)
9. [09. 运行流程](./09-runtime-walkthrough.md)
10. [10. 跨游戏基础能力](./10-cross-game-foundation.md)

`08-roadmap.md` 和 `docs/rfc/redesign-*` 是历史设计记录；当其内容与 V2 合同冲突时，以 V2 为准。

## 核心结论

- `Scope` 决定代码、资源、配置和依赖归谁所有。
- `Contract` 是动态 Scope 加载前可见的身份与类型边界。
- `Bundle` 只表示 Cocos 物理资源容器，不表示业务所有权，也不承诺脚本卸载。
- `Lease` 表示某次独立持有；每次 acquire 都有唯一 lease id，并且幂等释放。
- `OwnerIdentity.id + generation` 是所有权身份；可读 path 只用于诊断。
- `yzforge` 是业务稳定面，`yzforge/authoring` 只供生成代码使用。
