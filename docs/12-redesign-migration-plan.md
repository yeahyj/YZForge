# 12. YZForge 重构迁移计划

## 目标

把当前框架从“方向正确的骨架”推进到“规则能被运行时和 Validator 共同守住”的状态。

每个阶段都必须保持：

```text
npm run typecheck
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run yzforge:smoke
```

如果某阶段故意让旧 smoke 失效，必须同阶段更新 smoke，不能留下无保护窗口。迁移计划只描述实现顺序，不表示存在临时架构；每个阶段都必须朝终局契约收敛。

## 迁移原则

- 先收紧事实源，再重构 runtime。
- 先让 Validator 抓住坏状态，再依赖 runtime 假设好状态。
- 每次只改变一个边界概念。
- 不保留隐式 fallback 作为兼容层。
- 文档、生成器、Validator、runtime 必须同阶段更新。
- 每个阶段结束都要有一个可复现验收用例。

## Phase 0：冻结旧状态

目的：建立重构前基线。

任务：

- 记录当前 `typecheck / generate:check / validate:strict / smoke` 输出。
- 确认 `assets/modules/Start`、`assets/libraries/Test`、`assets/content-packs/Start/Test2` 是保留、删除还是补 descriptor。
- 执行 runtime 目录终局命名决策：
  - `extensions/yzforge/runtime` 改为 `extensions/yzforge/runtime-template`。
  - `assets/yzforge/runtime` 保持为项目实际运行时代码入口。
  - 生成器、文档、Validator 不再引用 `extensions/yzforge/runtime`。

验收：

- 文档说明当前空 scope 校验问题。
- runtime 双目录职责写入文档。
- 如果暂未执行物理 rename，必须有 Validator 待办项阻止长期保留旧路径名。

## Phase 1：Scanner 与 Validator 收紧

目的：让裸目录不能逃过架构规则。

任务：

- Scanner 增加 orphan scope 识别。
- Validator 对以下情况报错：
  - `assets/modules/<Name>` 没有 `module.json`。
  - `assets/libraries/<Name>` 没有 `library.json`。
  - `assets/content-packs/<Owner>/<Name>` 没有 `content-pack.json`。
- Editor 面板诊断里展示 orphan scope。
- smoke 增加 orphan scope 失败用例。

验收：

- 当前裸目录如果未补 descriptor，`validate:strict` 必须失败。
- 补齐 descriptor 或删除目录后，`validate:strict` 恢复通过。

## Phase 2：Manifest Schema 标准化

目的：让 descriptor 字段成为唯一事实源。

任务：

- 明确 `module.json`、`library.json`、`content-pack.json` 最小字段。
- Descriptor 校验扩展：
  - `entry` 必须存在。
  - `public` 必须存在。
  - `bundle` 必须符合算法。
  - `libraries` 必须是已存在 Library。
- `create` 命令生成完整 descriptor。
- `generate` 只读取 descriptor，不从目录猜业务身份。

验收：

- 修改 descriptor 的 bundle 后，Validator 必须报错。
- 删除 public 文件后，Validator 必须报错。
- 生成产物从 descriptor 稳定生成。

## Phase 3：AppKernel、MainBinding、Lifecycle 与 Viewport

目的：把启动基础设施一次性落进 runtime，不拆成临时启动链。

任务：

- 新增 `AppLifecycle`。
- 新增 `ViewportManager`、`DeviceProfile`、`ViewportConfig`。
- 新增 `MainBinding` 类型。
- `App.start(options)` 接收 viewport 配置。
- `App.start` 校验 Main 场景、保存 MainBinding、初始化 viewport。
- 监听前后台、resize、orientation 或 Cocos 等价事件。
- Validator 禁止业务直接调用：
  - `setDesignResolutionSize`
  - `sys.getSafeAreaRect`

验收：

- `app.viewport.profile` 可读取。
- `viewport-changed` 可订阅。
- MainBinding 可提供所有标准 UI root。
- 业务代码直接读取安全区会被 Validator 拦截。

## Phase 4：Main 场景结构与适配组件

目的：让场景结构和适配组件满足终局 MainBinding。

目标结构：

```text
MainRoot
  WorldRoot
    SceneHost
  Canvas
    UIRoot
      FullscreenLayer
      SafeAreaRoot
        PageLayer
        PaperLayer
        PopupLayer
        ToastLayer
        TopLayer
      SystemLayer
```

任务：

- 新增或实现：
  - `YZSafeAreaRoot`
  - `YZFullScreenRoot`
  - `YZScreenFitter`
- Editor create/repair Main 场景。
- Validator 检查新结构和组件。

验收：

- 缺少 `SafeAreaRoot` 时 Validator 失败。
- 缺少 `FullscreenLayer` 时 Validator 失败。
- UIManager 不再通过递归名字查找 Layer。

## Phase 5：BundleHandle、ReleaseScope 与 OwnershipLedger

目的：让加载、预加载、卸载都有 owner。

任务：

