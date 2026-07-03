# 00. 总览

## 目标

YZForge 解决的是 Cocos Creator 项目的长期治理问题：

- 目录结构随项目增长逐渐失控。
- 资源路径手写，重命名后容易崩。
- Prefab 节点引用大量手拖，缺少类型安全。
- 模块之间互相 import，后期无法拆分、预加载和卸载。
- UI 打开、关闭、返回、遮罩和结果回调没有统一生命周期。
- Model、Service、Flow、View 边界模糊。
- 扩展能力越来越多，核心越来越重。

YZForge 的价值不是提供一堆工具函数，而是让项目天然形成稳定结构：

```text
Scope 边界
首包 Contract
Bundle 隔离
Handle 访问
资源清单生成
节点引用生成
配置契约生成
编辑器创建结构
Validator 防退化
```

## 非目标

第一版不追求：

- 默认 ECS。
- 默认 MVVM。
- 默认 FairyGUI。
- 默认热更新。
- 默认完整网络协议层。
- 默认平台 SDK。
- 默认行为树。
- 默认新手引导系统。
- 默认红点系统。
- 默认大而全 `app.lib`。

这些能力都可以做，但必须以 `Extension` 形式进入，不污染核心。

## 终局模型

YZForge 使用四层模型：

| 层 | 含义 | 例子 |
| --- | --- | --- |
| `Scope` | 代码所有权和依赖方向边界 | `AppScope`、`SharedScope`、`ModuleScope`、`LibraryScope`、`ExtensionScope` |
| `Contract` | 首包可见的公开契约 | `ModuleRef`、`LibraryRef`、公开参数类型、公开 token |
| `Bundle` | Cocos 物理构建和加载边界 | `yzforge-module-home`、`yzforge-content-pack-battle-level001` |
| `Handle` | Bundle 加载后的运行时访问句柄 | `LoadedModule`、`LoadedLibrary`、`LoadedContentPack` |

旧设计曾把业务单元、Bundle 和 Handle 混成三层模型，容易把“业务语义边界”和“首包公开契约”放在一起。终局设计把 `Contract` 独立出来，所有跨 Scope 访问都先经过首包契约。

## 命名约定

框架文档和代码生成器必须使用同一套官方命名，旧称只允许出现在命名约定、迁移说明或兼容说明里。

| 推荐命名 | 不推荐命名 | 原因 |
| --- | --- | --- |
| `EntryRegistry` | `PackageRegistry` | 注册的是 Bundle 加载后的 Entry，不是 npm package 或 Cocos package。 |
| `ContentPack` | `Content Pack` / `Pack` | 代码类型是 `ContentPackRef`、`LoadedContentPack`，术语保持一体。 |
| `ContentPackManager` | `PackManager` | 管理的是 ContentPack 生命周期，避免和压缩包、资源包泛称混淆。 |
| `Paper` | `Panel` | 表示可入栈、可返回的二级界面，不一定是小面板。 |
| `Top` | `Overlay` | 表示最高常驻层，避免和遮罩、弹窗覆盖层混淆。 |
| `Pause` / `Paused` | `Suspend` / `Suspended` | 表示模块被导航栈临时压到后台，不是 Cocos 或战斗逻辑暂停。 |
| `Scope 描述文件` | `Package 描述文件` | `module.json`、`library.json`、`content-pack.json` 描述的是架构 Scope，不是包管理概念。 |

## 基本原则

- `Scope` 决定代码属于谁。
- `Contract` 决定别人能知道什么。
- `Bundle` 决定什么时候加载。
- `Handle` 决定加载后怎么用。
- 业务代码不直接调用 `assetManager.loadBundle`。
- 业务代码不直接写资源路径。
- 业务代码不跨模块 import 内部实现。
- 动态 Bundle 之间不静态 import 彼此脚本。
- 生成器负责给出类型安全入口，Validator 负责防止绕过入口。

## Scope 划分

| Scope | 说明 | 是否按需 Bundle | 是否可被业务静态 import |
| --- | --- | --- | --- |
| `AppScope` | 启动、Main 场景、registry、contracts、global | 否 | 不直接暴露内部 |
| `SharedScope` | 无状态共享代码和基础资源 | 代码否，资源可选 | 是 |
| `ModuleScope` | 可进入、可打开、可卸载的业务功能 | 是 | 否 |
| `LibraryScope` | 多个 Module 复用的业务领域能力 | 是 | 否 |
| `ContentPackScope` | owner Module 解释的内容资源包 | 是 | 否 |
| `ExtensionScope` | 框架能力扩展，例如音频、存档、网络 | 可选 | 通过 token 使用 |

`global` 不再作为普通按需 Scope。它属于 `AppScope`，随首包启动，负责账号、会话、全局 UI、全局状态和全局策略。

## 参考框架取舍

YZForge 参考了 XForge2、当前项目内 XForge、Oops Framework、Bit Framework、MKFramework、OpenTGX 和 Cocos 官方 Asset Bundle 机制。

值得吸收：

- XForge2 的工程分区、编辑器创建结构、模块自治和扩展生态。
- 当前 XForge 的资源路径导出和节点绑定插件方向。
- Oops 的启动流程、UI 层级、Loading、Toast、安全区域等成熟经验。
- Bit 的轻量事件、资源加载器、模块化包生态。
- MKFramework 的工程化检查和示例驱动文档。
- OpenTGX 的模板案例路线。
- Cocos Asset Bundle 的物理加载边界、脚本分包、资源释放和 Import Maps 能力。

参考链接：

- XForge2：https://gitee.com/cocos2d-zp/xforge2
- Oops Framework：https://gitee.com/dgflash/oops-framework
- Bit Framework：https://github.com/gongxh0901/bit-framework
- MKFramework：https://github.com/1226085293/MKFramework
- Cocos Creator Asset Bundle：https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html
- Cocos Creator Import Maps：https://docs.cocos.com/creator/3.8/manual/en/scripting/modules/import-map.html

不直接照搬：

- 不采用大单例作为默认使用方式。
- 不把 ECS、MVVM、音频、存档、网络、平台全部塞进核心。
- 不把 FairyGUI 作为默认 UI。
- 不要求每个模块拆成 `code bundle + resource bundle` 两个物理 Bundle。
- 不让业务模块通过静态 import 共享运行时实现。

## 最终路线

```text
以 Scope 划清代码所有权，
以 Contract 固化首包公开契约，
以 Cocos Asset Bundle 作为物理加载边界，
以 Handle 作为运行时唯一访问入口，
以生成器输出稳定入口和清单，
以 Validator 阻断架构退化，
以 Extension 承载可选能力。
```
