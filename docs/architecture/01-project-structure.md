# 01. 项目结构

## 标准目录

```text
assets/
  app/
    main/
      Main.scene
      Main.ts
      AppBootSettings.ts
      presets/
        UILoading.prefab
        UIShadow.prefab
        UITouchMask.prefab
        UIToast.prefab
    bootstrap/
      app.ts
      install.generated.ts
    registry/
      modules/
        Home.ref.generated.ts
      libraries/
        BattleCore.ref.generated.ts
      content-packs/
        Battle.generated.ts
      extensions/
        storage.ref.generated.ts
      entries.generated.ts
    contracts/
      modules/
        Battle.contract.generated.ts
      libraries/
        BattleCore.contract.generated.ts
      content-packs/
        BattleLevel001.contract.generated.ts
      extensions/
        Storage.contract.generated.ts
    global/
      code/
        GlobalRoot.ts
        generated/
          assets.ts
          config.ts
        events/
          index.ts
        ...
      res/
        view/
        part/
        runtime/
        content/
        sound/

  shared/
    code/
      ...
    res/
      runtime/
      content/
      sound/

  modules/
    Home/
      module.json
      code/
        HomeModule.ts
        public.ts
        generated/
          entry.ts
          assets.ts
          config.ts
          content-packs.ts
        events/
          index.ts
        ...
      res/
        view/
        part/
        runtime/
        content/
        sound/

  libraries/
    BattleCore/
      library.json
      code/
        public.ts
        generated/
          entry.ts
          assets.ts
          config.ts
        ...
      res/
        prefab/
        runtime/
        content/
        sound/

  content-packs/
    Battle/
      Level001/
        content-pack.json
        manifest.generated.json
        res/
          prefab/
          scene/
          runtime/
          content/

extensions/
  yzforge/
    runtime-template/
    editor/
    package.json

  yzforge-audio/
    runtime/
    editor/
    package.json

examples/
  minimal/
  ui/
  resource/
  library/
  content-pack/
  module-preload/
  config/
  extension/
```

## 目录职责

- `assets/app/main`：唯一启动场景、Main 组件、系统 UI preset。
- `assets/app/bootstrap`：App 初始化、扩展安装、启动顺序生成文件。
- `assets/app/registry`：首包轻量地址簿，只包含 Ref，不 import 目标 Bundle 内部实现。
- `assets/app/contracts`：首包公开契约，由各 Scope 的 `code/public.ts` 或描述文件生成。
- `assets/app/global`：全局有状态能力，属于 `AppScope`，随首包启动。
- `assets/shared/code`：无状态共享代码，允许所有 Scope 静态 import；子目录按需创建，不强制一开始铺满。
- `assets/shared/res`：共享基础资源，可按项目需要做高优先级共享资源 Bundle。
- `assets/modules`：可进入、可打开、可卸载的业务功能。
- `assets/libraries`：多个 Module 复用的业务领域能力。
- `assets/content-packs`：某个 owner Module 解释的内容包。
- `extensions/yzforge`：框架本体，包含 runtime 与 editor 插件。
- `extensions/yzforge-*`：官方扩展包。
- `examples`：标准案例，不放入正式项目 `assets/`。

## 关键目录与文件说明

### AppScope

