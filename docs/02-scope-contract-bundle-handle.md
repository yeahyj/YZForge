# 02. Scope / Contract / Bundle / Handle

## 四层模型

YZForge 使用四层模型：

| 层 | 含义 | 典型产物 |
| --- | --- | --- |
| `Scope` | 代码所有权和依赖方向边界 | `ModuleScope`、`LibraryScope`、`AppScope` |
| `Contract` | 首包公开契约 | `ModuleRef`、`LibraryRef`、公开类型、公开 token |
| `Bundle` | Cocos 物理加载边界 | `yzforge-module-home`、`yzforge-lib-battle-core` |
| `Handle` | 运行时使用句柄 | `LoadedModule`、`LoadedLibrary`、`LoadedContentPack` |

这四层不能混用。`ModuleScope` 不等于 Bundle，Bundle 不等于业务 API，Contract 不等于真实实现。

## Scope 类型

| Scope | 含义 | 是否业务入口 | 是否有代码 | 是否有资源 | 是否按需 Bundle |
| --- | --- | --- | --- | --- | --- |
| `AppScope` | 启动、registry、contracts、global | 是 | 是 | 是 | 否 |
| `SharedScope` | 无状态共享代码和基础资源 | 否 | 是 | 可有 | 代码否，资源可选 |
| `ModuleScope` | 可以被打开或进入的业务功能 | 是 | 是 | 是 | 是 |
| `LibraryScope` | 多个 Module 复用的业务领域能力 | 否 | 是 | 可有 | 是 |
| `ContentPackScope` | 给 owner Module 解释的内容资源 | 否 | 否 | 是 | 是 |
| `ExtensionScope` | 框架能力包 | 否 | 是 | 可有 | 可选 |

判断规则：

- 玩家能进入，有自己的流程和 UI，做 `Module`。
- 多个 Module 共用业务代码、业务 prefab 或领域服务，做 `Library`。
- 只有地图、关卡、章节、配置、美术、音频，做 `ContentPack`。
- 给框架增加通用能力，做 `Extension`。
- 账号、会话、全局 UI、全局状态，放 `AppScope/global`。
- 无状态工具、基础类型、通用 UI 基类，放 `SharedScope`。

## Contract

Contract 是首包可见的公开契约，解决两个问题：

- 跨 Scope 需要类型安全。
- 跨 Bundle 不能静态 import 目标实现。

Contract 由生成器写入：

```text
assets/app/contracts/
assets/app/registry/
```

业务跨包 import 只允许指向这些首包文件：

```ts
import { BattleRef } from 'yzforge/modules/Battle';
import type { BattleEnterParams } from 'yzforge/contracts/modules/Battle';
import { BattleCoreRef } from 'yzforge/libraries/BattleCore';
```

禁止跨 Bundle import：

```ts
import { BattleModule } from '../../modules/Battle/code/BattleModule';
import { assets } from '../../modules/Battle/code/generated/assets';
import { DamageSystem } from '../../libraries/BattleCore/code/system/DamageSystem';
```

## Bundle 映射

```text
assets/modules/Home          -> yzforge-module-home
assets/libraries/BattleCore  -> yzforge-lib-battle-core
assets/content-packs/Battle/Level001 -> yzforge-content-pack-battle-level001
assets/shared/res            -> yzforge-shared-res   可选
```

规则：

- `assets/app` 不作为普通业务 Bundle。
- `assets/shared/code` 不做按需 Bundle，始终在首包。
- `Module`、`Library`、`ContentPack` 是主要按需 Bundle。
- `code/` 和 `res/` 必须保留，但只是逻辑目录，不单独配置为 Cocos Bundle。
- Bundle 名必须由生成器按命名算法计算，不能手写随意名称。

## ModuleRef 与 ModuleEntry

跨模块只能 import 首包轻量 `ModuleRef`。它由 `module.json` 和 contract 生成到 `assets/app/registry/modules/*`，不放在目标模块 Bundle 里：

```ts
import { ActivitySpringRef } from 'yzforge/modules/ActivitySpring';

await app.preloadModule(ActivitySpringRef);
await app.enterModule(ActivitySpringRef, { activityId: 1001 });
```

`ModuleRef` 只允许包含包名、Bundle 名、进入参数类型和轻量依赖声明：

```ts
import type { BattleEnterParams } from 'yzforge/contracts/modules/Battle';
import { BattleCoreRef } from 'yzforge/libraries/BattleCore';

export const BattleRef = defineModuleRef<BattleEnterParams>({
    name: 'Battle',
    bundle: 'yzforge-module-battle',
    libraries: [BattleCoreRef],
});
```

`ModuleRef` 不 import 模块类、Service、Model、View、`generated/assets`，也不 import 目标模块 `code/generated/entry.ts`。

真实 `ModuleEntry` 在模块 Bundle 加载后注册：

```ts
registerModuleEntry(defineModuleEntry({
    name: 'Home',
    type: HomeModule,
    assets,
    config,
    bundle: 'yzforge-module-home',
    libraries: [],
}));
```

`ModuleEntry` 和 `ModuleRef` 的 `libraries` 必须一致，Validator 负责检查。`preloadModule` 只依赖 `ModuleRef` 就能提前知道要加载哪些 Library。

## Bundle 入口执行

每个动态代码 Bundle 必须有 `code/generated/entry.ts`，并在顶层注册真实入口。

```text
assets/modules/Home/code/generated/entry.ts
assets/libraries/BattleCore/code/generated/entry.ts
```

运行时不动态 import 这个文件。运行时只调用 `BundleManager.loadBundle(bundleName)`，等待 Cocos 加载该 Bundle 的脚本。脚本顶层执行后，入口注册到 `EntryRegistry`。

