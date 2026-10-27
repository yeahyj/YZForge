# YZForge 协作入口

这是在 PinK 中开发的 Cocos 项目。命令入口与当前能力边界见 [PinK 工作流](docs/pink-workflow.md)。先按任务查阅下列入口，再沿类型定义和现有实现确认契约。

新会话或示例已清理的项目先读 [AI 上手与交付](docs/ai-onboarding.md)。旧 Creator 工作台文档只供理解历史实现；操作与验证以 PinK 工作流为准。

| 任务                                               | 入口                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 模块职责、依赖边界、源文件与生成物归属             | [架构](docs/architecture.md)                                                                                                                                                                                                                     |
| Service、ViewModel、Page / Part、Command、使用期限 | [开发工作流](docs/development-workflow.md)、[API 指南](docs/api-guide.md)                                                                                                                                                                        |
| 可运行的页面组合与交互适配                         | [WorkflowPage](assets/game/modules/workshop/code/ui/workflow-page/WorkflowPage.ts)、[workflow](assets/game/modules/workshop/code/presentation/workflow.ts)、[ViewModel](assets/game/modules/workshop/code/presentation/WorkflowPageViewModel.ts) |
| 工具命令、格式、结构化诊断                         | [开发环境](docs/development.md)                                                                                                                                                                                                                  |
| 编辑器、预览、构建与验证范围                       | [实现范围与验证](docs/implementation-status.md)                                                                                                                                                                                                  |

## 修改入口

- 业务代码放在所属模块，跨模块通过 `public.ts`；具体规则以架构文档和现有检查器为准。
- 使用 `npm run yz -- help` 查询命令。创建通过现有 `operations/` 的计划与执行器，不另造模板流程。源命令已支持 Service、ViewModel、组件脚本和纯代码模块；原生创建与绑定先检查实际能力。
- 修改手写源声明后使用 `npm run generate` 更新产物。`generated/`、模块 `public.ts` 与资源索引由生成器维护；资源身份和生成归属状态必须保留。完整清单见架构文档。
- 不调用旧 Creator MCP，也不启动 Creator 帮助 PinK 更新。场景、Prefab、元数据和资源移动使用已验证的 PinK/Cocos CLI 直接接口，保留 UUID 并读回。能力缺失时明确报告，不能改写序列化文件来绕过；旧 Funplay 技能不适用于当前工作流。
- 生命周期、调用 owner、交互 context 和业务依赖应显式可查；调整便捷写法前先核对取消、导航挂起、复用与清理行为。会话模型和当前显示的交互适配见上述示例。

## 验证与排错

- 工具或框架代码修改后运行相关测试及 `npm run verify`；示例业务改变时另运行 `npm run test:showcase`。纯文档修改检查链接、示例与格式即可。
- 完整检查需要与目标引擎匹配的类型声明；现存 `temp` 不证明 PinK 兼容。涉及引擎注册、序列化、界面或运行时行为时必须进行 PinK 验证，旧 MCP 集成脚本不可作为替代。
- `check` / `generate` 的 JSON 诊断协议见开发环境文档。优先根据 `code` 和可用的 `file` / `line` / `column` 定位；没有位置时阅读 `message`，不要猜测。修复源文件后重新执行原检查。
- 运行时持有、任务与清理问题先使用现有 `app.inspect()`、`Scope.inspect()` 和 `UIManager.inspect()`；业务上下文使用 `ctx.diagnostics.snapshot()`。具体范围见 API 指南。
- 交付时说明改动、执行的检查及尚未验证的环境，不把静态检查通过当作引擎或真机验证。
