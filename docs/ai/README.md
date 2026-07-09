# AI 开发手册

这组文档只写 AI 开发时最容易用错的工作流。日常开发先看 `docs/manual/`，设计背景看 `docs/architecture/`。

## 开始前

1. 运行 `npm run yzforge:ai:context`。
2. 读取 `.yzforge/ai-context.json` 和 `.yzforge/ai-summary.md`。
3. 选择下面最接近的任务手册。

## 任务

| 任务 | 文档 |
| --- | --- |
| 新增模块、库、内容包 | `docs/ai/01-create-scope.md` |
| 新增 View 或 UI Part | `docs/ai/02-create-ui.md` |
| 新增或修改配置表 | `docs/ai/03-config-table.md` |
| 修复校验错误 | `docs/ai/04-fix-validation.md` |
| 收尾检查 | `docs/ai/05-finish-checklist.md` |

## 不能做

- 不手改 generated。
- 不手写动态资源路径。
- 不绕过 YZForge 创建命令。
- 不把配置表 JSON 当源文件改。
- 不用自由命名覆盖框架推导出来的行类型和主键。

## 收尾

完成后至少运行：

```bash
npm run yzforge:ai:doctor
```

如果 doctor 失败，先按 `recommendations` 修复，再继续。