| 路径 | 作用 | 维护方式 |
| --- | --- | --- |
| `assets/app/main/Main.scene` | 唯一启动场景，承载 MainRoot、UIRoot、WorldRoot。 | 手工维护，Validator 校验 |
| `assets/app/main/Main.ts` | 启动组件，创建并启动 `App`。 | 手写 |
| `assets/app/main/AppBootSettings.ts` | 启动前项目设置，例如渠道和 Debug/Release profile。 | 手写，挂在 MainRoot |
| `assets/app/main/presets/` | 系统 UI prefab，例如 Loading、Toast、TouchMask、遮罩。 | 手工维护 |
| `assets/app/bootstrap/app.ts` | App 创建入口，负责组装核心系统。 | 手写 |
| `assets/app/bootstrap/install.generated.ts` | 扩展安装和启动顺序入口。 | 生成，不手改 |
| `assets/app/registry/` | 首包轻量地址簿，暴露 ModuleRef、LibraryRef、ContentPackRef、ExtensionRef。 | 生成 |
| `assets/app/registry/modules/*.ref.generated.ts` | 模块轻量引用，只记录 name、bundle、依赖和参数类型。 | 生成，不手改 |
| `assets/app/registry/libraries/*.ref.generated.ts` | Library 轻量引用，只记录 name、bundle 和依赖。 | 生成，不手改 |
| `assets/app/registry/content-packs/*.generated.ts` | 首包可见的内容包索引，用于预下载、版本检查和工具面板展示。 | 生成，不手改 |
| `assets/app/registry/extensions/*.ref.generated.ts` | 扩展轻量引用，用于启动时安装扩展能力。 | 生成，不手改 |
| `assets/app/registry/entries.generated.ts` | 所有 Entry 的首包总索引。 | 生成，不手改 |
| `assets/app/contracts/` | 首包公开契约目录，存放跨 Scope 可见的类型和 token。 | 生成 |
| `assets/app/contracts/modules/*.contract.generated.ts` | Module 公开类型，例如进入参数。 | 生成，不手改 |
| `assets/app/contracts/libraries/*.contract.generated.ts` | Library 公开类型和 token map。 | 生成，不手改 |
| `assets/app/contracts/content-packs/*.contract.generated.ts` | ContentPack 公开元信息和配置类型。 | 生成，不手改 |
| `assets/app/contracts/extensions/*.contract.generated.ts` | Extension 公开 token 和配置类型。 | 生成，不手改 |
| `assets/app/global/` | 全局有状态能力，随 App 启动，不随 Module 卸载。 | 手写 + 生成 |
| `assets/app/global/code/GlobalRoot.ts` | 全局根对象，管理账号、会话、全局 UI、全局服务。 | 手写 |
| `assets/app/global/code/generated/assets.ts` | GlobalScope 资源清单。 | 生成，不手改 |
| `assets/app/global/code/generated/config.ts` | GlobalScope 配置类型和索引。 | 生成，不手改 |
| `assets/app/global/code/events/index.ts` | 全局事件定义入口；单个事件可拆到 `code/events/<Event>.ts`。 | 手写 |
| `assets/app/global/code/...` | GlobalScope 手写代码，内部结构由项目自行组织。 | 手写 |
| `assets/app/global/res/view/` | 全局可打开 UI prefab。 | 手工维护 |
| `assets/app/global/res/part/` | 全局 UI 片段 prefab。 | 手工维护 |
| `assets/app/global/res/runtime/` | GlobalScope 显式加载资源。 | 手工维护，生成清单 |
| `assets/app/global/res/content/` | GlobalScope 间接依赖资源和配置原始文件。 | 手工维护 |
| `assets/app/global/res/sound/` | 全局音频资源，由音频扩展扫描。 | 手工维护 |

### SharedScope

`SharedScope` 最小只需要 `assets/shared/code/` 这个目录，不需要固定入口文件，也不强制内部目录结构。开发者可以按项目习惯组织，例如按技术类型、领域主题、平台能力或团队归属划分。

进入 `shared` 的代码必须满足两个条件：无业务状态，并且至少被两个 Scope 复用。否则优先留在当前 Module 或 Library 内部。

| 路径 | 作用 | 维护方式 |
| --- | --- | --- |
| `assets/shared/code/` | SharedScope 代码根目录，内部结构由项目自行组织。 | 手写 |
| `assets/shared/res/runtime/` | 共享显式资源，例如通用材质、字体。 | 手工维护，生成清单 |
| `assets/shared/res/content/` | 共享间接依赖资源。 | 手工维护 |
| `assets/shared/res/sound/` | 通用音效。 | 手工维护 |

可选组织方式示例：

```text
assets/shared/code/
  foundation/
  ui/
  cocos/
  platform/
```

或：

```text
assets/shared/code/
  math/
  collections/
  components/
  async/
```

框架只关心边界规则，不关心这些子目录叫什么。

### ModuleScope

Module 内部手写代码目录不强制固定。`flow/`、`model/`、`service/`、`view/`、`part/`、`config/` 是推荐分法，不是框架硬要求。框架只要求能找到 manifest、公开契约、生成入口、资源清单和资源扫描目录。

