# 红点与数量提示

框架入口是 `ctx.badges` / `app.badges`，实现位于 `assets/framework/badges`，显示组件位于 `assets/framework/ui/components/badge/badge.ts`。业务负责计算“是否可领取”等条件；框架保存数量、聚合和通知，不轮询业务，也不自动加载模块。

## 注册和更新

```ts
import { badgeKey } from '路径/framework/badges';

// 跨模块公开的 Key 放在业务模块 contracts 中。
const Tasks = badgeKey('workshop/tasks');
const Reward = badgeKey('workshop/tasks/42');
ctx.badges.group(Tasks, 'sum', ctx.scope);
const source = ctx.badges.source(Reward, ctx.scope, Tasks, 0);

// 业务状态保存成功后发布；写入失败时保留原状态。
source.set(canClaim ? 1 : 0);
```

`BadgeKey.id` 是稳定业务标识，与 UI 节点路径、虚拟列表索引无关。父级必须先注册，不能重复注册同名节点，也不能将叶节点作为父级。任意层数的分组可以组合：`sum` 汇总数量，溢出时饱和到安全整数上限；`any` 在后代任意直接子项非零时返回 1。每次写入沿祖先链重新聚合各级直接子项。

| API                                        | 行为                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| `group(key, mode, owner, parent?)`         | 注册分组，返回 `{ key, dispose }`                        |
| `source(key, owner, parent?, initial = 0)` | 注册叶节点，返回 `{ key, set, dispose }`                 |
| `get(key)`                                 | 当前数量；尚未注册或已移除时为 0                         |
| `subscribe(key, owner, callback)`          | 立即同步回调当前数量；以后仅数量变化时通知；返回解绑函数 |
| `batch(action)`                            | 合并同步写入，净值未变不通知；批处理中读取为最新值       |
| `inspect()`                                | 返回节点数、订阅数与是否结束                             |

`set` 只接受非负安全整数。`dispose` 幂等，删除分组同时删除后代；同名节点重新注册后，旧句柄不能改写新节点。订阅可以早于注册。首次回调抛错会解绑并向调用者抛出；之后的通知异常单独上报，不影响其他订阅者。

`batch` 不是事务，抛错之前的写入仍会发布；不能使用异步回调。多个奖励同时更新时可在业务保存成功后统一 `batch`。取消注册的 owner 会同步删除对应节点；取消订阅的 owner 会立即解绑。

## 绑定页面与复用条目

业务预制体中创建 `node_badge`，挂载 `yzforge.Badge`；子节点 `Visual` 提供圆点背景和可选数字 Label。`visual` 必须指向子节点，不能指向组件自身，否则隐藏红点会结束订阅。将节点加入既有自动绑定流程：

```ts
this.nodeBadge.getComponent(Badge)!.bind(this.ctx.badges, Tasks, show.scope);

// 业务 Part 的 render(item) 方法内，每次绑定用新的 item.scope。
this.nodeBadge.getComponent(Badge)!.bind(
    this.ctx.badges,
    badgeKey(`workshop/tasks/${item.data.id}`),
    item.scope,
    99,
);
```

默认超过 99 显示 `99+`，零时隐藏；不配置 Label 时只显示圆点。重复 `bind` 自动解绑前一次，`clear`、组件禁用和销毁也会解绑。支持激活前绑定；重新启用后由宿主重新绑定。普通 Part 使用 `activation.scope`，列表条目使用更短的 `item.scope`，不要把条目订阅挂到模块 Scope。

业务注册的生命周期应覆盖数据有效期。任务示例来源随 workshop 模块存在，模块卸载后首页该 Key 回到 0；若首页必须始终显示离线任务红点，账号会话应持有相应业务模块或数据服务。账号切换先结束旧注册的 owner，再为新账号注册，不能复用旧账号来源。

## 示例和验证

- “正式业务流程 · 任务奖励”：任务可领取时显示数量，领取和余额变化后更新。
- “UI 与 Part → 虚拟列表”：一万行中每隔 100 行一个红点，合计 100；事件按钮批量切换，滚动/刷新后只保留当前条目订阅。
- `tests/badges.test.ts` 覆盖聚合、批处理、重入、错误隔离、可变输入、销毁和重绑。
- `tests/integration/verify-network-guide.mjs` 在实际 Creator 预览检查批量更新、列表复用和关闭归零。
