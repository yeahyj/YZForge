# YZForge

基于 Cocos 的通用游戏框架，面向小游戏、Web 和原生项目。当前在 **PinK** 中开发，通过命令维护配置、源码和生成物。原生编辑能力与验证边界见 [PinK 工作流](docs/pink-workflow.md)；旧 Creator 工作台不作为 PinK 的操作依赖。

本项目自带可运行的示例，可作为新项目的基础。当前 PinK 下尚无经过验证的完整示例清理流程，不能将本仓库视为已清空的模板。

AI 协作入口见 [AGENTS.md](AGENTS.md) 和 [AI 上手与交付](docs/ai-onboarding.md)，按任务查找契约、现有工具与验证命令。

## 功能

| 功能           | 说明                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| 模块与分包     | 组织业务模块，选择代码加载方式，管理模块依赖和 Cocos Bundle                                               |
| UI 管理        | Page、Popup、Overlay、Toast、Loading；页面导航、界面参数和返回结果                                        |
| 自动绑定       | 已有示例展示绑定结果；PinK 下新建绑定和写入引用的直接接口尚未接通                                         |
| 虚拟列表       | 纵向固定网格、变高列表、横向固定单行，支持 Part 复用、局部刷新和定位；见 [使用文档](docs/virtual-list.md) |
| 通用 UI 组件   | 安全区 Widget、原生按钮/图片扩展、倒计时、子节点切换、超宽滚动文本；见 [使用文档](docs/ui-components.md)  |
| 红点与数量     | 分组聚合、批量更新、页面/条目订阅清理；见 [使用文档](docs/badges.md)                                      |
| 游戏设置与 SDK | JSON 启动配置、渠道参数、构建校验、可组合 SDK；见 [使用文档](docs/game-settings-sdk.md)                   |
| HTTP 网络      | JSON 验证、超时、Scope 取消、XHR 与微信/抖音传输适配；见 [使用文档](docs/network.md)                      |
| 新手引导       | 检查点恢复、稳定目标、圆形与矩形连续聚焦；见 [使用文档](docs/guide.md)                                    |
| 资源管理       | 生成资源 Key、批量准备与进度、Prefab 实例池；见 [使用文档](docs/resources.md)                             |
| 多语言         | Bundle 语言目录、文案参数、默认语言回退和图片/字体/语音资源 Key；见 [使用文档](docs/localization.md)      |
| 配置表         | XLSX 导入、校验、枚举、外键、分片，导出 JSON 数据和 TypeScript 类型                                       |
| 音频           | 播放、音量分组、并发数量和播放生命周期管理                                                                |
| 时间           | 时间戳、日期格式化、服务器校时、日历周期和到期通知                                                        |
| 生命周期与通信 | Scope 管理任务、资源和订阅；模块 API、类型化事件、UI 参数与结果                                           |
| 本地存档       | 类型化读写、账号命名空间和备份恢复                                                                        |

## 快速开始

环境要求：

- **PinK**；引擎版本及当前验证范围见 [PinK 工作流](docs/pink-workflow.md)。
- **Node.js 22.x（22.13 及以上）或 24 及以上版本**。
- 在 PinK 打开项目根目录。

使用步骤：

1. 将项目复制到新目录，保留 `.meta` 和项目设置，排除缓存、构建产物及本机配置。参考[复制清单](docs/copy-project.md)，注意其中旧 Creator 操作不适用于当前 PinK 流程。
2. 在项目根目录执行 `npm ci`。
3. 用 PinK 打开项目，等待资源导入和脚本编译完成。
4. 执行 `npm run yz -- doctor`、`npm run generate` 和 `npm run verify`，确认类型声明对应实际目标引擎。
5. 打开 [Bootstrap.scene](assets/game/boot/Bootstrap.scene)，运行 PinK 预览。原生预览按钮不会自动执行上述框架检查。

预览首先进入“功能实验室”。建议先体验“正式业务流程 · 任务奖励”，对照 [示例工作流](docs/development-workflow.md) 中 Service、ViewModel、Page 和 Part 的真实代码。其他入口展示 UI、资源、配置、时间、音频、存档与失败恢复。

- [目录与依赖规则](docs/architecture.md)：模块布局、公开入口、文件所有权和工具职责。
- [正式开发工作流](docs/development-workflow.md)：从创建模块到业务、渲染、绑定和验证。
- [功能展示与验证入口](docs/showcase.md)：可交互示例、编辑器步骤和自动化验证。

启动接入点是 [start-game.ts](assets/game/app/start-game.ts)，在这里选择首屏。`GameRoot` 负责框架装配和启动状态显示，`app/generated` 由工作台生成。业务规则、状态、页面以及多步业务协调都放在所属模块的 `code` 中。页面通过 `show.ui` 打开其他界面和返回；单纯跳转不需要再写一个导航类。