`code/generated/entry.ts` 由生成器维护，不写业务逻辑。手写业务代码放在 Module、Service、Flow、Model、Library System 等文件中。

同一个 Scope 内部的脚本可以按正常 TypeScript 方式互相 import。YZForge 禁止的是跨 Scope 直接 import 内部实现，不限制 Scope 内部的文件组织。

加载后必须校验：

```text
Bundle 已加载
对应 Entry 已注册
Entry.name == Ref.name
Entry.bundle == Ref.bundle
Entry.libraries == Ref.libraries
```

## LibraryRef 与 LoadedLibrary

跨 Library 只能 import 首包轻量 `LibraryRef` 和首包公开 token：

```ts
import { BattleCoreRef } from 'yzforge/libraries/BattleCore';
import { BattleCoreTokens } from 'yzforge/contracts/libraries/BattleCore';

const battleCore = await this.libraries.load(BattleCoreRef);
const damage = battleCore.use(BattleCoreTokens.damageSystem);
```

`LibraryRef` 可以声明自己依赖的其他 Library：

```ts
export const BattleCoreRef = defineLibraryRef({
    name: 'BattleCore',
    bundle: 'yzforge-lib-battle-core',
    libraries: [],
});
```

Library 的实现类、系统类、组件类不允许被 Module 静态 import。Library Bundle 加载后通过 `LoadedLibrary` 暴露资源、配置和 token 实例。

## Library Public Contract

Library 的 `code/public.ts` 用于声明公开类型和 token 名称：

```ts
export interface DamageInput {
    attackerId: string;
    targetId: string;
}

export interface DamageSystemApi {
    calc(input: DamageInput): number;
}

export interface BattleCoreTokenMap {
    damageSystem: DamageSystemApi;
}
```

生成器生成首包 contract：

```ts
export const BattleCoreTokens = defineLibraryTokens<BattleCoreTokenMap>('BattleCore', {
    damageSystem: 'damageSystem',
});
```

真实实现只在 Library Bundle 内绑定：

```ts
registerLibraryEntry(defineLibraryEntry({
    name: 'BattleCore',
    bundle: 'yzforge-lib-battle-core',
    refs: assets,
    config,
    libraries: [],
    tokens: {
        damageSystem: classToken(DamageSystem),
    },
}));
```

## ContentPack

ContentPack 是可独立下载、加载、释放的内容包，但不能独立运行，必须由 owner Module 解释。

ContentPack 目录：

```text
assets/content-packs/Battle/Level001/
  content-pack.json
  manifest.generated.json
  res/
```

`manifest.generated.json` 是 ContentPack 内资源映射，运行时由 `ContentPackManager` 读取。

`content-pack.json` 声明 owner、Bundle 名和依赖 Library。owner Module 的生成器再生成 `code/generated/content-packs.ts`。ContentPack 自身不生成业务 TS，不提供可调用 API。

使用方式：

```ts
const contentPack = await this.contentPacks.load(BattleLevel001ContentPack);
const levelRoot = await contentPack.assets.load(contentPack.refs.levelRoot);
await this.useFlow(BattleFlow).startLevel(contentPack);
```

ContentPack prefab 可以挂载脚本，但脚本来源必须满足：

- `SharedScope` 组件。
- owner Module 已加载脚本。
- 已声明 Library 已加载脚本。

它不表示 ContentPack 可以 import 或保存业务源码。Validator 必须检查 prefab 序列化脚本 UUID 的来源。

## 依赖方向

允许：

```text
app -> shared
app -> global
app -> contracts
app -> registry

global -> shared
global -> extensions

module -> shared
module -> own code
module -> own generated/assets
module -> own generated/config
module -> declared LibraryRef
module -> LoadedLibrary handle
module -> declared Library config through LoadedLibrary
module -> global public API
module -> extensions

library -> shared
library -> own code
library -> own generated/assets
library -> own generated/config
library -> declared LibraryRef

content pack prefab -> shared scripts
content pack prefab -> owner module scripts
content pack prefab -> declared library scripts
```

禁止：

```text
module A -> module B internal code
module A -> module B generated/assets
module A -> module B generated/config
module A -> module B runtime config
module A -> module B code/generated/entry.ts
module A -> module B content pack
module -> library internal code
library -> module
content pack -> business source code
shared -> global
shared -> module
global internal -> module internal
registry/contract -> target bundle internal runtime values
dynamic bundle -> another dynamic bundle internal script
```

## Handle

Handle 是加载完成后的唯一真实访问入口：

```ts
interface LoadedModule<T extends Module = Module> {
    readonly ref: ModuleRef;
    readonly instance: T;
    readonly assets: ModuleAssets;
    readonly config: ModuleConfig;
    readonly contentPacks: ContentPackManager;
    unload(): Promise<void>;
}

interface LoadedLibrary<TTokens = unknown> {
    readonly ref: LibraryRef;
    readonly assets: LibraryAssets;
    readonly config: LibraryConfig;
    use<TKey extends keyof TTokens>(token: LibraryToken<TTokens, TKey>): TTokens[TKey];
    unload(): Promise<void>;
}

interface LoadedContentPack<TConfig = unknown> {
    readonly ref: ContentPackRef;
    readonly refs: ContentPackAssetRefs;
    readonly assets: ContentPackAssetScope;
    readonly config: ContentPackConfigScope<TConfig>;
    unload(): Promise<void>;
}
```

业务不保存 `AssetManager.Bundle`，不直接释放其他 Scope 的资源，不越过 Handle 访问真实能力。
