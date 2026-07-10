# YZForge 文档

这里放 YZForge 的公开手册、任务指南、架构说明和设计记录。

如果你是第一次接触这个项目，按这个顺序读：

1. [快速上手](./getting-started.md)
2. [创建项目](./manual/create-project.md)
3. [框架使用手册](./manual/framework.md)
4. [框架升级](./manual/framework-upgrade.md)
5. [配置表使用手册](./manual/config-table.md)
6. [UI 与 Prefab 流程](./manual/ui.md)
7. [本地存储](./manual/storage.md)
8. [时间与刷新周期](./manual/clock.md)

日常开发可以优先使用 Cocos 顶部菜单里的 `YZForge` 插件；提交前、CI 和 AI 批处理再使用文档里的 CLI 命令。

## 使用手册

面向日常开发，回答“我要做功能，该怎么写”。

| 文档 | 内容 |
| --- | --- |
| [创建项目](./manual/create-project.md) | `create-yzforge` 创建器、npm/npx 入口和开发期本地创建方式 |
| [框架使用手册](./manual/framework.md) | 项目结构、Module、Library、ContentPack、资源、本地存储和校验 |
| [框架升级](./manual/framework-upgrade.md) | 版本锁、迁移脚本、插件升级和 CLI 升级流程 |
| [配置表使用手册](./manual/config-table.md) | Excel 表头、面板流程、CLI、生成 JSON 和 TS 读取方式 |
| [UI 与 Prefab 流程](./manual/ui.md) | View、Part、Prefab、AutoRefs 和 UI 打开流程 |
| [本地存储](./manual/storage.md) | `save` / `settings` / `cache` 三分区和 key 规则 |
| [时间与刷新周期](./manual/clock.md) | 服务端时间偏移、跨天 / 跨周 / 跨月和倒计时 |
| [AI 开发手册](./manual/ai-development.md) | 使用 AI 辅助开发时的上下文、边界和收尾检查 |

## 任务指南

更细的操作型文档放在 [dev/](./dev/README.md)：

- 创建 Module。
- 创建 Library。
- 创建 View / Part。
- 资源和配置。
- 生成文件。
- 校验和构建。
- 常见问题。
- 发布前检查。

## 架构说明

设计背景和边界说明放在 [architecture/](./architecture/README.md)。

这些文档不要求新用户先读，但适合用来理解 YZForge 为什么坚持 `Scope / Contract / Bundle / Handle`。

## RFC 与设计记录

重构记录、迁移计划、验收标准和审计记录放在 [rfc/](./rfc/README.md)。

这些是设计决策记录，不是上手必读内容。