游戏版本、渠道、构建模式、服务环境以及地址、公开 AppID、SDK 参数统一维护在 `project-settings/game-config.json`。`npm run yz -- config set` 修改启动选择，`GameSettings` 只读取生成快照。默认本地存档共用，切换这些选项不会建立新存档。

项目附带 `showcase`、`workshop`、`lobby`、`profile`、`common` 五个示例模块，展示功能实验、任务流程、界面交互、共享服务和公共配置。示例职责见 [示例应用说明](docs/example-app.md)，当前清理限制见 [复制项目](docs/copy-project.md)。

## 项目结构

```text
assets/
├─ framework/                    # 框架运行时
└─ game/
   ├─ boot/                      # Bootstrap 场景和 GameRoot
   ├─ app/                       # 启动接入与应用装配
   │  ├─ start-game.ts           # 选择首屏或接入业务流程
   │  └─ generated/              # 模块装配、资源路由和运行参数
   └─ modules/                   # 业务模块
extensions/yzforge-editor/        # Creator 工作台
config-source/                   # XLSX 源工作簿
project-settings/                # 参数、state/ 持久状态、snapshots/ 及 generated/
settings/                        # PinK 项目设置
tools/yzforge/                   # 生成、校验和构建工具
tests/                           # 自动化测试
docs/                            # 使用文档
```

包含代码与资源的模块通常使用以下结构；各类模块的实际创建能力见 [PinK 工作流](docs/pink-workflow.md)：

```text
assets/game/modules/inventory/
├─ module.json                   # 模块声明、依赖、资源包及界面登记
├─ public.ts                     # 全生成，唯一跨模块入口
├─ contracts/                    # 人工 api.ts、公开界面类型及 generated/ 合同
├─ code/
│  ├─ InventoryModule.ts         # 模块服务装配
│  ├─ ui/                        # 每个界面独立目录，按需含 ViewModel 与 generated/Binding
│  ├─ components/                # 每个 Part 或普通组件独立目录
│  ├─ services/                  # 业务服务
│  └─ generated/                 # 依赖引用和私有配置类型
└─ bundles/
   └─ default/                   # 一个资源 Bundle
      ├─ dynamic/                # 自动编目的动态资源
      ├─ static/                 # 通过编辑器引用使用的资源
      └─ yz-index.json           # 自动生成的动态资源索引
```

## 开发流程

### 创建模块

通过 `npm run yz -- create plan` 预览创建计划，再用返回的签名执行 `create apply`。当前支持 eager 纯代码模块；包含资源的模块和资源包需先确认已验证的 PinK 原生接口。完整范围和示例见 [PinK 工作流](docs/pink-workflow.md)。

代码可以随应用加载，也可以通过代码 Bundle 按需加载。**加载代码与初始化业务是两个阶段**：代码模块在首次使用其 API 或打开所属界面时初始化业务。现有按需模块的入口由生成器维护。

跨模块调用通过公开 API 或类型化事件完成。跨模块资源和配置使用公开的资源 Key、配置类型；模块内部实现放在自己的 `code` 目录。

### 创建界面与 Part

Page、Part、Prefab 创建和自动绑定尚未接通已验证的 PinK 直接接口。已有示例可帮助理解代码和绑定结果；缺少能力时报告限制，不使用旧 Creator MCP 或手改序列化文件。历史绑定规则见[自动绑定文档](docs/auto-binding.md)。

界面脚本负责渲染和输入；复杂的显示流程可以交给 ViewModel，多个界面共享的业务状态放在模块 Service。UI 之间通过打开参数、返回结果或事件通信。

继承框架基类的业务脚本使用 `onShow`、`onHide`、`onActivate`、`onTick` 等框架生命周期，保留引擎 `onLoad`、`start`、`update` 等入口给框架使用。

### 放置和加载资源

资源包根目录是 `bundles/default` 或其他命名的包目录，`dynamic` 和 `static` 都位于包内：

- 通过代码按需加载的资源放在 `dynamic`，工具自动生成资源清单和类型化 Key。
- 只通过场景或预制体序列化引用使用的资源放在 `static`。
- 动态 Part 放在 `dynamic/prefabs`；仅用于嵌套引用的 Part 放在 `static/prefabs`。

优先使用生成的 Key 加载资源，也支持当前命名空间内的路径或唯一短名；存在重名时会列出候选并报错。资源实际打包归属由 Bundle 配置和引擎引用规则共同决定。

资源包配置尚未接通已验证的 PinK 直接接口。资源和配置的加载用法见 [API 使用指南](docs/api-guide.md)。

### 制作配置表

已有业务资源包的 XLSX 源文件可通过创建计划建立。工作簿的 `__config` 页保存导出设置，`__enums` 页定义枚举；数据表前四行依次填写字段名、类型、默认值和说明。

支持整数、浮点数、布尔值、字符串、命名枚举、外键、资源引用、向量、颜色、数组及可空类型。导出结果包括目标包内的 JSON 数据，以及 TypeScript 类型、枚举和加载入口。

