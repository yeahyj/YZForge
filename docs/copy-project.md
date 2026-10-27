# 复制项目与清理示例

> **当前 PinK 限制：** 下文的 Creator 3.8、工作台删除/恢复、MCP 和空项目验收步骤为历史流程，不能用于当前项目。PinK 尚无经过验证的完整示例删除与资源引用检查流程，因此不要照此强删模块或改写资产。复制时保留资源 UUID、生成归属与状态，按 [PinK 工作流](pink-workflow.md) 验证；需要真正的空项目时先解决原生删除和读回能力。下文的标识设置也需结合当前配置核对，启动选择以 `project-settings/game-config.json` 为准。

本项目直接作为新项目模板使用。复制源码、安装依赖、打开 Creator，再替换业务入口即可；没有额外的框架安装或初始化步骤。示例可以保留学习，也可以通过工作台清理。

## 1. 复制哪些内容

先保存项目，等待导入和工作台生成完成。复制到一个新的目录，不覆盖已有项目。

| 内容                                                                              | 用途                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `assets/` 及所有配套 `.meta`                                                      | 框架、启动场景、示例和稳定资源 UUID                       |
| `extensions/yzforge-editor/`、`tools/yzforge/`                                    | 工作台、生成器、构建检查，两者需要一起保留                |
| `config-source/`                                                                  | XLSX 源表；仅复制导出 JSON 会丢失可编辑来源               |
| `project-settings/`，包括 `state/`、`snapshots/` 和 `generated/`                  | 框架参数、资源逻辑身份、生成文件所有权、已验证的公式结果  |
| `settings/`、`.creator/`                                                          | Creator 项目设置、代码/资源 Bundle 两份预设和默认导入设置 |
| `package.json`、`package-lock.json`、`tsconfig*.json`                             | 项目身份、固定依赖和类型检查                              |
| `.vscode/`、`.editorconfig`、`.gitattributes`、ESLint/Prettier 配置、`.gitignore` | 编辑器协作、换行、格式和检查规则                          |
| `AGENTS.md`、`README.md`、`docs/`、`tests/`                                       | AI 协作入口、使用说明和框架回归验证                       |
| `.github/workflows/`                                                              | Windows、macOS、Linux 的 Node 自动验证与报告上传          |

当前模板复制时排除：

```text
.git/                 # 在副本建立自己的提交历史
node_modules/         # 用 npm ci 重建
library/ temp/ local/ # Creator 缓存和本机数据
build/ profiles/      # 构建产物、个人布局和上一次构建任务
.yzforge/             # 本项目的删除备份、事务恢复和本地报告
coverage/ .idea/      # 本地工具产物
funplay-cocos-mcp.config.json  # 本机 MCP 端口、项目身份和客户端路径
```

`.agents/` 是可选的 AI 工具说明，不影响框架运行。MCP 仅用于辅助操作编辑器；需要时在副本连接对应的编辑器，由插件生成自己的连接配置。

当前模板没有手写原生工程；原生构建产物可以重建。若后续项目在 `native/` 中加入手写代码、SDK 或工程修改，应单独纳入版本管理和复制范围。项目自行增加的源码、平台配置、构建模板和扩展也需要一起保留。

**完整复制为独立项目时保留 `.meta`。** 不要批量重新生成资源 UUID，也不要清空 `project-settings/state`。持久状态维护已有资源的稳定逻辑 Key 和生成文件所有权；`snapshots/formulas` 保存已验证的公式结果。项目内部复制单个资源则通过 Creator 操作，由编辑器分配新 UUID。

## 2. 改哪些标识

在副本中安装依赖，并设置新项目身份。以下 PowerShell 命令在**副本根目录**运行：

```powershell
npm ci
npm pkg set name="my-game"
$projectUuid = [guid]::NewGuid().ToString()
npm pkg set "uuid=$projectUuid"
npm install --package-lock-only --ignore-scripts
```

`package.json.uuid` 是新项目身份；改变它不需要重写资产 UUID。以后常规安装仍使用 `npm ci`。

