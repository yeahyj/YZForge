# 目录与依赖规则

目录由运行职责、代码交付边界和文件所有权决定。模块采用 `layoutVersion: 3`，生成器、工作台、绑定和恢复共用 `tools/yzforge/project/layout.cjs`；源声明不填写可从规则推导的路径。

## 框架运行时

| 目录                                                 | 职责                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `core/`                                              | Scope、取消、任务、错误、事件、日志等基础机制；不依赖 Cocos 或其他功能目录 |
| `app/`                                               | App 装配、启动、游戏配置和诊断入口                                         |
| `components/`                                        | GameComponent、宿主绑定协议、组件期限和服务接口                            |
| `modules/`                                           | 模块契约、代码准备、业务实例和依赖管理                                     |
| `assets/`                                            | 资源路由、持有、预制体实例与实例池                                         |
| `ui/`                                                | 页面管理、渲染组件和 `ui/localization/` 原生文字/图片绑定                  |
| `localization/`                                      | 语言目录、词条、资源键、切换事务；不放原生 UI 组件                         |
| `sdk/`、`storage/`、`time/`                          | 各自的功能实现及平台适配                                                   |
| `audio/`、`config/`、`network/`、`badges/`、`guide/` | 按功能组织的独立服务                                                       |

`app` 负责把上层服务接入组件上下文。组件基础设施只在运行时依赖 `core`、`components` 和引擎基础类；需要其他服务时声明类型接口，由 App 按每次激活的 Scope 提供。组件宿主按注册的绑定协议工作，无需识别具体 GameComponent 类。`AssetAccess`、`ConfigAccess`、`AudioAccess`、`TimeAccess`、`LocalizationAccess` 由能力所属目录维护，返回的包、表、实例池及语言目录也采用接口；具体实现显式实现合同。原生组件只需 `ComponentServicesHost`，业务组件继续获得完整模块上下文。

页面展示、组件激活、实例借用仍各自拥有生命周期。原生通用控件可以独立使用；接入模块后使用该次激活的资源、音频、配置、时间和多语言入口。目录调整不增加轮询或全局组件扫描。

`npm run check` 拒绝 core 越层依赖、组件基础设施加载上层实现、框架运行时循环及公开入口传递加载私有实现。类型依赖与值依赖分别检查。

## 业务模块

```text
assets/game/modules/shop/
├─ module.json                         人工声明：依赖、交付方式、资源包和界面
├─ public.ts                           全部生成，唯一跨模块入口
├─ contracts/
│  ├─ api.ts                           人工维护的 ShopApi、事件和业务数据类型
│  ├─ HomePage.types.ts                 公开界面的参数与结果
│  └─ generated/                       公开 ViewKey、资源键、语言键、配置类型
├─ code/
│  ├─ ShopModule.ts                    模块装配
│  ├─ services/                        业务规则和状态
│  ├─ ui/
│  │  └─ home-page/
│  │     ├─ HomePage.ts                 界面脚本
│  │     ├─ HomePagePresenter.ts        按需创建
│  │     └─ generated/HomePageBinding.ts
│  ├─ components/
│  │  └─ item-part/
│  │     ├─ ItemPart.ts
│  │     └─ generated/ItemPartBinding.ts
│  └─ generated/                       内部界面键、业务依赖与私有配置类型
├─ bundles/default/                    普通资源 Bundle
│  ├─ dynamic/                         自动编目的入口资源
│  ├─ static/                          仅通过静态引用使用的依赖
│  └─ yz-index.json                    生成索引
└─ localization/default/
   ├─ zh-CN/                           一个语言 Bundle
   └─ en/                              另一个语言 Bundle
      ├─ dynamic/images/logo.png
      ├─ static/
      ├─ yz-index.json
      └─ yz-locale.json
```

界面 ID 决定私有目录，类名决定文件名。内部界面的 `*.types.ts` 与脚本放在同一目录；公开界面的类型放在 `contracts/`，避免主包类型入口进入按需代码包。Presenter 与它服务的界面在一起，不设全模块 Presenter 文件夹。

跨模块的值导入、类型导入、转导出和静态动态导入全部经过对方 `public.ts`。`contracts/` 不能反向引用私有 `code/`；公开入口不能传递加载引擎组件或私有模块实现。应用生成装配只可直接加载 eager 模块工厂。读取资源或公开配置合同不要求启动模块业务实例。

