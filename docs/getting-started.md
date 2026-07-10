# 快速上手

这篇文档帮助你从一个干净的 YZForge 项目开始，完成基础检查，并创建第一个业务模块。

## 环境要求

- Cocos Creator 3.8.8
- Node.js 和 npm
- Git

YZForge 本身是一个 Cocos 项目。安装依赖后，用 Cocos Creator 打开项目根目录。

## 第一次运行

```bash
npm install
npm run yzforge:generate
npm run yzforge:validate:strict
npm run typecheck
```

如果这些命令通过，说明项目结构、生成文件和 TypeScript 配置是健康的。

## 打开项目

用 Cocos Creator 3.8.8 打开项目根目录。

主场景：

```text
assets/app/main/Main.scene
```

启动设置：

```text
assets/app/main/AppBootSettings.ts
```

`AppBootSettings` 保存渠道和 Debug / Release profile。玩法数值、活动参数和远程开关不要写到这里，应该走配置表或服务端。

## 插件入口

打开 Cocos 后，顶部菜单会出现 `YZForge`。

| 菜单 | 用途 |
| --- | --- |
| `YZForge -> 仪表盘` | 查看项目摘要，执行生成、校验、诊断和 smoke |
| `YZForge -> 创建` | 可视化创建 Module、Library、ContentPack、View、Part、Model、Service、Flow |
| `YZForge -> 配置表` | 扫描 Excel，维护配置表导出规则 |
| `YZForge -> 创建帮助` | 查看可用创建消息和参数示例 |
| `YZForge -> 生成全部` | 刷新生成文件 |
| `YZForge -> 升级框架` | 将项目迁移到当前已安装的框架版本 |
| `YZForge -> Config -> 生成配置` | 生成配置表 JSON 和 TS 入口 |
| `YZForge -> Config -> 检查配置` | 检查配置表生成物是否最新 |
| `YZForge -> 安全清理` | 清理可安全重建的生成资源 |
| `YZForge -> 校验架构` | 检查项目结构和框架边界 |
| `YZForge -> 严格校验` | 严格校验项目结构和框架边界 |
| `YZForge -> 冒烟测试` | 运行框架 smoke 测试 |

日常可视化操作优先用插件；自动化、CI、AI 开发优先用 CLI。

## 创建第一个 Module

插件方式：

```text
YZForge -> 创建
  类型：Module
  名称：Battle

YZForge -> 创建
  类型：Module View
  归属：Battle
  名称：PageBattle

YZForge -> 创建
  类型：Flow
  归属：Battle
  名称：BattleFlow

YZForge -> 生成全部
```

CLI 方式：

创建一个模块、一个页面 View 和一个 Flow：

```bash
npm run yzforge:create -- module Battle
npm run yzforge:create -- view PageBattle --owner Battle
npm run yzforge:create -- flow BattleFlow --owner Battle
npm run yzforge:generate
```

生成后的结构大致是：

```text
assets/modules/Battle/
  module.json
  code/
    BattleModule.ts
    public.ts
    generated/
    flow/
    view/
  res/
    view/
    part/
    runtime/
    content/
```

在 Cocos 里创建或维护这个 prefab：

```text
assets/modules/Battle/res/view/PageBattle.prefab
```

把生成的 `PageBattle` 脚本挂到 prefab 根节点，然后运行：

```bash
npm run yzforge:generate
npm run yzforge:validate:strict
npm run typecheck
```

## 进入模块

使用生成的 Ref，不要 import 模块内部私有路径：

```ts
import { BattleRef } from 'yzforge/modules/Battle';

await app.enterModule(BattleRef, {
    stageId: 'stage_001',
});
```

在模块内部，通过生成的资源入口打开 UI：

```ts
import { Flow } from 'yzforge';
import { assets } from '../generated/assets';

export class BattleFlow extends Flow {
    public async enter(): Promise<void> {
        await this.module.ui.open(assets.views.pageBattle);
    }
}
```

## 添加配置表

Excel 放到：

```text
config-source/excel
```

然后使用 Cocos 菜单：

```text
YZForge -> 配置表
  Scan Excel / 扫描 Excel
  Save Table / 保存表规则
  Build Config / 生成配置
```

也可以用 CLI：

```bash
npm run yzforge:config:table -- --label "Battle Items" --source config-source/excel/Battle.xlsx --sheet Items --scope module:Battle --table item
npm run yzforge:config:build
```

业务读取生成后的配置：

```ts
const item = this.config.tables.item.require(ItemIds.sword);
```

完整规则看：[配置表使用手册](./manual/config-table.md)

## 使用时间和本地存储

跨天判断：

```ts
if (this.app.clock.hasCrossedDay(lastClaimAtMs)) {
    this.resetDailyReward();
}
```

本机设置：

```ts
this.app.storage.settings.setNumber('audio/bgmVolume', 0.8);
```

本地存档：

```ts
this.app.storage.save.setJson('player', playerSave);
```

## 日常命令

这些命令都有对应的插件菜单或面板入口。提交前和 CI 推荐使用 CLI，因为输出更稳定。

| 命令 | 用途 |
| --- | --- |
| `npm run yzforge:generate` | 刷新生成文件 |
| `npm run yzforge:generate:check` | 检查生成文件是否最新 |
| `npm run yzforge:update` | 执行框架迁移并同步项目 |
| `npm run yzforge:update:check` | 只检查框架升级会产生哪些变化 |
| `npm run yzforge:config:build` | 生成配置表 JSON 和 TS 入口 |
| `npm run yzforge:config:check` | 检查配置表生成物是否最新 |
| `npm run yzforge:validate:strict` | 严格校验项目结构和框架边界 |
| `npm run typecheck` | 类型检查 |
| `npm run yzforge:smoke` | 框架 smoke 测试 |

## 继续阅读

- [框架使用手册](./manual/framework.md)
- [框架升级](./manual/framework-upgrade.md)
- [UI 与 Prefab 流程](./manual/ui.md)
- [配置表使用手册](./manual/config-table.md)
- [本地存储](./manual/storage.md)
- [时间与刷新周期](./manual/clock.md)
