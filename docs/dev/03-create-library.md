# 03. 创建 Library

Library 是多个 Module 复用的领域能力，例如战斗计算、背包规则、经济系统、寻路、任务系统。

## 什么时候建 Library

适合建 Library：

- 两个以上 Module 都需要同一套业务能力。
- 能力有清晰 API，可以通过 token 使用。
- 能力需要自己的资源、配置或内部状态。
- Module 不应该知道它的具体实现类。

不适合建 Library：

- 只是一个无状态工具函数，放 `shared/code`。
- 只是某个模块内部逻辑，留在 Module。
- 只是关卡、章节、活动内容，建 `ContentPack`。

## 创建

```bash
npm run yzforge:create -- library BattleCore
npm run yzforge:generate
```

会创建：

```text
assets/libraries/BattleCore/
  library.json
  code/
    public.ts
    providers.ts
    generated/
  res/
```

## 公开契约

在 `code/public.ts` 里写类型和 token map：

```ts
export interface DamageInput {
    readonly attackerId: string;
    readonly targetId: string;
}

export interface DamageSystemApi {
    calc(input: DamageInput): number;
}

export interface BattleCoreTokenMap {
    damageSystem: DamageSystemApi;
}
```

`public.ts` 不 import `cc`，不创建对象，不导出运行时实现。

## 提供实现

在 `providers.ts` 里绑定公开 token 到内部实现：

```ts
import { classToken, defineLibraryProviders } from 'yzforge';
import type { BattleCoreTokenMap } from './public';
import { DamageSystem } from './system/DamageSystem';

export const providers = defineLibraryProviders<BattleCoreTokenMap>({
    damageSystem: classToken(DamageSystem),
});
```

`DamageSystem` 是 Library 内部代码，外部 Module 不直接 import。

## Module 中使用

先在 Module 的 `module.json` 声明：

```json
{
  "libraries": ["BattleCore"]
}
```

再在代码中使用：

```ts
import { BattleCoreRef } from 'yzforge/libraries/BattleCore';
import { BattleCoreTokens } from 'yzforge/contracts/libraries/BattleCore';

const battleCore = await this.libraries.load(BattleCoreRef);
const damageSystem = battleCore.use(BattleCoreTokens.damageSystem);
const damage = damageSystem.calc({
    attackerId: 'hero',
    targetId: 'enemy_001',
});
```

## Library 之间依赖

Library 可以依赖另一个 Library，但要写进自己的 `library.json`：

```json
{
  "libraries": ["MathCore"]
}
```

不要形成循环依赖。Validator 会检查 Library 循环依赖和非法 import。

## 完成标准

- `library.json` 正确声明 name、bundle、entry、public、libraries。
- `public.ts` 只写公开类型和 token map。
- `providers.ts` 只绑定公开 token，不暴露内部类。
- 使用方 Module 已在 `module.json` 声明依赖。
- 没有跨 Scope import Library 内部路径。
- `npm run yzforge:generate`、`npm run yzforge:validate:strict`、`npm run typecheck` 通过。
