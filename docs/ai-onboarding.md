# AI 上手与交付

这份指南适用于新会话和已经清理示例的项目。它提供工作顺序，不替代类型定义、实际实现与任务所需的功能文档；涉及操作能力时以 [PinK 工作流](pink-workflow.md) 为准。

## 先确认项目状态

1. 阅读根目录 [AGENTS.md](../AGENTS.md)、[架构](architecture.md) 和任务对应文档，检查工作区已有改动，保留用户的工作。
2. 查看 `assets/game/app/start-game.ts`、`assets/game/modules/` 和模块声明，确认实际首屏、现有模块与依赖。当前仓库包含五个示例模块，不能假设它已经是空项目；示例清理后，引用示例源码和数据的文档、测试不再自动适用。
3. 确认 Node 版本与 `package.json` 要求一致，按需运行 `npm ci`。使用 `npm run yz -- help` 查询命令；用 `npm run yz -- doctor` 检查项目及本机引擎缓存，阅读 warning 和各项状态。成功不代表活服务、预览或运行时已验证。
4. 有 UI 或资源任务时，确认当前 PinK 项目、目标引擎及可用的直接接口。保留 `.meta`、资源 UUID、`project-settings/state` 和生成归属；不通过手改场景、Prefab 或元数据绕过缺失能力。

## 按任务实施

- 先确认业务归属与依赖，业务代码放在所属模块，跨模块只使用生成的 `public.ts` 及公开合同。职责和生命周期见 [架构](architecture.md)、[API 指南](api-guide.md)。有示例时可参考 [开发工作流](development-workflow.md) 的实现；没有示例时直接查框架类型和当前业务代码。
- Service、ViewModel、普通组件脚本、eager 纯代码模块，以及已有业务资源包的配置表源文件，可使用 `npm run yz -- create plan ...` 预览，再使用返回的签名执行 `create apply`。参数、事务和能力限制见 [PinK 工作流](pink-workflow.md)。不要假定源码创建也完成了引擎导入和类注册。
- 页面、Part、Prefab 创建、自动绑定、资源包配置和主项目构建任务管理尚未接通已验证的 PinK 直接接口。先检查实际能力；缺失时完成不依赖它的工作并报告阻塞，不调用旧 Creator MCP 或自行改写序列化文件。现有示例绑定文件也不能证明新绑定流程可用。
- 手写源声明或配置变化后运行 `npm run generate`，不要手改 `generated/`、生成的模块 `public.ts` 或资源索引。启动选择在 `project-settings/game-config.json`；`config set` 后需重新生成和检查。
- 本仓库的旧示例清理流程依赖 Creator 工作台，当前没有经过验证的 PinK 完整清理流程。不要强删资源来制造空项目；需要空项目时先取得可验证的原生引用检查、删除和读回能力。

## 验证与交付

源码或框架工具变更运行相关测试及 `npm run verify`；改变仍存在的示例业务时另运行 `npm run test:showcase`。纯文档变更检查链接、示例和格式。完整类型检查需要目标引擎生成的匹配声明；界面、序列化、引擎注册和运行时行为还需要实际 PinK 验证。目标平台构建和真机验证分别记录，不能用静态检查或历史验收代替。

交付时说明修改、实际运行的检查和结果、使用的环境，以及未验证的部分。诊断优先按代码和位置定位，修复后重跑原检查；生命周期和持有问题可用 `app.inspect()`、`Scope.inspect()`、`UIManager.inspect()` 和 `ctx.diagnostics.snapshot()` 辅助排查。
