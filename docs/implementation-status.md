# 实现范围与验证

本文维护当前实现的边界与验证入口。使用方法从 [README 文档目录](../README.md#文档) 进入；检查是否通过，以目标版本当次执行的日志和产物为准。

## 能力边界

| 范围        | 当前约定与限制                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模块与资源  | 代码加载和业务初始化分开；模块持有归零后清理业务，不卸载已注册的 JavaScript。Bundle 输出、实际下载量和运行内存分别验证。                                 |
| 生命周期    | Scope 协作式取消并等待任务及清理完成，不能强制终止任意 Promise。UI 清理超时会隔离故障实例；任务仍需响应取消。                                            |
| 配置表      | XLSX 导出 JSON 和 TypeScript 合同，未实现二进制数据格式。公式重算仅提供 Windows 桌面 Excel COM 适配；复杂公式及外部工作簿联动需使用项目实际数据验收。    |
| 时间        | 固定 UTC 偏移，不支持 IANA 时区或夏令时。服务器时间源由项目注入；跨重启计划、补算和结算去重由业务保存。                                                  |
| HTTP 与 SDK | HTTP 支持 XHR、wx/tt 请求及自定义传输；不含 WebSocket、自动重连或令牌刷新。SDK 提供平台与渠道组合入口，发行商、真实登录和广告需项目接入。                |
| UI 组件     | 虚拟列表只支持固定尺寸纵向列表/网格。SafeWidget 和聚焦引导限同一正交 Canvas 的轴对齐布局；MarqueeLabel 为单行普通文本。详细限制见各组件文档。            |
| 制作恢复    | 创建、生成、删除和构建各有恢复流程；冲突会停止，不保证任意崩溃时刻自动恢复。包内移动可保持资源身份，跨包迁移和全项目重命名需要另行处理引用。             |
| 静态检查    | 可检查显式导入、序列化引用、已知逻辑名及配置引用；不能完整证明反射、字符串拼接和动态表达式的行为。                                                       |
| 交付审计    | 检查 Bundle/代码入口归属、未压缩输出字节、完整文件重复和体积预算；不分析图集/合并 JSON 内部的语义重复，不提供 CDN 发布、原生代码热更新或跨版本补丁系统。 |

微信、抖音及 Android/iOS 等目标平台需要分别验证开发者工具、发布构建与真机。浏览器预览和注入适配器测试不能证明后台恢复、音频权限、下载缓存、真实 SDK 或设备性能已通过验收。

## 命令行检查

先执行 `npm ci`，用 Creator 3.8.8 打开本项目并等待导入完成。`npm run typecheck` 依赖 Creator 生成的 `temp/tsconfig.cocos.json` 和引擎声明。

```powershell
npm run verify
npm run test:showcase
```

`verify` 依次检查 ESLint、格式、运行时/合同类型、框架规则、生成一致性和框架/工具测试。`test:showcase` 单独检查示例业务，移除示例后不再执行。测试脚本定义见 [package.json](../package.json)，环境设置见 [开发环境与代码规范](development.md)。

## Creator 与运行时检查

集成脚本使用项目根目录的本机 MCP 配置，并校验连接的 Creator 项目路径。先确认当前编辑器就是待测项目；复制项目后重新生成连接配置。只运行本次改动涉及的脚本。

| 入口（位于 `tests/integration/`）                                             | 前置条件与覆盖范围                                                                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [verify-workbench.mjs](../tests/integration/verify-workbench.mjs)             | Creator 与 MCP 已连接；创建临时模块，检查脚本、Part、绑定、XLSX、删除及恢复。成功后回收，失败保留现场；`--keep-for-build` 可保留夹具供构建检查。 |
| [verify-creation.mjs](../tests/integration/verify-creation.mjs)               | Creator 与 MCP 已连接；故障注入、后续修改冲突和创建撤销。                                                                                        |
| [verify-panel.mjs](../tests/integration/verify-panel.mjs)                     | 保留示例数据；检查真实工作台预览、草稿、设置及生成恢复。                                                                                         |
| [verify-showcase-editor.mjs](../tests/integration/verify-showcase-editor.mjs) | 保留 workshop 示例；检查步骤、源码阅读和跳转。                                                                                                   |
| [verify-preview.mjs](../tests/integration/verify-preview.mjs)                 | Bootstrap 已在 Game View 运行且保留大厅示例；检查 UI、结果与生命周期。                                                                           |
| [verify-build.mjs](../tests/integration/verify-build.mjs)                     | 保留大厅示例，用 `serve-build.mjs` 启动构建产物并传入 URL；可选第二个参数为工作台测试模块 ID，额外检查 Part 代码按需加载。                       |
| [verify-runtime.mjs](../tests/integration/verify-runtime.mjs)                 | 参数传入 Web 运行 URL，保留大厅示例；在独立窗口执行底层运行时回归。                                                                              |
| [verify-showcase.mjs](../tests/integration/verify-showcase.mjs)               | 参数传入 Web 运行 URL，保留全部示例；检查业务、导航、分包、持有回收及屏幕适配。                                                                  |
| [verify-virtual-list.mjs](../tests/integration/verify-virtual-list.mjs)       | 参数传入预览或 Web 运行 URL；检查列表窗口、复用、定位、Part 清理及尺寸变化。                                                                     |
| [verify-ui-components.mjs](../tests/integration/verify-ui-components.mjs)     | 参数传入预览或 Web 运行 URL；检查真实输入、原生组件、资源、计时和安全区。                                                                        |
| [verify-network-guide.mjs](../tests/integration/verify-network-guide.mjs)     | 参数传入预览或 Web 运行 URL；检查红点、真实本机 XHR、聚焦、输入、恢复与清理。                                                                    |
| [verify-game-settings.mjs](../tests/integration/verify-game-settings.mjs)     | 需两份指定配置的 Web 构建，步骤见 [游戏设置与 SDK](game-settings-sdk.md#验证)。                                                                  |
| [verify-template.mjs](../tests/integration/verify-template.mjs)               | 需已清空示例的独立副本构建，步骤见 [复制项目](copy-project.md#验证副本)。                                                                        |

传入的 URL 必须属于当前项目。浏览器集成脚本通过 MCP 创建测试窗口；手工启动的静态服务由启动者停止。工作台脚本会实际创建、删除或恢复自己的测试资产，不是只读检查。截图通常写入忽略目录 `temp/mcp-captures`，不作为可在新检出中直接查看的证据。

Web 构建检查示例：

```powershell
# 先构建到自己选择的目录；服务会输出实际 URL。
node tests/integration/serve-build.mjs build/web-mobile
# 另一个终端，将下列地址替换为服务输出的本机 URL。
node tests/integration/verify-runtime.mjs "http://127.0.0.1:实际端口/"
```

## 构建与结果判定

保存 `Bootstrap/GameRoot/GameSettings` 后导出构建参数，构建流程见 [游戏设置与 SDK](game-settings-sdk.md#构建与预览模拟)。构建钩子检查配置一致性、UI 类注册、模块边界和产物归属，报告写入 `.yzforge/build-reports`。已有构建还可单独审计：

```powershell
node tools/yzforge/cli.mjs audit-build --output build/web-mobile --platform web-mobile
```

[build-budgets.json](../project-settings/build-budgets.json) 按 `default` 与 `platforms` 合并预算；`maxTotalBytes`、`maxLocalRootBytes`、`maxDuplicateBytes` 单位均为字节，`null` 不限制。默认模板未设体积上限，审计通过不表示满足平台发行限制。完整同内容重复检查只统计至少 1 KiB 的文件。

记录结果时注明版本、命令、目标平台及实际运行环境。Creator 当前脚本诊断、实际预览、构建成功和真机运行是不同层次；历史日志和故障注入记录不能冒充本次结果。检查新增错误，并保留失败原因及尚未执行的目标。
