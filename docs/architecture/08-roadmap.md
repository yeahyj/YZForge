# 08. 第一版范围与路线图

> 本文保留旧实施过程，不代表当前 API。当前架构和验收以 [V2 终局架构契约](../rfc/v2-terminal-architecture.md) 与 [V2 验收标准](../rfc/v2-acceptance.md) 为准。

## 第一版核心目标

第一版不追求功能大而全，追求架构闭环：

```text
Scope 可识别
Contract 可生成
Bundle 可加载
Handle 可使用
资源可追踪
UI 可归属
Validator 可阻断退化
```

## 第一版必须实现

Runtime：

- `App`
- `SharedRegistry`
- `GlobalRoot`
- `EntryRegistry`
- `BundleManager`
- `ModuleNavigator`
- `Module`
- `ModuleRef`
- `ModuleEntry`
- `LibraryRef`
- `LibraryEntry`
- `ContentPackRef`
- `LoadedModule`
- `LoadedLibrary`
- `LoadedContentPack`
- `Model`
- `Service`
- `Flow`
- `View`
- `Part`
- `Asset Manifest`
- `Asset Loader`
- `ContentPackManager`
- `UI Manager`
- `Part Manager`
- `Config Registry`
- `Event Bus`
- `Logger`
- `AutoRefs`
- `Extension Registry`
- `Import Map support`

Editor：

- 创建 Module。
- 创建 Library。
- 创建 ContentPack。
- 创建 View。
- 创建 Part。
- 创建 Model。
- 创建 Service。
- 创建 Flow。
- 生成 Import Maps。
- 生成 package registry。
- 生成 contracts。
- 生成 module refs。
- 生成 module entry。
- 生成 library refs。
- 生成 library entry。
- 生成 ContentPacks。
- 生成 assets。
- 生成 config。
- 生成 refs。
- Architecture Validator。

## 第一版不实现

- Audio Manager。
- Storage。
- Network。
- Platform。
- I18n。
- HotUpdate。
- ECS。
- BehaviorTree。
- Guide。
- RedPoint。
- Scene Module。
- 复杂窗口动画编辑器。

这些能力预留扩展点。

## 分阶段落地

### Phase 0：架构骨架

目标：先让边界站住。

必须完成：

- manifest schema：`module.json`、`library.json`、`content-pack.json`。
- config manifest schema 和 codec 接口草案。
- Cocos Bundle meta 命名和优先级规则。
- Import Maps 和 `tsconfig.paths` 生成。
- `assets/app/contracts` 生成。
- `assets/app/registry` 生成。
- 最小 Validator：目录、命名、禁止跨模块 import、generated hash。

交付案例：

```text
examples/minimal
  Main 启动
  HomeRef 在首包
  Home Module 按需加载
```

### Phase 1：Runtime 竖线

目标：跑通一个 Module 的完整生命周期。

必须完成：

- `App.start`。
- Main 场景校验。
- `BundleManager`。
- `EntryRegistry`。
- `ModuleRef` / `ModuleEntry`。
- `loadModule` / `preloadModule` / `enterModule` / `unloadModule`。
- 并发加载和失败回滚。

交付案例：

```text
examples/module-preload
  ActivitySpring Module 预加载、进入、卸载
```

### Phase 2：资源与 UI

目标：业务不手写资源路径，UI 有归属和生命周期。

必须完成：

- `generated/assets.ts`。
- `Asset Loader`。
- `UIManager`。
- `View` / `Part`。
- `ViewPolicy`。
- View 状态机。
- `openForResult`。
- 返回键处理。
- Module UI 暂停和恢复。
- View listener / disposer 自动清理。
- `AutoRefs`。
- 模块卸载关闭本模块 UI。

交付案例：

```text
examples/ui
  Page、Paper、Popup、Toast、Top、openForResult

examples/resource
  runtime 资源加载、模块卸载释放
```

### Phase 3：Library

目标：跨模块复用能力不靠互相 import。

必须完成：

- `LibraryRef` / `LibraryEntry`。
- Library contract token 生成。
- `LoadedLibrary.use(token)`。
- Library refCount。
- Library 资源加载和释放。
- Validator 检查 Module 不 import Library 内部实现。

交付案例：

```text
examples/library
  BattleCore Library、共享战斗脚本、共享战斗 prefab
```

### Phase 4：ContentPack

目标：内容包可以独立加载、释放，但不变成业务代码包。

必须完成：

- `content-pack.json`。
- `manifest.generated.json`。
- owner Module 的 `generated/content-packs.ts`。
- `ContentPackManager`。
- ContentPack 资源加载和 prefab 实例所有权。
- ContentPack prefab 脚本来源 Validator。

交付案例：

```text
examples/content-pack
  Battle Module 加载 Level001 ContentPack、关卡配置、关卡 prefab
```

### Phase 5：Config 与 Extension

目标：配置系统闭环，扩展点验证可用。

必须完成：

- `generated/config.ts`。
- `Config Registry`。
- JSON table codec。
- primary key `get` / `require` / `all`。
- row interface 生成。
- union enum 生成。
- ContentPack config 读取。
- 基础 Config Validator。
- App-level Extension Token。
- Module-level Extension Token。
- Extension install generated file。

交付案例：

```text
examples/config
  配置读取、Service 写入 Model

examples/extension
  自定义 StorageToken、自定义模块扩展
```

### Phase 6：完整 Validator 与 CI

目标：让框架能长期抗腐化。

必须完成：

- AST import 检查。
- Prefab 脚本来源检查。
- Main 场景检查。
- AutoRefs 检查。
- 资源路径检查。
- generated hash 检查。
- `yzforge generate --check`。
- `yzforge validate`。
- CI 示例。

## 官方扩展优先级

1. `yzforge-audio`
2. `yzforge-storage`
3. `yzforge-platform`
4. `yzforge-net`
5. `yzforge-i18n`
6. `yzforge-guide`
7. `yzforge-redpoint`
8. `yzforge-hotupdate`

## 标准案例

第一批案例：

```text
examples/minimal
  启动、Global、Home 模块、Page 打开

examples/ui
  Page、Paper、Popup、Toast、Top、openForResult

examples/resource
  generated/assets.ts、runtime 资源加载、模块卸载释放

examples/library
  BattleCore Library、共享战斗脚本、共享战斗 prefab

examples/content-pack
  Battle Module 加载 Level001 ContentPack、关卡配置、关卡 prefab

examples/module-preload
  ActivitySpring Module 预加载、进入、卸载

examples/config
  generated/config.ts、配置读取、Service 写入 Model

examples/extension
  自定义 StorageToken、自定义模块扩展
```

案例要求：

- 每个案例都能独立运行。
- 每个案例都体现一种推荐写法。
- 案例不能出现手写资源路径。
- 案例不能绕过框架生命周期。
- 案例必须通过 Validator。

## 近期实现顺序

推荐按以下顺序实现：

1. manifest schema、Import Maps、contracts、registry。
2. Main 场景校验和 App 启动。
3. BundleManager。
4. EntryRegistry、ModuleRef、ModuleEntry。
5. Module 加载、进入、卸载。
6. Asset Manifest 和 Asset Loader。
7. UIManager、View、Part。
8. AutoRefs。
9. LibraryRef、LibraryEntry、LoadedLibrary。
10. ContentPack、ContentPack manifest、ContentPackManager。
11. Config MVP：JSON table、类型生成、主键查询、基础校验。
12. Editor 创建和生成器。
13. Architecture Validator 完整版。

Validator 不应该拖到最后才开始。Phase 0 必须先有最小 Validator，后续每个 Phase 增加对应规则。
