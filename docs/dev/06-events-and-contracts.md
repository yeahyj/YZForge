# 06. 事件与公开契约

## 公开契约

`code/public.ts` 是 Scope 对外公开的类型源文件。

Module 示例：

```ts
export interface BattleEnterParams {
    readonly stageId: string;
}
```

Library 示例：

```ts
export interface DamageSystemApi {
    calc(input: DamageInput): number;
}

export interface BattleCoreTokenMap {
    damageSystem: DamageSystemApi;
}
```

生成后，外部从首包 contract 导入：

```ts
import type { BattleEnterParams } from 'yzforge/contracts/modules/Battle';
import { BattleCoreTokens } from 'yzforge/contracts/libraries/BattleCore';
```

不要从目标 Scope 的 `code/public.ts` 导入。

## public.ts 里不能放什么

不要放：

- 运行时对象。
- 业务实现类。
- `cc` 导入。
- 直接访问资源、节点、组件的代码。
- 会产生副作用的初始化逻辑。

`public.ts` 应该可以被首包安全读取。

## 模块内事件

创建事件文件：

```bash
npm run yzforge:create -- event-file BattleStarted --owner Battle
```

会创建：

```text
assets/modules/Battle/code/events/BattleStarted.ts
assets/modules/Battle/code/events/index.ts
```

事件文件形态：

```ts
export const BattleStarted = 'Battle.BattleStarted' as const;

export interface BattleStartedPayload {
    readonly value?: unknown;
}

export interface BattleStartedEvents {
    readonly [BattleStarted]: BattleStartedPayload;
}
```

业务使用：

```ts
import { BattleStarted } from '../events';

this.module.event.emit(BattleStarted, {
    value: stageId,
});
```

## 事件适合什么

适合：

- 同一 Module 内 View、Service、Model 的松耦合通知。
- Library 内部能力之间的通知。
- 不需要同步返回值的状态变化。

不适合：

- 进入另一个 Module。
- 请求另一个 Module 的内部 Service。
- 调用 Library 公开 API。
- 需要强类型返回值的业务流程。

这些情况应该用 `ModuleRef`、`LibraryToken`、Flow 或公开 contract。

## 跨 Scope 通信选择

| 场景 | 推荐方式 |
| --- | --- |
| 进入另一个功能 | `app.enterModule(ModuleRef, params)` |
| 使用复用业务能力 | `LoadedLibrary.use(Token)` |
| 打开当前模块 UI | `module.ui.open(assets.views.xxx)` |
| 请求全局 UI | Global 公开 API 或 Extension token |
| 同模块内部通知 | `module.event.emit/listen` |
| 内容资源加载 | owner Module 加载 `ContentPack` |

核心判断：跨 Scope 不能直接 import 对方内部实现。
