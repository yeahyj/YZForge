# 示例应用说明

示例用于展示框架的组合方式；框架、工作台和生成器不依赖这三个模块存在。可以保留示例学习，也可以按 [复制项目与清理示例](copy-project.md) 整体移除。

## 启动入口

```text
Bootstrap.scene
└─ GameRoot.ts                     框架装配、启动状态与错误显示
   └─ app/start-game.ts            项目的业务入口；当前打开 LobbyViews.dashboard
      └─ modules/lobby            可删除的大厅示例
```

`app/generated` 由工具根据模块和配置声明生成，不能直接手改。将 `start-game.ts` 改为空函数后，没有模块、资源包和配置表也可以启动。

## 三个示例模块

| 模块      | 演示内容                                                                                       | 依赖关系                                              |
| --------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `lobby`   | Dashboard 页面、RewardPopup 弹窗、动态 WalletPart、绑定、Actions、时间、图片、音效、本模块配置 | 业务 API 依赖 `profile`；配置读取 `common` 的公开合同 |
| `profile` | 普通服务、公开模块 API、共享余额、本地存档迁移                                                 | 无示例模块依赖                                        |
| `common`  | 纯资源模块、公共 EconomyTable、跨模块加载配置                                                  | `code.mode = none`，不创建业务工厂                    |

`common` 只是示例所选的模块名。公共表可以由任何模块公开，不要求固定放在叫 common 的目录，也不需要创建对应服务实例。

源工作簿是 `config-source/lobby/items.xlsx` 和 `config-source/common/economy.xlsx`。`config-source/lobby/items.csv` 是旧导入示例，当前没有登记、不参与导出；它可以随示例源目录一起移除。新项目使用 XLSX。

`lobby` 的资源均在自己的 `bundles/default` 内。`dynamic` 自动编目，`static` 用于序列化引用；`default` 目录才是 Bundle。公共配置在 `common` 的资源包中，通过公开 TS 合同按需加载。

## 检查与演示工具的边界

| 命令/脚本                                                      | 用途                                                    | 是否需要这份示例                  |
| -------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------- |
| `npm run verify`                                               | 格式、类型、生成一致性、单元与工具测试                  | 不需要；清理示例后也应通过        |
| `tests/integration/verify-template.mjs`                        | 独立空副本的 Web 启动与关闭验收                         | 要求副本已清空示例                |
| `tests/integration/verify-workbench.mjs`                       | 真实 Creator 创建、绑定、删除与恢复，使用自己的临时模块 | 不需要                            |
| `verify-build.mjs`、`verify-preview.mjs`、`verify-runtime.mjs` | 大厅、弹窗、配置、资源与运行时交互回归                  | 需要 `lobby`、`profile`、`common` |
| `verify-panel.mjs`                                             | 包含选择现有示例模块的面板交互回归                      | 需要示例数据                      |
| `author-demo.mjs`、`demo-fixtures.mjs`                         | 最初制作示例的辅助脚本                                  | 专用工具，常规开发无需运行        |

这些脚本位于 `tests/integration`，不参与游戏构建。真实编辑器集成测试使用项目自己的 MCP 连接，并校验目标项目；不要把原项目的 MCP 配置复制到新项目后复用。

制作脚本对已存在的内容有保护，无法作为“一键重置示例”。需要恢复完整演示时，优先使用 Git 中保存的模板版本，或工作台对应的完整删除备份。
