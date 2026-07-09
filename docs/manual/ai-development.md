# AI 开发手册

YZForge 可以配合 AI 辅助开发，但必须让 AI 先读取框架上下文，并遵守生成文件、Scope 边界和校验流程。

## 开始前

先运行：

```bash
npm run yzforge:ai:context
```

然后让 AI 读取：

```text
.yzforge/ai-context.json
.yzforge/ai-summary.md
docs/ai/README.md
```

## 常用任务手册

| 任务 | 文档 |
| --- | --- |
| 新增模块、Library、ContentPack | [docs/ai/01-create-scope.md](../ai/01-create-scope.md) |
| 新增 View 或 UI Part | [docs/ai/02-create-ui.md](../ai/02-create-ui.md) |
| 新增或修改配置表 | [docs/ai/03-config-table.md](../ai/03-config-table.md) |
| 修复校验错误 | [docs/ai/04-fix-validation.md](../ai/04-fix-validation.md) |
| 收尾检查 | [docs/ai/05-finish-checklist.md](../ai/05-finish-checklist.md) |

## AI 必须遵守

- 不手改 `code/generated/*`。
- 不手写动态资源路径。
- 不跨 Scope import 私有实现。
- 不把配置表 JSON 当源文件改。
- 不直接操作 `sys.localStorage` 或 `window.localStorage`。
- 时间、跨天、倒计时使用 `app.clock`。
- 本地存档、设置、缓存使用 `app.storage.save/settings/cache`。
- 修改框架、生成器、校验器或 runtime 模板后，必须跑 smoke。

## 收尾命令

普通业务改动：

```bash
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run typecheck
```

配置表改动：

```bash
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
```

框架或工具改动：

```bash
npm run yzforge:generate:check
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
npm run yzforge:ai:doctor
```