| 设置                                    | 修改位置                            | 说明                                                              |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| 项目名称、项目 UUID                     | `package.json`                      | 同步锁文件中的项目名称；通常保留框架和扩展的名称                  |
| 框架应用标识 `appId`                    | 工作台 → 项目设置                   | 例如 `com.studio.my-game`，影响本地存档命名空间；不要沿用示例标识 |
| 资源发布标识 `releaseId`                | `project-settings/framework.json`   | 修改后重新生成资源发布清单；与 GameSettings 的游戏版本分别维护    |
| 游戏版本、渠道、模式、服务环境          | Bootstrap → GameRoot → GameSettings | 保存场景后自动生成运行配置，构建前导出对应参数                    |
| 设计分辨率、适配方式、横竖屏            | Creator 项目/构建设置               | 启动脚本遵循 Creator 设置，不再强制写入演示分辨率                 |
| 平台 AppID、服务地址、广告位与 SDK 参数 | `project-settings/game-config.json` | 按渠道和环境配置；与框架 `appId` 分开，不能只改构建任务里的 AppID |
| 原生包名、签名及其他平台参数            | Creator 对应平台的构建设置          | 在导出的游戏构建参数基础上补齐                                    |
| 代码、资源交付策略                      | Creator → Bundle 预设               | 沿用两份 YZForge 预设，再按平台统一调整                           |

用 **Creator 3.8.8** 打开副本，等待首次导入完成，再检查项目扩展 `yzforge-editor` 是否启用。`tsconfig.json` 引用 Creator 生成的 `temp/tsconfig.cocos.json`，所以先导入，再执行完整类型检查。渠道与构建参数的完整流程见 [游戏设置与 SDK](game-settings-sdk.md)。

Git 检出或归档不包含空目录，但仍保留目录 `.meta`。工作台生成前会通过 AssetDB 补齐这类目录，并检查 UUID 与原元数据一致；不会补齐缺失的普通资产。`funplay-cocos-mcp.config.json` 不应提交或复制，副本使用自己的编辑器端口；脚本连接校验只读取项目身份，无需先打开场景。

## 3. 清理示例，得到空框架

示例边界是 `showcase`、`workshop`、`lobby`、`profile`、`common` 五个模块及其 XLSX 源表，以及启动入口中的首屏调用。它们各自的职责见 [示例应用说明](example-app.md)。建议在新副本执行以下步骤。

1. 将 `assets/game/app/start-game.ts` 替换为下面的空入口，移除所有示例导入。多语言路由由资源包声明自动生成，删除模块时工作台会停用对应语言工作簿，无需修改 GameRoot。
2. 等待脚本导入完成。在工作台“删除与恢复”中，依次预览并删除 `showcase`、`workshop`、`lobby`、`profile`、`common`。每次处理引用提示，确认备份成功；不要跳过检查强删目录。
3. 模块删除会停用关联 XLSX 导出，并保留源表。确认这些表没有自己的新增数据后，将 `config-source/showcase/`、`config-source/workshop/`、`config-source/lobby/`、`config-source/common/` 移到项目外归档，或删除。不要只改文件夹名字留在 `config-source` 内，该目录会递归扫描。
4. 工作台执行“重新生成”和“检查项目”，确认模块、资源、配置路由已经收敛。生成的主包装配会变成空列表；资源身份记录中的停用项保留即可。
5. 打开 `assets/game/boot/Bootstrap.scene` 预览。没有业务页面时应显示“YZForge / 启动完成”，控制台打印 `Bootstrap ready`。
6. 在项目根目录运行 `npm run verify`。

空入口：

```ts
import type { App } from '../../framework/app/app';
import type { BootContext } from '../../framework/app/boot';

/** 项目的启动接入点；创建自己的模块和首屏后在这里接入。 */
export function startGame(_app: App, _boot: BootContext): void {}
```

保留 `assets/framework`、`assets/game/boot`、`assets/game/app` 以及对应 `.meta`。`GameRoot` 负责框架装配和启动状态；`start-game.ts` 是手写的启动接入点，`app/generated` 继续由工具维护。自己的业务写在模块中，跨模块协调也归属具体的业务模块。

工作台备份位于**副本自己的** `.yzforge/trash`。恢复示例时先按依赖恢复 `profile`、`common`，再恢复 `lobby`、`workshop` 和 `showcase`，最后接回 `start-game.ts` 的首屏调用。已移到项目外的 XLSX 也需要归还到原路径。工作台会检查当前文件冲突，不应覆盖后续业务修改。

`tests/examples/` 是可选的示例业务测试，可随示例一起归档；`npm run test:showcase` 需要示例存在。通用 `npm run verify` 不导入这些业务文件。工作台的创建、配置、绑定和恢复功能不依赖示例模块。