| 路径 | 作用 | 维护方式 |
| --- | --- | --- |
| `assets/modules/<Module>/module.json` | Module 描述文件，声明 name、bundle、entry、public、libraries。 | 手写，Validator 校验 |
| `assets/modules/<Module>/code/generated/entry.ts` | Module Bundle 注册脚本，注册 `ModuleEntry`。 | 生成，不手改 |
| `assets/modules/<Module>/code/<Module>Module.ts` | Module 主类，承接生命周期。 | 手写 |
| `assets/modules/<Module>/code/public.ts` | Module 公开契约源文件，只写类型。 | 手写，生成器读取 |
| `assets/modules/<Module>/code/generated/assets.ts` | Module 资源清单。 | 生成，不手改 |
| `assets/modules/<Module>/code/generated/config.ts` | Module 配置类型和索引。 | 生成，不手改 |
| `assets/modules/<Module>/code/generated/content-packs.ts` | owner Module 可使用的 ContentPack 类型安全入口。 | 生成，不手改 |
| `assets/modules/<Module>/code/events/index.ts` | 模块内事件定义入口；单个事件可拆到 `code/events/<Event>.ts`。 | 手写 |
| `assets/modules/<Module>/code/...` | Module 手写代码，内部结构由项目自行组织。 | 手写 |
| `assets/modules/<Module>/res/view/` | 模块可被 UIManager 打开的 View prefab。 | 手工维护 |
| `assets/modules/<Module>/res/part/` | 模块动态 UI 片段 prefab。 | 手工维护 |
| `assets/modules/<Module>/res/runtime/` | 模块代码显式加载资源。 | 手工维护，生成清单 |
| `assets/modules/<Module>/res/content/` | 模块间接依赖内容，不默认进入普通资源清单。 | 手工维护 |
| `assets/modules/<Module>/res/sound/` | 模块音频资源，由音频扩展扫描。 | 手工维护 |

### LibraryScope

Library 内部手写代码目录不强制固定。`types/`、`system/`、`component/`、`helper/` 是推荐分法，不是框架硬要求。公开给其他 Scope 使用的类型和 token 必须放在 `public.ts`。

| 路径 | 作用 | 维护方式 |
| --- | --- | --- |
| `assets/libraries/<Library>/library.json` | Library 描述文件，声明 name、bundle、entry、public、libraries。 | 手写，Validator 校验 |
| `assets/libraries/<Library>/code/generated/entry.ts` | Library Bundle 注册脚本，注册 `LibraryEntry`。 | 生成，不手改 |
| `assets/libraries/<Library>/code/public.ts` | Library 公开契约源文件，声明公开类型和 token map。 | 手写，生成器读取 |
| `assets/libraries/<Library>/code/generated/assets.ts` | Library 资源清单。 | 生成，不手改 |
| `assets/libraries/<Library>/code/generated/config.ts` | Library 配置类型和索引。 | 生成，不手改 |
| `assets/libraries/<Library>/code/...` | Library 手写代码，内部结构由项目自行组织。 | 手写 |
| `assets/libraries/<Library>/res/prefab/` | 领域共享 prefab。 | 手工维护 |
| `assets/libraries/<Library>/res/runtime/` | Library 显式加载资源。 | 手工维护，生成清单 |
| `assets/libraries/<Library>/res/content/` | Library 间接依赖内容。 | 手工维护 |
| `assets/libraries/<Library>/res/sound/` | Library 音频资源，由音频扩展扫描。 | 手工维护 |

### ContentPackScope

| 路径 | 作用 | 维护方式 |
| --- | --- | --- |
| `assets/content-packs/<Owner>/<ContentPack>/content-pack.json` | ContentPack 描述文件，声明 owner、id、bundle、libraries，以及必填的 presentationRequests。 | 手写，Validator 校验 |
| `assets/content-packs/<Owner>/<ContentPack>/manifest.generated.json` | ContentPack 内资源映射，供 `ContentPackManager` 运行时读取。 | 生成，不手改 |
| `assets/content-packs/<Owner>/<ContentPack>/res/prefab/` | 内容 prefab，例如关卡根节点、章节内容节点。 | 手工维护 |
| `assets/content-packs/<Owner>/<ContentPack>/res/scene/` | 可选场景资源，第一版核心不直接切场景。 | 手工维护 |
| `assets/content-packs/<Owner>/<ContentPack>/res/runtime/` | ContentPack 显式资源。 | 手工维护，生成 manifest |
| `assets/content-packs/<Owner>/<ContentPack>/res/content/` | ContentPack 间接依赖内容和本地配置。 | 手工维护 |

### Extensions 与 Examples

