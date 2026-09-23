# 复制项目与清理示例

本项目直接作为新项目模板使用。复制源码、安装依赖、打开 Creator，再替换业务入口即可；没有额外的框架安装或初始化步骤。示例可以保留学习，也可以通过工作台清理。

## 1. 复制哪些内容

先保存项目，等待导入和工作台生成完成。复制到一个新的目录，不覆盖已有项目。

| 内容                                                            | 用途                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `assets/` 及所有配套 `.meta`                                    | 框架、启动场景、示例和稳定资源 UUID                       |
| `extensions/yzforge-editor/`、`tools/yzforge/`                  | 工作台、生成器、构建检查，两者需要一起保留                |
| `config-source/`                                                | XLSX 源表和旧表映射；仅复制导出 JSON 会丢失可编辑来源     |
| `project-settings/`，包括 `generated/`                          | 框架参数、资源逻辑身份、生成文件所有权、已验证的公式结果  |
| `settings/`、`.creator/`                                        | Creator 项目设置、代码/资源 Bundle 两份预设和默认导入设置 |
| `package.json`、`package-lock.json`、`tsconfig*.json`           | 项目身份、固定依赖和类型检查                              |
| `.vscode/`、`.editorconfig`、ESLint/Prettier 配置、`.gitignore` | 编辑器协作、格式和检查规则                                |
| `README.md`、`docs/`、`tests/`                                  | 使用说明和框架回归验证                                    |

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

**完整复制为独立项目时保留 `.meta`。** 不要批量重新生成资源 UUID，也不要清空 `project-settings/generated`。这些文件维护已有资源引用和稳定的逻辑 Key。项目内部复制单个资源则通过 Creator 操作，由编辑器分配新 UUID。

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

## 3. 清理示例，得到空框架

示例边界是 `showcase`、`workshop`、`lobby`、`profile`、`common` 五个模块及其 XLSX 源表，以及启动入口中的首屏调用。它们各自的职责见 [示例应用说明](example-app.md)。建议在新副本执行以下步骤。

1. 将 `assets/game/app/start-game.ts` 替换为下面的空入口，移除所有示例导入。
2. 等待脚本导入完成。在工作台“删除与恢复”中，依次预览并删除 `showcase`、`workshop`、`lobby`、`profile`、`common`。每次处理引用提示，确认备份成功；不要跳过检查强删目录。
3. 模块删除会停用关联 XLSX 导出，并保留源表。确认这些表没有自己的新增数据后，将 `config-source/showcase/`、`config-source/workshop/`、`config-source/lobby/`、`config-source/common/` 移到项目外归档，或删除。不要只改文件夹名字留在 `config-source` 内，该目录会递归扫描。
4. 保留根目录的 `config-source/tables.json`。模板里它的 `tables` 为空；自行接入过旧表时，也要处理其中的引用。
5. 工作台执行“生成清单与配置”和“检查”，确认模块、资源、配置路由已经收敛。生成的主包装配会变成空列表；资源身份记录中的停用项保留即可。
6. 打开 `assets/game/boot/Bootstrap.scene` 预览。没有业务页面时应显示“YZForge / 启动完成”，控制台打印 `Bootstrap ready`。
7. 在项目根目录运行 `npm run verify`。

空入口：

```ts
import type { App } from '../../framework/core/app';
import type { BootContext } from '../../framework/core/boot';

/** 项目的启动接入点；创建自己的模块和首屏后在这里接入。 */
export function startGame(_app: App, _boot: BootContext): void {}
```

保留 `assets/framework`、`assets/game/boot`、`assets/game/app` 以及对应 `.meta`。`GameRoot` 负责框架装配和启动状态；`start-game.ts` 是手写的启动接入点，`app/generated` 继续由工具维护。自己的业务写在模块中，跨模块协调也归属具体的业务模块。

工作台备份位于**副本自己的** `.yzforge/trash`。恢复示例时先按依赖恢复 `profile`、`common`，再恢复 `lobby`、`workshop` 和 `showcase`，最后接回 `start-game.ts` 的首屏调用。已移到项目外的 XLSX 也需要归还到原路径。工作台会检查当前文件冲突，不应覆盖后续业务修改。

`tests/examples/` 是可选的示例业务测试，可随示例一起归档；`npm run test:showcase` 需要示例存在。通用 `npm run verify` 不导入这些业务文件。工作台的“示例工作流”源码阅读在示例移除后会提示文件不存在，不影响创建、配置、绑定和恢复。

## 4. 开始自己的业务

1. 工作台创建模块，按需选择随应用加载或按需代码；只有配置/资源时使用纯资源模块。
2. 创建 Page、Part、Service 或 XLSX，确认文件预览；预制体通过 Creator 编辑，命名节点通过工作台自动绑定。
3. 在 `start-game.ts` 导入新模块公开的 `ViewKey`，用 `app.ui.pushPage(页面Key, 参数, boot.scope)` 打开首屏。后续页面通过 `show.ui` 跳转；需要多步业务协调时放在所属模块，通过公开 API 调用依赖。
4. 保存 `Bootstrap/GameRoot/GameSettings` 的四项选择，从 **YZForge → 游戏设置 → 导出构建参数** 导出并导入 Creator 构建面板，使用 `Bootstrap.scene` 启动。补齐目标平台参数；切换配置后重新导出，避免沿用旧任务。

通用框架的模块、Scope、UI、音频、资源、配置和时间 API 见 [API 使用指南](api-guide.md)。示例清理后 `npm run verify` 仍应通过；专门操作大厅按钮的集成测试依赖示例，不属于空项目的运行要求。

## 验证副本

以下命令在**副本根目录**运行，MCP 必须连接该副本的 Creator。先按 [游戏设置与 SDK](game-settings-sdk.md#构建与预览模拟) 构建 Web 产物，再启动静态服务并使用 `verify-template.mjs` 检查启动、空装配、应用标识和关闭清理。脚本创建的测试窗口结束时销毁，静态服务使用完后手动停止；其他入口见 [实现范围与验证](implementation-status.md)。

```powershell
node tests/integration/serve-build.mjs build/template-web
# 使用服务输出的实际 URL；另一个终端运行，第二个参数填副本设置的 appId。
node tests/integration/verify-template.mjs "http://127.0.0.1:实际端口/" "com.studio.my-game"
```

需要命令行构建时，用 `--project` 指向副本，在 `--build` 参数中通过 `configPath` 传入导出的配置文件。Creator 的构建成功退出码为 **36**，参数无效为 32，构建失败为 34；执行方式见 [Creator 3.8 命令行发布文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html)。
