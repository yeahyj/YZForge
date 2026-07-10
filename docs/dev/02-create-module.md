# 02. 创建 Module

Module 是一个可进入、可打开、可卸载的业务功能，例如 `Home`、`Battle`、`Shop`、`ActivitySpring`。

## 创建

```bash
npm run yzforge:create -- module Battle
```

会创建：

```text
assets/modules/Battle/
  module.json
  code/
    BattleModule.ts
    public.ts
    events/index.ts
    generated/
  res/
```

生成真实入口：

```bash
npm run yzforge:generate
```

## module.json

`module.json` 是模块描述文件：

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
  "libraries": []
}
```

常改的是 `libraries` 和公开参数类型。`entry` 默认保持 `code/generated/entry.ts`。

## 公开进入参数

只在 `code/public.ts` 写跨 Scope 可见的类型：

```ts
export interface BattleEnterParams {
    readonly stageId: string;
    readonly from?: string;
}
```

其他模块使用生成后的 contract：

```ts
import type { BattleEnterParams } from 'yzforge/contracts/modules/Battle';
```

不要 import `assets/modules/Battle/code/public.ts`。

## 生命周期

`BattleModule.ts` 里只做模块级编排：

```ts
import { Module } from 'yzforge';
import type { BattleEnterParams } from './public';
import { BattleFlow } from './flow/BattleFlow';

export class BattleModule extends Module<BattleEnterParams> {
    protected async onEnter(params?: BattleEnterParams): Promise<void> {
        await this.useFlow(BattleFlow).enter(params);
    }
}
```

推荐分工：

| 类型 | 职责 |
| --- | --- |
| `Module` | 生命周期入口和模块级组合 |
| `Flow` | 流程编排、打开 UI、等待结果 |
| `Service` | 业务规则、读配置、写 Model、发事件 |
| `Model` | 模块状态数据 |
| `View` | 显示和用户输入 |

Service 不直接打开 UI，需要 UI 时交给 Flow。

## 使用 Library

如果模块要用 `BattleCore`：

```json
{
  "libraries": ["BattleCore"]
}
```

代码里使用生成的 Ref 和 Contract：

```ts
import { BattleCoreRef } from 'yzforge/libraries/BattleCore';
import { BattleCoreTokens } from 'yzforge/contracts/libraries/BattleCore';

const battleCore = await this.libraries.load(BattleCoreRef);
const damageSystem = battleCore.use(BattleCoreTokens.damageSystem);
```

不要直接 import `assets/libraries/BattleCore/code/...`。

## 进入模块

从首包或当前流程进入：

```ts
import { BattleRef } from 'yzforge/modules/Battle';

await app.enterModule(BattleRef, {
    stageId: 'stage_001',
});
```

压栈进入后可以返回：

```ts
await app.back();
```

## 完成标准

新增 Module 完成后至少满足：

- `module.json` 中 name、bundle、entry 正确。
- `code/public.ts` 只放公开类型。
- 入口 UI 由 Flow 打开。
- 资源通过 `generated/assets.ts` 使用。
- 依赖 Library 已写入 `module.json`。
- `npm run yzforge:generate` 后无非预期 diff。
- `npm run yzforge:validate:strict` 和 `npm run typecheck` 通过。