跨模块使用的表应公开其配置类型，调用方通过该类型加载数据，框架按发布路由定位资源包。公共配置可以归属项目选择的任意模块。

含公式的工作簿需要先重算再正式导出。当前公式重算使用 **Windows 桌面 Excel COM**；命令见 [PinK 工作流](docs/pink-workflow.md)，字段类型、枚举和分片见 [XLSX 配置表制作](docs/config-tables.md)。

### 管理使用期限与时间

`Scope` 表示任务、资源和订阅的使用期限。界面的 `show` 和 Part 的 `activation` 提供绑定当前期限的资源、配置、音频和时间 API；期限结束时由框架统一清理。异步结果通过对应上下文的 `commit` 更新界面。

时间 API 支持获取当前时间、格式化日期、服务器校时，以及按日、周、月、年通知。项目设置统一维护时区偏移、每周起始日和日切时间。自然周期变化使用 `onBoundary`；从现在起经过一段日历时间使用 `afterPeriod`；基于起点重复触发使用 `everyPeriod`。服务器校时需要接入项目自己的时间源，后台错过的周期在恢复前台时按接口规则处理。

完整参数、生命周期和调用示例见 [API 使用指南](docs/api-guide.md)，也可在 VS Code 悬停查看源码中文注释。

## 日常维护

使用 `npm run yz -- help` 查询命令，源声明变化后运行生成和检查。场景、预制体和资源移动只使用已验证的 PinK/Cocos CLI 直接接口，保留 UUID 并读回；能力不足时报告限制。保留 `.meta`、`project-settings/state` 和生成文件，保证资源引用、逻辑身份和生成记录一致。

## 常用命令

首次运行完整检查前，先用目标 PinK 引擎打开项目并等待导入完成，再通过 `doctor` 核对引擎声明来源。

| 命令                                      | 用途                                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| `npm ci`                                  | 按锁文件安装开发依赖                                   |
| `npm run verify`                          | 完整检查：代码、格式、类型、框架规则、生成一致性及测试 |
| `npm run lint` / `npm run lint:fix`       | ESLint 检查 / 自动修复                                 |
| `npm run format` / `npm run format:check` | 格式化 / 格式检查                                      |
| `npm run typecheck`                       | TypeScript 类型检查                                    |
| `npm run check`                           | 框架规则和生成产物一致性检查                           |
| `npm run generate`                        | 生成资源清单、配置和 TypeScript 文件                   |
| `npm test`                                | 运行自动化测试                                         |

脚本使用 **4 个空格**缩进，JSON 和 Markdown 使用 **2 个空格**。VS Code 保存时执行格式化与 ESLint 修复；**Ctrl+Shift+B** 运行完整检查。

构建前以 JSON 配置为准，生成并检查后使用 `config build-options` 导出参数。当前独立 Web 构建验收与主项目构建能力边界见 [PinK 工作流](docs/pink-workflow.md)。

## 文档

| 文档                                            | 内容                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| [复制项目与清理示例](docs/copy-project.md)      | 复制清单、项目标识、清理示例和接入自己的业务     |
| [开发环境与代码规范](docs/development.md)       | VS Code、ESLint、Prettier、类型检查和调试        |
| [正式开发工作流](docs/development-workflow.md)  | 从模块、Service、ViewModel 到 Page / Part        |
| [API 使用指南](docs/api-guide.md)               | 生命周期、资源、配置、UI、模块通信、时间和存档   |
| [XLSX 配置表制作](docs/config-tables.md)        | 字段、枚举、导出规则、分片、公式与生成物         |
| [自动绑定](docs/auto-binding.md)                | 节点命名、实际组件类型、生成和排错               |
| [通用 UI 组件](docs/ui-components.md)           | 安全区、异步按钮/图片、倒计时、Switch 和滚动文本 |
| [虚拟列表](docs/virtual-list.md)                | 横纵列表、变高条目、局部刷新、Part 复用与清理    |
| [批量资源与实例池](docs/resources.md)           | 资源准备、进度、取消与 Prefab 节点复用           |
| [多语言与语言包](docs/localization.md)          | 文案目录、资源映射、切换、回退和新增语言         |
| [红点与数量提示](docs/badges.md)                | 数量来源、分组聚合和 UI 订阅                     |
| [HTTP 请求与取消](docs/network.md)              | 请求、JSON 验证、错误及平台传输                  |
| [新手引导与连续聚焦](docs/guide.md)             | 目标注册、检查点、聚焦与输入控制                 |
| [游戏设置与 SDK](docs/game-settings-sdk.md)     | 版本、渠道、环境、SDK 组合和构建配置             |
| [示例应用说明](docs/example-app.md)             | 示例模块职责、依赖和清理边界                     |
| [功能展示与验证入口](docs/showcase.md)          | 可交互实验、工作台示例和业务验证                 |
| [实现范围与验证](docs/implementation-status.md) | 当前限制、集成脚本、构建审计与平台验收           |
