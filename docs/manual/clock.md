# 时间与刷新周期

这篇只讲业务怎么用时间。结论很简单：业务逻辑里不要直接写 `Date.now()`，需要当前时间、跨天、跨周、跨月、倒计时，都走 `app.clock`。

## 常用入口

在 `Module`、`Library` 或其它已经拿到 `App` 的地方：

```ts
const now = this.app.clock.serverUnixMs();
const day = this.app.clock.dayOfWeek();
const left = this.app.clock.msUntilNextDay();
```

常用方法：

| 方法 | 用途 |
| --- | --- |
| `nowMs()` | App 启动后的单调毫秒数，用于冷却、耗时、性能统计。 |
| `unixMs()` | 当前本机 Unix milliseconds。 |
| `serverUnixMs()` | 当前服务端 Unix milliseconds；未同步时等于本机时间。 |
| `setServerUnixMs(serverMs)` | 用登录、心跳或接口返回的服务端时间校准 offset。 |
| `clearServerUnixMs()` | 清除服务端时间校准，回到本机时间。 |
| `dayOfWeek(ms?)` | ISO 星期几：周一 `1`，周日 `7`。 |
| `startOfDayMs(ms?)` | 所在自然日的开始时间。 |
| `startOfWeekMs(ms?)` | 所在自然周的开始时间，周一开始。 |
| `startOfMonthMs(ms?)` | 所在自然月的开始时间。 |
| `isSameDay(a, b)` | 两个时间是否同一天。 |
| `isSameWeek(a, b)` | 两个时间是否同一周。 |
| `isSameMonth(a, b)` | 两个时间是否同一月。 |
| `hasCrossedDay(from, to?)` | 是否已经跨天。 |
| `hasCrossedWeek(from, to?)` | 是否已经跨周。 |
| `hasCrossedMonth(from, to?)` | 是否已经跨月。 |
| `msUntilNextDay(ms?)` | 距离下一天还有多少毫秒。 |
| `msUntilNextWeek(ms?)` | 距离下一周还有多少毫秒。 |
| `msUntilNextMonth(ms?)` | 距离下一月还有多少毫秒。 |

## 服务端时间

登录、心跳或任意可信接口拿到服务端时间后，立刻校准：

```ts
this.app.clock.setServerUnixMs(loginResult.serverTimeMs);
```

之后业务读取 `serverUnixMs()`、`hasCrossedDay()`、`msUntilNextDay()` 都会使用服务端时间 offset。

同步之后，`serverUnixMs()` 使用运行时单调时钟推进服务端时间，不会每次都简单返回 `Date.now() + offset`。这样玩家手动修改系统时间时，已经校准过的服务端时间不容易突然跳变。

如果登出、切环境或服务端时间不可用：

```ts
this.app.clock.clearServerUnixMs();
```

## 每日刷新

保存上次领取时间：

```ts
const lastClaimMs = save.dailyRewardClaimedAtMs;

if (this.app.clock.hasCrossedDay(lastClaimMs)) {
    save.dailyRewardClaimedAtMs = 0;
}
```

显示距离明天刷新还有多久：

```ts
const leftMs = this.app.clock.msUntilNextDay();
```

## 每周和每月刷新

周刷新默认周一开始：

```ts
if (this.app.clock.hasCrossedWeek(save.weeklyQuestRefreshAtMs)) {
    this.resetWeeklyQuest();
}
```

月卡、月活动、月榜可以用跨月判断：

```ts
if (this.app.clock.hasCrossedMonth(save.monthlyPassUpdatedAtMs)) {
    this.resetMonthlyPass();
}
```

## 使用规则

- 框架统一使用 Unix milliseconds，不混用秒。
- `dayOfWeek` 使用 ISO 规则：周一是 `1`，周日是 `7`。
- 默认按本地时区计算自然日、自然周、自然月。
- 需要“每天凌晨 5 点刷新”这类业务规则时，不要改 `AppClock`；应在业务层或活动系统里基于 `app.clock.serverUnixMs()` 再解释。
- 活动日历、节假日、赛季、cron、服务器强校验不放进 `AppClock`，应放到配置表、活动系统或平台扩展。
