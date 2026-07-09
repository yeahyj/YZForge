# 00. 快速开始

## 第一次接手项目

先确认项目能生成、校验和类型检查：

```bash
npm install
npm run yzforge:generate
npm run yzforge:validate:strict
npm run typecheck
```

如果你本机需要跑 Cocos 构建，还要确认 `.yzforge/toolchain.json` 已配置本机 Cocos 路径。这个文件是本机配置，不提交。

启动渠道和 Debug/Release profile 在 `assets/app/main/AppBootSettings.ts` 的 Inspector 字段里改。这里是启动设置，不是配置表；玩法数值和活动参数仍走配置表。

## 常用命令

```bash
npm run yzforge:create -- module Battle
npm run yzforge:create -- library BattleCore
npm run yzforge:create -- content-pack Level001 --owner Battle
npm run yzforge:create -- view PageBattle --owner Battle
npm run yzforge:create -- part PartRewardCell --owner Battle
npm run yzforge:create -- model BattleModel --owner Battle
npm run yzforge:create -- service BattleService --owner Battle
npm run yzforge:create -- flow BattleFlow --owner Battle
npm run yzforge:create -- event-file BattleStarted --owner Battle
npm run yzforge:create -- extension-stub Storage
```

生成和检查：

```bash
npm run yzforge:generate
npm run yzforge:generate:check
npm run yzforge:validate
npm run yzforge:validate:strict
npm run typecheck
```

清理生成物：

```bash
npm run yzforge:clean:generated:check
npm run yzforge:clean:generated
```

烟测和构建：

```bash
npm run yzforge:smoke
npm run yzforge:validate:build-matrix
npm run yzforge:cocos:build:web
```

## 新增功能的最小闭环

以新增 `Battle` 功能为例：

```bash
npm run yzforge:create -- module Battle
npm run yzforge:create -- view PageBattle --owner Battle
npm run yzforge:create -- flow BattleFlow --owner Battle
npm run yzforge:generate
```

然后做三件事：

1. 在 Cocos 中创建或维护 `assets/modules/Battle/res/view/PageBattle.prefab`。
2. 把 `PageBattle` 脚本挂到 prefab 根节点。
3. 在 `BattleModule.onEnter` 中调用 `BattleFlow`，由 Flow 打开 UI。

最后检查：

```bash
npm run yzforge:validate:strict
npm run typecheck
```

## 每天开发的默认节奏

改代码前先想清楚这段能力属于哪里：

| 你要做的事 | 默认位置 |
| --- | --- |
| 一个可进入页面或玩法功能 | `assets/modules/<Module>` |
| 多个模块复用的战斗、背包、经济等领域能力 | `assets/libraries/<Library>` |
| 不带业务状态的工具函数和基础组件 | `assets/shared/code` |
| 账号、会话、全局 UI、全局策略 | `assets/app/global` |
| 关卡、章节、活动配置和内容资源 | `assets/content-packs/<Owner>/<Pack>` |

不要先建一个“万能目录”。先归属，再写代码。