`verify:node` 和 `verify:creator` 会运行仍在 `tests/examples/` 中的测试；清理示例时一并归档对应测试。Creator 集成组和运行时性能夹具也依赖具体示例，按 `test:integration -- --list` 的说明调整。预算文件随 `project-settings/` 复制；为新项目重新设定体积预算，并在目标环境记录自己的性能基线。

## 4. 开始自己的业务

1. 工作台创建模块，按需选择随应用加载或按需代码；只有配置/资源时使用纯资源模块。
2. 创建 Page、Part、Service 或 XLSX，确认文件预览；预制体通过 Creator 编辑，命名节点通过工作台自动绑定。
3. 在 `start-game.ts` 导入新模块公开的 `ViewKey`，用 `app.ui.pushPage(页面Key, 参数, boot.scope)` 打开首屏。后续页面通过 `show.ui` 跳转；需要多步业务协调时放在所属模块，通过公开 API 调用依赖。
4. 通过 `npm run yz -- config set` 修改 JSON 启动选择，生成并检查后用 `config build-options` 导出参数，使用 `Bootstrap.scene` 启动。当前 PinK 构建验收见 [PinK 工作流](pink-workflow.md)，不转调 Creator。

通用框架的模块、Scope、UI、音频、资源、配置和时间 API 见 [API 使用指南](api-guide.md)。示例清理后 `npm run verify` 仍应通过；专门操作大厅按钮的集成测试依赖示例，不属于空项目的运行要求。

## 验证副本

要重复验证“清空示例 → 从零创建业务 → 实际交互”的开发流程，先在框架根目录执行：

```powershell
node tests/integration/create-empty-trial.mjs
```

它在 `.yzforge/trials/empty-随机值/project` 创建全新的独立项目，保留资产 UUID，分配新的项目 UUID 和框架 appId，并记录源提交和工作区是否有修改。它复制 Git 跟踪文件及未忽略的新源文件，不复制 `temp`、`library`、依赖或本机 MCP 配置。

进入输出的副本目录运行 `npm ci`，用 Creator 3.8.8 打开该副本并等待首次导入完成。在 Funplay MCP 面板确认此副本的实际本地端口，保存该副本的 `funplay-cocos-mcp.config.json`（`host` 和 `port`）；不要沿用源工程的端口。然后在副本运行：

```powershell
node tests/integration/verify-empty-project.mjs
```

验收脚本先核对专用副本标记、项目 UUID、MCP 项目身份及初始模块清单，然后通过工作台删除示例、验证空启动，创建 `catalog` 模块、120 行配置表、Service、Page、Popup 和 Part。界面由 Creator 序列化，通过工作台绑定并读回根节点身份；最后执行与 `npm run verify` 相同的检查及真实预览交互，覆盖首尾条目、弹窗输入阻挡、三种视口和关闭清理。

主工程或无标记副本会被拒绝；运行过的副本不能重复执行整套创建流程，重跑请创建新副本。失败保留现场与阶段记录，不自动删除目录或覆盖后续修改。报告在副本 `.yzforge/empty-project-report.json`，检查日志在 `.yzforge/verification/`，截图在 `temp/mcp-captures/`。该流程验证 Creator 预览；发布包仍按下面的流程单独验收。

以下命令在**副本根目录**运行，MCP 必须连接该副本的 Creator。先按 [游戏设置与 SDK](game-settings-sdk.md#构建与预览模拟) 构建 Web 产物，再启动静态服务并使用 `verify-template.mjs` 检查启动、空装配、应用标识和关闭清理。脚本创建的测试窗口结束时销毁，静态服务使用完后手动停止；其他入口见 [实现范围与验证](implementation-status.md)。

```powershell
node tests/integration/serve-build.mjs build/template-web
# 使用服务输出的实际 URL；另一个终端运行，第二个参数填副本设置的 appId。
node tests/integration/verify-template.mjs "http://127.0.0.1:实际端口/" "com.studio.my-game"
```

需要命令行构建时，用 `--project` 指向副本，在 `--build` 参数中通过 `configPath` 传入导出的配置文件。Creator 的构建成功退出码为 **36**，参数无效为 32，构建失败为 34；执行方式见 [Creator 3.8 命令行发布文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html)。