| 路径 | 作用 | 维护方式 |
| --- | --- | --- |
| `packages/yzforge-runtime/src/` | 框架 runtime 权威源码，`packages/yzforge-runtime/package.json` 拥有 `name: "yzforge"`。 | 手写 |
| `extensions/yzforge/runtime-template/` | runtime 安装模板 / 缓存 copy，不参与业务 import。 | 由源码包同步 |
| `assets/yzforge/runtime/` | Cocos 可见 runtime copy，是 Import Map 的运行时入口。 | 由源码包同步 |
| `extensions/yzforge/editor/` | 框架编辑器插件、生成器、Validator。 | 手写 |
| `extensions/yzforge/package.json` | Cocos Editor 扩展描述文件。 | 手写 |
| `extensions/yzforge-*` | 官方扩展，例如 audio、storage、net。 | 手写 |
| `examples/minimal` | 最小启动、Global、Home Module 示例。 | 手写 |
| `examples/ui` | UI 分层、openForResult、Toast 示例。 | 手写 |
| `examples/resource` | 资源清单和释放示例。 | 手写 |
| `examples/library` | Library 复用示例。 | 手写 |
| `examples/content-pack` | ContentPack 加载和解释示例。 | 手写 |
| `examples/module-preload` | 模块预加载、进入、卸载示例。 | 手写 |
| `examples/config` | 配置生成和读取示例。 | 手写 |
| `examples/extension` | 自定义扩展 token 示例。 | 手写 |

## Scope 身份

| 目录 | Scope | 说明 |
| --- | --- | --- |
| `assets/app` | `AppScope` | 首包启动、registry、contracts、global |
| `assets/shared/code` | `SharedScope` | 无状态共享代码 |
| `assets/modules/<Name>` | `ModuleScope` | 可进入业务功能 |
| `assets/libraries/<Name>` | `LibraryScope` | 业务领域库 |
| `assets/content-packs/<Owner>/<Name>` | `ContentPackScope` | 内容资源包 |
| `extensions/<Name>` | `ExtensionScope` | 框架扩展 |

`global` 是 `AppScope` 的一部分，不参与 `Module`/`Library`/`ContentPack` 这类按需 Scope 分类。业务模块需要全局能力时，必须通过 App 暴露的 token、facade 或事件使用，不直接 import `assets/app/global/code` 内部文件。

## Bundle 映射

推荐映射：

```text
assets/modules/Home          -> yzforge-module-home
assets/libraries/BattleCore  -> yzforge-lib-battle-core
assets/content-packs/Battle/Level001 -> yzforge-content-pack-battle-level001
assets/shared/res            -> yzforge-shared-res   可选
```

不推荐把 `assets/app` 配成普通业务 Bundle。启动场景、registry、contracts 和 global 应留在首包。

`code/` 和 `res/` 是逻辑目录，不再强制拆成两个物理 Bundle。

`code/generated/entry.ts` 是动态代码 Bundle 的生成入口，负责顶层注册 `ModuleEntry` 或 `LibraryEntry`。业务逻辑写在 `HomeModule.ts`、`Service`、`Flow`、`System` 等手写文件里，不写进生成入口。

同一个 Scope 内部的手写脚本可以按需要互相 import。限制只发生在跨 Scope 时：跨 Module、跨 Library、跨 ContentPack 不能直接 import 内部实现。

## Cocos Bundle 配置

Editor 插件应自动配置或校验 Cocos Bundle 设置：

| 目录 | 是否 Bundle | Bundle 名 | 说明 |
| --- | --- | --- | --- |
| `assets/modules/<Name>` | 是 | `yzforge-module-<kebab-name>` | Module 代码和资源按需加载 |
| `assets/libraries/<Name>` | 是 | `yzforge-lib-<kebab-name>` | Library 代码和资源按需加载 |
| `assets/content-packs/<Owner>/<Name>` | 是 | `yzforge-content-pack-<owner>-<kebab-name>` | ContentPack 独立加载和释放 |
| `assets/shared/res` | 可选 | `yzforge-shared-res` | 共享资源较多时启用 |
| `assets/app` | 否 | 无 | 留在首包，不作为业务 Bundle |

规则：

- Bundle 名必须由生成器根据目录和 manifest 计算，不能手写随意名称。
- `module.json`、`library.json`、`content-pack.json` 中的 `bundle` 必须与 Cocos Bundle meta 配置一致。
- 动态 Bundle 必须包含自己的 `code/generated/entry.ts`。
- `generated/entry.ts` 必须随目标 Bundle 构建，并在 Bundle 加载后注册 Entry。
- `assets/shared/res` 如果作为 Bundle，优先级必须高于依赖它的业务 Bundle，并在业务 Bundle 前加载。
- 远程 Bundle、小游戏分包、压缩方式等平台差异由 Extension 或构建配置处理，核心只要求运行时能通过 `bundle` 名加载。

## Scope 描述文件

`module.json`、`library.json`、`content-pack.json` 是生成器读取的 Scope 描述文件。它们不写业务逻辑，只描述身份、Bundle、入口、公开契约和依赖。

推荐最小字段：