- 新增 `ReleaseScope`。
- 新增 `OwnershipLedger`。
- `BundleManager` 内部改为 owner acquire/release。
- `preloadModule` 创建 `PreloadOwner`。
- `loadModule` 创建 `ModuleOwner`。
- `ContentPackManager` 创建 `ContentPackOwner`。
- `LibraryRegistry` 用 owner key 绑定 acquire，而不是只散落在 Map 中。

验收：

- 预加载后可以明确释放 preload owner。
- 重复 preload 不会泄漏 bundle ref。
- `ReleaseScope.release` 幂等。
- OwnershipLedger snapshot 能显示模块、库、内容包、资源关系。

## Phase 6：Module 卸载改成强清理流程

目的：生命周期抛错不阻断资源释放。

任务：

- `unloadModule` 改为幂等任务。
- 卸载顺序统一：
  - detach navigator
  - force close UI
  - unload ContentPack
  - dispose Flow / Service / Model
  - call onUnload
  - release assets
  - release libraries
  - release bundle
- 每一步错误记录到聚合错误，但后续步骤继续执行。
- 加载失败路径也使用同一套 cleanup。

验收：

- `onUnload` 抛错时，module assets 和 bundle 仍释放。
- 重复调用 `unloadModule` 不重复释放。
- 正在 enter 的模块不能被直接半卸载。

## Phase 7：UI 内部拆分

目的：保留业务 API，重构内部职责。

任务：

- 新增 `LayerRegistry`。
- 新增 `ViewRuntime`。
- 新增 `SystemUI`。
- PopupMask 从 ModuleUI 内部逻辑迁移到 SystemUI 或 ViewRuntime 的 mask service。
- SystemUI 核心只包含 SystemUIHost、Loading、TouchMask、Toast facade、PopupMask。
- SystemConfirm 作为 AppScope preset 或 Extension，不作为核心硬依赖。
- Layer root 来自 MainBinding。
- `openForResult` 在 owner unload 时稳定 resolve cancel。

验收：

- Page 打开到 PageLayer。
- Popup 打开时 mask 在 PopupLayer 正确位于目标下方。
- System TouchMask 在 SystemLayer 阻断输入。
- Module 卸载时 pending `openForResult` 不悬挂。

## Phase 8：Library Token Provider 闭环

目的：让 Library 从 public contract 到 runtime use 完整可用。

任务：

- 设计 `defineLibraryProviders`。
- Library 模板生成 `code/providers.ts`。
- `generated/entry.ts` 引入 providers。
- Validator 检查：
  - public token map key。
  - providers key。
  - generated contract token key。
  - entry tokens。
- Library 释放时 dispose token instances。

验收：

- 示例 Library 提供一个 token。
- Module 通过 `LoadedLibrary.use(token)` 拿到实现。
- provider 缺 key 或多 key 时 Validator 失败。

## Phase 9：Config 与 ContentPack 闭环

目的：让配置和内容包不再是空壳。

任务：

- Config manifest MVP：
  - JSON table。
  - primary key。
  - row interface。
  - get / require / all。
- `generated/config.ts` 生成 table refs。
- Runtime ConfigLoader 创建 `ConfigScope`。
- ContentPack runtime 读取或使用 generated manifest。
- ContentPack config 挂到 `LoadedContentPack.config`。

验收：

- Module config 可读取一张 JSON 表。
- ContentPack config 可读取一张 JSON 表。
- 主键重复 Validator 失败。
- 删除 config payload Validator 失败。

## Phase 10：ExtensionContext

目的：让扩展可以安全接入 lifecycle、viewport 和 token。

任务：

- Extension 接口改为 `install(context: ExtensionContext)`。
- 支持 `installBeforeStart`、`installAfterMainBinding`、`installBeforeFirstModule`、`dispose` 阶段。
- 依赖拓扑排序。
- 安装失败报告依赖链。
- 兼容当前 extension stub 模板。
- smoke 增加 app-level 和 module-level token 用例。

验收：

- Extension 可订阅 lifecycle。
- Extension 可读取 viewport。
- Extension 可声明自己需要的安装阶段。
- Extension 可提供 app token 和 module token。
- 循环依赖 Validator 或安装阶段失败。

## Phase 11：示例与文档回填

目的：证明框架不是只在文档里成立。

任务：

- 新增最小示例：
  - Home Module。
  - 一个 Page。
  - 一个 Popup openForResult。
  - 一个 Library token。
  - 一个 ContentPack。
  - 一张 config 表。
- 更新 docs 00-10 中过时 API。
- 更新 README 阅读顺序。
- Smoke 覆盖最小示例。

验收：

- 示例能 generate、validate、typecheck。
- 文档中的核心 API 与实现一致。
- 不再出现“文档有能力，runtime 无关键词”的状态。

## 暂停条件

任一阶段出现以下情况应暂停并写 Decision Record：

- 需要改变 `Scope / Contract / Bundle / Handle` 四层模型。
- 需要允许跨 Module import 内部代码。
- 需要让业务直接拿 `AssetManager.Bundle`。
- 需要跳过 ReleaseScope。
- 需要继续保留 `extensions/yzforge/runtime` 作为正式路径名。
- 需要把 audio/storage/net/platform 放进核心。
- 需要牺牲 Validator 规则换取短期方便。
