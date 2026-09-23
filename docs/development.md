# 开发环境与代码规范

适用于本仓库及其项目副本。Creator 3.8.8；Node.js 22.13+（22.x）或 24+。代码质量工具属于开发依赖，不进入游戏运行包；版本要求以 [package.json](../package.json) 为准。

## 安装

用 VS Code 打开项目根目录，执行 `npm ci`，并安装工作区推荐的插件：

- ESLint：`dbaeumer.vscode-eslint`。
- Prettier：`esbenp.prettier-vscode`。

工作区使用 Prettier 格式化，ESLint 通过保存时 Code Action 修复代码问题。设置保留在项目内。

ESLint、TypeScript ESLint、Prettier 及配套依赖使用精确版本和 package-lock，CLI 与编辑器共享本地依赖。ESLint 使用 flat config；eslint-config-prettier 关闭与 Prettier 冲突的格式规则。项目规则见 [eslint.config.mjs](../eslint.config.mjs) 和 [.prettierrc.json](../.prettierrc.json)。

## 格式与检查规则

| 项目                                | 规则                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| TypeScript / JavaScript / MJS / CJS | 4 个空格，不使用 Tab                                                                                        |
| JSON / Markdown / YAML              | 2 个空格                                                                                                    |
| 字符串与语句                        | 单引号、分号、可用位置保留尾逗号                                                                            |
| 箭头函数                            | 参数始终带括号                                                                                              |
| 行长度                              | 120 列软限制；不强行拆开长字符串                                                                            |
| 编码与换行                          | UTF-8、LF、文件末尾换行                                                                                     |
| 模板字符串                          | 不自动改写其中嵌入的 HTML/CSS/JS；避免影响 Creator 面板与 MCP 脚本                                          |
| 基础质量                            | ESLint / TypeScript ESLint 推荐规则；禁止 debugger 和 var，优先 const，严格相等比较（允许有意的 null 检查） |
| 未使用代码                          | 报错；有意保留的未使用参数或变量用 `_` 前缀                                                                 |
| 运行时异步                          | 启用类型感知的未处理 Promise、错误 Promise 回调、无效 await 检查                                            |
| 测试夹具                            | 仅 tests 下允许显式 any，以构造残缺上下文或错误输入；运行时代码仍检查                                       |
| 编辑器环境                          | Node 工具、Creator 主进程/场景进程、面板分别声明全局变量                                                    |

异步工作应 await，或明确使用 `void operation().catch(reportError)`。仅写 void 不会处理失败。引擎生命周期与框架依赖方向仍由 `npm run check` 检查，ESLint 不替代这些架构规则。

`.prettierrc.json` 是格式规则来源，`.editorconfig` 为其他编辑器提供相同基础规则。工作台新建模块、UI、普通脚本、Binding，以及 CLI 生成的 TS 都调用同一份 Prettier 配置；生成器先格式化再比较内容和计算文件摘要，重复生成不会因缩进反复产生差异。

`.prettierignore` 和 ESLint 排除 Creator 缓存、构建输出、第三方依赖及生成产物。生成 TS 由生成流程格式化，生成 JSON 保持生成器规定的输出；命令行批量格式化不会重写 scene、prefab、meta 或生成数据。VS Code 将这些引擎资产与生成文件标为只读，日常通过 Creator 或工作台修改。

## VS Code 工作区

[工作区设置](../.vscode/settings.json) 使用以下 TypeScript 配置：

```json
{
  "js/ts.tsdk.path": "node_modules/typescript/lib",
  "js/ts.tsdk.promptToUseWorkspaceVersion": true,
  "js/ts.preferences.importModuleSpecifier": "relative",
  "js/ts.preferences.preferTypeOnlyAutoImports": true,
  "js/ts.preferences.quoteStyle": "single",
  "js/ts.updateImportsOnFileMove.enabled": "prompt"
}
```

第一次打开项目时，按提示选择工作区 TypeScript。较旧的 VS Code 如不识别 `js/ts` 设置，应升级编辑器。

项目根 [tsconfig.json](../tsconfig.json) 显式使用 `moduleResolution: "bundler"`，其余基础设置继承 Creator 生成的 `temp/tsconfig.cocos.json`。项目覆盖项维护在根配置中，不修改 `temp` 内文件；命令行与编辑器都使用工作区编译器。

如果修改配置后仍显示旧诊断，执行命令面板中的“TypeScript: Restart TS Server”；需要切换编译器时，打开 TS 文件，执行“TypeScript: Select TypeScript Version”并选择工作区版本。

工作区同时配置了：

- 手动保存时格式化和 ESLint 修复；关闭自动保存以避免频繁触发 Creator 导入。
- 不在保存时自动整理导入，保留 Cocos 脚本的明确导入意图；移动脚本时提示是否更新导入。
- 隐藏 meta 与大型缓存，排除缓存/构建目录的全文搜索与文件监听，保持源码和声明导航可用。
- 推荐插件与公共任务随项目提交；其他个人 VS Code 文件继续忽略。

资源移动仍使用 Creator/工作台以保留 UUID，不能因为 VS Code 能更新 TS 导入就用它直接搬动场景资产。

## 常用命令与快捷入口

| 命令                  | 用途                                              |
| --------------------- | ------------------------------------------------- |
| npm run lint          | ESLint 检查，错误或警告均返回失败                 |
| npm run lint:fix      | 自动修复能够安全修复的问题；其余问题仍需处理      |
| npm run format        | 格式化受管理的手写代码与文本                      |
| npm run format:check  | 检查格式，不修改文件                              |
| npm run typecheck     | 游戏/框架脚本及类型合同两套 TypeScript 检查       |
| npm run check         | 生命周期/模块/生成产物一致性检查                  |
| npm run generate      | 生成目录、配置与类型；需回收旧文件时使用工作台    |
| npm test              | 自动化测试                                        |
| npm run test:showcase | 单独运行示例业务测试，需要保留示例模块            |
| npm run verify        | 依次执行 ESLint、格式、类型、框架检查与自动化测试 |

**Ctrl+Shift+B** 调用完整检查；“终端 → 运行任务”可单独格式化、修复、导出或测试。脚本错误会进入 VS Code 的问题列表。

**F5** 选择“YZForge: 调试 Creator 浏览器预览”：先在 Creator 启动浏览器预览，再粘贴完整 URL。URL 在启动时输入，未写死本机端口或项目哈希。使用 VS Code 内置 Edge 调试器；此入口不会自动启动 Creator，也不用于微信/原生真机调试。

完整检查依赖 Creator 已生成 temp 中的 Cocos 类型声明。新检出项目先用 Creator 打开并等待导入完成，再运行检查。编辑器、浏览器集成脚本和平台验证范围见 [实现范围与验证](implementation-status.md)。