`public.ts` 合并人工 `contracts/*.ts` 和本轮生成的公开合同，不手动修改。需要新增业务 API 或公共类型时修改 `contracts/api.ts`，或新建人工合同文件，然后生成。普通业务代码继续按需使用框架具体功能入口；不提供汇集全部运行时代码的大型 barrel。

纯资源模块使用 `code.mode: none`，没有 `code/`、模块工厂或 ModuleRef，但仍生成 `public.ts` 暴露资源和公开配置。配置表、枚举必须显式公开。包含业务代码的模块才在 `contracts/api.ts` 中提供对应的 `<Module>Api`。

`module.json` 不接受 `code.root`、`bundle.root`、界面或 Part 的 `script/binding/types/presenter/directory`。这些路径由规则派生；实际组件 UUID 和 ccclass 保持 Creator 身份。新增内容通过工作台创建，已有资产移动通过 AssetDB 保留 `.meta` 与 UUID。

## 源文件、持久状态和生成物

| 位置                                                       | 所有权与处理方式                                   |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `config-source/<module>/`                                  | 人工维护的 XLSX，含可选的语言文案表                |
| `project-settings/*.json`                                  | 人工维护的项目参数                                 |
| `project-settings/state/resource-identities.json`          | 资源 UUID 与稳定逻辑 ID 的持久映射；必须提交和复制 |
| `project-settings/state/generated-files.json`              | 生成器拥有的文件清单；必须提交和复制               |
| `project-settings/snapshots/formulas/`                     | 经过校验的公式结果；随源码保存，输入摘要失效后重算 |
| `project-settings/generated/`、各处 `generated/`、资源索引 | 可从输入重建的派生内容，生成器核对并清理过期文件   |
| `.yzforge/`                                                | 本机操作记录、恢复副本和报告；不作为发布或复制来源 |

既有项目缺少身份或所有权状态时，恢复版本库中的文件，生成器不会静默重新分配身份。`node tools/yzforge/cli.mjs init-state` 仅用于尚未生成过的新项目；复制当前模板无需初始化。

普通资源的逻辑 ID 跟随 UUID，同一资源包内移动仍保持 ID。语言资源的 Key 来自相对路径，工具同步各语言资源改名，再由类型与序列化引用检查报告待修复的旧 Key。工作台的“语言资源改名”提供预览、冲突检查、执行与恢复，详见[多语言](localization.md)。

## 编辑器与共享工具

`tools/yzforge/project/` 管项目模型与布局，`generators/` 生成纯文件结果，`validation/` 负责约束与构建审计，`operations/` 编排创建、删除、绑定、改名和恢复。`cli.mjs` 与 `mcp.mjs` 保留为入口。

`extensions/yzforge-editor/` 负责界面、AssetDB、场景操作和编译屏障。共享操作不直接引用 Editor 全局，通过适配器调用 Creator。场景、预制体、元数据只通过 Creator 执行并读回；脚本生成后等待类与绑定签名注册完成，再写入序列化引用。

创建预览由 `operations/create-scaffolds.cjs` 和 `create-plan.cjs` 生成具体步骤及脚本文本，存入本机计划；`execute-creation.cjs` 直接执行同一份计划，不重新解释模板。输入文件、元数据、目录及设计分辨率改变时必须重新预览。原生 UUID 作为前序步骤的结果传递，序列化前等待目标脚本身份、源码签名和 Binding 签名就绪。新模块在脚本、资源和原生绑定就绪后最后写入 `module.json`。创建中断才保留清理记录：每个写入步骤提前记录期望结果，整次检查通过后恢复被修改的旧文件并删除新文件；未确认的原生元数据、后续人工修改或外部引用会阻止清理。进程退出留下的记录可重新检查，清理中断可再次检查后继续。创建完成即结束记录，后续生成失败保留创建成果，修正源文件后正常重新生成；创建记录不接管全局生成产物、资源身份状态或生成归属清单。自动生成与面板操作共用项目锁，生成物理写入中断仍使用生成自己的恢复记录。`npm run verify` 验证静态约束和单元测试；Creator 集成和真实构建另外验证引擎注册、序列化引用、按需加载及生命周期。

依赖检查共用 `validation/dependencies.mjs`，按项目 TypeScript 配置解析导入、转导出、内联类型、import equals 和静态动态导入。类型约束与运行时依赖图分开检查；计算出来的模块路径拒绝作为可验证边界。