```json
{
  "$schema": "../../../schemas/yzforge.scope.schema.json",
  "schemaVersion": 2,
  "kind": "module",
  "name": "Battle",
  "bundle": "yzforge-module-battle",
  "entry": "code/generated/entry.ts",
  "public": "code/public.ts",
  "enterParams": "BattleEnterParams",
  "libraries": ["BattleCore"]
}
```

`content-pack.json` 必须声明 owner：

```json
{
  "$schema": "../../../../schemas/yzforge.scope.schema.json",
  "schemaVersion": 2,
  "kind": "content-pack",
  "id": "battle.level001",
  "owner": "Battle",
  "name": "Level001",
  "bundle": "yzforge-content-pack-battle-level001",
  "libraries": ["BattleCore"]
}
```

`assets/app/registry/content-packs` 记录首包可见的内容包元信息，便于预下载、版本检查和工具面板展示。owner Module 运行时使用的类型安全入口仍然生成到 `assets/modules/<Owner>/code/generated/content-packs.ts`。

## Public Contract

`code/public.ts` 是 Scope 的公开契约源文件。业务可以手写它，但运行时代码不能直接跨 Bundle import 它。

生成器读取 `code/public.ts` 后，把公开类型和 token 镜像到首包：

```text
assets/modules/Battle/code/public.ts
  -> assets/app/contracts/modules/Battle.contract.generated.ts

assets/libraries/BattleCore/code/public.ts
  -> assets/app/contracts/libraries/BattleCore.contract.generated.ts
```

允许：

```ts
export interface BattleEnterParams {
    levelId: string;
}

export type BattleMode = 'normal' | 'challenge';
```

禁止：

```ts
export class BattleService {}
export const BattleConfig = {};
import { Node } from 'cc';
```

`public.ts` 只能导出类型、interface、纯类型 token 声明。任何运行时实现、Cocos 组件、资源引用都不允许进入公开契约。

## Import Aliases

YZForge runtime 的包身份属于 `packages/yzforge-runtime/package.json`，不是项目根 `package.json`。项目根 package name 应保留给游戏项目自身。

生成器同步维护两套解析目标：

- TypeScript / 工具侧：`tsconfig.paths.yzforge` 指向 `./packages/yzforge-runtime/src/index.ts`，使用显式相对路径，不依赖已弃用的 `baseUrl`。
- Cocos runtime 侧：Import Map 的 `yzforge` 指向 `assets/yzforge/runtime/index.ts`。

推荐别名：

```text
yzforge                  -> packages/yzforge-runtime/src/index       TypeScript
yzforge                  -> assets/yzforge/runtime/index             Cocos Import Map
yzforge/modules/        -> assets/app/registry/modules/
yzforge/libraries/      -> assets/app/registry/libraries/
yzforge/content-packs/  -> assets/app/registry/content-packs/
yzforge/contracts/      -> assets/app/contracts/
yzforge/shared/         -> assets/shared/code/
```

业务代码从 `yzforge` 顶层桶入口导入框架 runtime API，不直接 import `yzforge/bundle-manager`、`packages/yzforge-runtime/src/*`、`assets/yzforge/runtime/*`、`db://yzforge-modules/*` 这类内部路径。底层如需兼容 Cocos AssetDB，由生成器统一维护 runtime package、Import Maps 和 TypeScript paths。

`extensions/yzforge/runtime-template/` 和 `assets/yzforge/runtime/` 都不能被业务或生成代码以物理路径 import。它们是从 `packages/yzforge-runtime/src/` 同步出来的 copy。

## Main 场景

第一版只允许一个启动场景：

```text
assets/app/main/Main.scene
```

推荐节点树：

```text
Main.scene
  MainRoot
    Main.ts
    AppBootSettings.ts

    WorldRoot
      SceneHost

    Canvas
      UICamera
      UIRoot
        UnderlayLayer
        PageLayer
        PaperLayer
        PopupLayer
        ToastLayer
        TopLayer
        SystemOverlayLayer
```

规则：

- `Main.scene` 永驻，不被玩法场景替换。
- `WorldRoot/SceneHost` 预留给后续 Scene Module 或 3D/玩法内容扩展。
- UI 层节点必须启动时校验，所有标准 Layer 都直接挂在 `UIRoot` 下并覆盖真实屏幕。
- `MainRoot` 必须挂 `AppBootSettings`，开发者可在 Inspector 修改渠道和运行 profile。
- Main 场景不放全局 `SafeAreaRoot`；需要安全区的 View 在自己的 prefab 内使用 `YZSafeAreaRoot`。
- Loading、Toast、TouchMask 等系统 UI preset 放在 `assets/app/main/presets`。
- 首包只放启动必要内容、contracts、registry、global 和 shared code，不把业务模块实现拉进来。
