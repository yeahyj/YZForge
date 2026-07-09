# YZForge

YZForge 是一个面向 **Cocos Creator 3.8** 的 TypeScript 游戏工程框架。

它解决的不是“帮你写所有游戏系统”，而是把长期项目最容易失控的地方先管住：模块边界、资源引用、配置表生成、UI prefab 流程、本地存储分区、时间工具、生成文件和架构校验。

当前目标版本：**Cocos Creator 3.8.8**

当前状态：**早期框架，持续开发中**

## 适合什么项目

YZForge 更适合这些项目：

- 使用 Cocos Creator 3.8.x。
- 使用 TypeScript。
- 希望采用单主场景、多模块、多 Bundle 的结构。
- 希望资源、配置、UI 引用尽量走生成入口。
- 希望多人或 AI 辅助开发时仍然有边界校验。
- 希望项目后期还能看清楚“代码属于谁、资源由谁释放、跨模块怎么通信”。

不适合这些情况：

- 只想快速写一个很小的 Demo。
- 希望所有业务都直接放在一个 `scripts/` 目录里。
- 希望每个玩法都靠 `director.loadScene()` 切 Cocos 场景。
- 不想使用生成器和校验器。

## 5 分钟开始

```bash
npm install
npm run yzforge:generate
npm run yzforge:validate:strict
npm run typecheck
```

然后用 Cocos Creator 3.8.8 打开项目根目录。

主场景：

```text
assets/app/main/Main.scene
```

## 创建第一个模块

```bash
npm run yzforge:create -- module Battle
npm run yzforge:create -- view PageBattle --owner Battle
npm run yzforge:create -- flow BattleFlow --owner Battle
npm run yzforge:generate
```

在 Cocos 里维护这个 prefab：

```text
assets/modules/Battle/res/view/PageBattle.prefab
```

进入模块：

```ts
import { BattleRef } from 'yzforge/modules/Battle';

await app.enterModule(BattleRef, {
    stageId: 'stage_001',
});
```

## 常用例子

读取配置表：

```ts
const item = this.config.tables.item.require(ItemIds.sword);
```

打开 UI：

```ts
import { assets } from '../generated/assets';

await this.module.ui.open(assets.views.pageBattle);
```

保存本机设置：

```ts
app.storage.settings.setNumber('audio/bgmVolume', 0.8);
```

判断是否跨天：

```ts
if (app.clock.hasCrossedDay(lastClaimAtMs)) {
    resetDailyReward();
}
```

## 核心能力

- `Module`：可进入、可卸载的业务功能。
- `Library`：多个模块复用的领域能力。
- `ContentPack`：由模块解释的内容包。
- 生成的模块 Ref、Library Ref、公开 Contract、资源入口和配置入口。
- Excel 配置表导出 JSON，并生成类型安全的 TS 读取接口。
- View / Part / AutoRefs 的 UI prefab 工作流。
- App 生命周期、模块加载、资源持有和释放诊断。
- `app.clock`：服务端时间偏移、跨天 / 跨周 / 跨月、倒计时。
- `app.storage`：本地存档、设置、缓存三分区。
- CLI 校验、类型检查、smoke 测试和 AI 开发检查。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run yzforge:create -- module Battle` | 创建模块 |
| `npm run yzforge:create -- library BattleCore` | 创建可复用 Library |
| `npm run yzforge:create -- content-pack Level001 --owner Battle` | 创建内容包 |
| `npm run yzforge:generate` | 刷新生成文件 |
| `npm run yzforge:generate:check` | 检查生成文件是否最新 |
| `npm run yzforge:config:build` | 生成配置表 JSON 和 TS 入口 |
| `npm run yzforge:config:check` | 检查配置表生成物是否最新 |
| `npm run yzforge:validate:strict` | 严格校验项目结构和框架边界 |
| `npm run typecheck` | 使用 Cocos TypeScript 工具链做类型检查 |
| `npm run yzforge:smoke` | 运行框架 smoke 测试 |
| `npm run yzforge:ai:doctor` | 运行 AI 开发健康检查 |

## 文档

- [快速上手](docs/getting-started.md)
- [框架使用手册](docs/manual/framework.md)
- [配置表使用手册](docs/manual/config-table.md)
- [UI 与 Prefab 流程](docs/manual/ui.md)
- [本地存储](docs/manual/storage.md)
- [时间与刷新周期](docs/manual/clock.md)
- [AI 开发手册](docs/manual/ai-development.md)
- [架构说明](docs/architecture/README.md)
- [RFC 与设计记录](docs/rfc/README.md)

## 核心思路

YZForge 默认使用一个常驻 App 壳场景：

```text
Main.scene
  App Shell
    Module
    Library
    ContentPack
    View
```

业务默认不靠多个 Cocos Scene 切换，而是靠模块、Bundle、View 和资源生命周期管理。

核心边界是：

```text
Scope -> Contract -> Bundle -> Handle
```

业务代码应该使用生成出来的 Ref、Contract、assets 和 config 入口，不要跨模块 import 私有文件。

## License

暂未声明 License。
