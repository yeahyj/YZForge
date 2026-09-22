# 示例应用说明

项目包含可删除的功能展示应用，通用框架、工作台和生成器不依赖这些业务模块。完整交互入口见 [功能展示](showcase.md)，职责与实际代码见 [正式开发工作流](development-workflow.md)。

## 启动与模块

`Bootstrap.scene → GameRoot → start-game.ts → ShowcasePage`。`GameRoot` 装配通用服务，`app/start-game.ts` 打开首屏；后续跳转由模块内的页面调用 `show.ui`。任务奖励等业务规则由所属模块的 Service 管理，复杂交互由模块内的 Presenter 协调。`app/generated` 继续由工具维护。

| 模块     | 职责                                                              | 关系                                               |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| showcase | 功能首页、UI/数据/时间/异步/存档实验、开发指南                    | 使用公开表与事件合同，不直接导入其他模块的私有实现 |
| workshop | 按需加载的训练任务、领取确认、动态 TaskPart、Service 与 Presenter | 声明 Profile API 依赖，读取 common 公共表          |
| lobby    | 配置、图片、奖励弹窗、余额 Part、音效与日期的综合示例             | 依赖 Profile API，读取 common 公共表               |
| profile  | 共享账号余额、领取去重、本地存档、订阅                            | 纯代码模块，无资源包                               |
| common   | 公共 EconomyTable                                                 | 纯资源模块，不创建业务工厂                         |

`common` 是示例选择的名字；公共表可以由任何模块公开。一个 Bundle 的 `dynamic` 自动编目，`static` 用于序列化引用；包根目录才是 Bundle。

XLSX 源表为 `common/economy.xlsx`、`lobby/items.xlsx`、`workshop/tasks.xlsx`、`showcase/samples.xlsx`，均位于 `config-source/`。Samples 展示分片与跨工作表公式。旧 `lobby/items.csv` 没有登记，不参与导出，新内容使用 XLSX。

## 验证边界

| 命令或脚本                                                 | 用途                                       | 对示例的要求              |
| ---------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| npm run verify                                             | 通用格式、类型、生成一致性、框架与工具回归 | 清理示例后仍可执行        |
| npm run test:showcase                                      | 规则、去重、Presenter、注入时钟与存档故障  | 需要新示例                |
| verify-showcase.mjs                                        | 构建后真实运行时检查与截图                 | 需要全部示例              |
| verify-showcase-editor.mjs                                 | 真实工作台步骤、源码读取与表/绑定跳转      | 需要 workshop 示例        |
| verify-template.mjs                                        | 独立空副本的启动与关闭                     | 要求副本已清空示例        |
| verify-workbench.mjs                                       | 真实 Creator 创建、绑定、删除与恢复        | 使用自己的临时模块        |
| verify-build.mjs / verify-preview.mjs / verify-runtime.mjs | 综合大厅与通用运行时的深层回归             | 需要 lobby/profile/common |
| verify-panel.mjs                                           | 工作台创建、草稿、设置与恢复交互           | 需要示例数据              |

集成脚本位于 `tests/integration`，不参与游戏构建。使用当前项目自己的 MCP 连接；不要在副本复用原项目的本机连接配置。制作资源应通过 Creator/MCP，不手改预制体和场景序列化文件。

清理示例需先解除启动入口中的示例调用，再按依赖顺序通过工作台处理模块，详见 [复制项目与清理示例](copy-project.md)。
