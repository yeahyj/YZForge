# 批量资源准备与预制体实例池

两项能力复用现有资源 Key、Bundle 和 Scope。预加载得到资源，实例池复用已经创建的节点；它们不负责页面导航，也不额外维护一套资源清单。

## 批量准备

```ts
const resources = await show.assets.loadMany({
    icon: LobbyRes.sprite.status,
    sound: LobbyRes.audio.click,
    part: LobbyRes.prefab.balancePart,
}, {
    concurrency: 3,
    onProgress: ({ completed, total }) => {
        show.commit(() => { this.lblProgress.string = `${completed}/${total}`; });
    },
});
// resources.icon、sound、part 分别保留 SpriteFrame、AudioClip、Prefab 类型。
```

示例中的 Key 替换为项目生成的实际 Key。`show.assets` 跟随本次展示；组件使用 `activation.assets`。全局入口为 `app.assets.loadMany(keys, owner, options)`，模块入口可用 `ctx.assets.in(owner)` 切换所有者。

- `concurrency` 默认 4，限制同时等待的条目数。重复 Key 仍由已有资源缓存合并物理加载。
- 进度开始时为 0，每个请求条目完成加 1，包括重复 Key。它不表示字节、实例化或 GPU 上传进度。
- 任一条目失败或回调抛错，整批失败并归还本批持有；其他界面或批次已经持有的资源继续有效。
- `onProgress` 必须同步。异步业务应放在调用者任务中。
- 成功的资源保留到所有者关闭。需要提前释放或取消时，创建自己的子 Scope；不要手动 `decRef` 或 `releaseAll`。

```ts
const preparation = show.scope.child('level-preparation');
try {
    const resources = await this.ctx.assets.in(preparation).loadMany(levelResources);
    // 在 preparation 有效期间使用 resources。
} finally {
    await preparation.close();
}
```

取消只终止本批等待，不能强制停止引擎中的共享下载；晚到的结果由原有资源缓存回收。`loadMany` 加载预制体资源，不创建节点；需要提前创建实例时使用下面的池。

## 预制体实例池

适合弹丸、飘字、特效和重复出现的 Part。每个池对应一个预制体：

```ts
const pool = show.assets.createPool(GameRes.prefab.effectPart, {
    maxSize: 32,
    maxIdle: 8,
});
await pool.prewarm(4, show.scope);

const lease = await pool.spawn(this.nodeEffects, show.scope, {
    prepare: (node, owner) => {
        // 节点仍 inactive；同步写入本次状态，再由框架激活 GameComponent。
        node.setPosition(x, y, 0);
        node.getComponent(EffectPart)!.render(effectData);
        owner.defer(() => { /* 取消本次业务自己的外部绑定 */ });
    },
});
await lease.release();
```

`pool.prewarm(count, owner)` 准备至少 `count` 个闲置实例，不调用业务 `onActivate`；数量不得超过 `maxIdle`，已借出的实例仍占用总容量。预热失败时，已成功准备的实例保留供下次使用。

`maxSize` 默认 32，包含闲置、借出、创建中和归还中的实例；达到上限直接报 `POOL_FULL`。`maxIdle` 默认 `min(8, maxSize)`，允许为 0；归还时超过闲置上限则销毁。

每次借出都有新的 `lease.scope`。归还立即取消这一轮使用，停用组件，等待本轮实际任务和异步清理结束，之后才放回池中。旧句柄不能再读取 `lease.node`；重复 `release()` 安全。配置或停用失败的实例会销毁，不再复用。不要在 `lease.scope` 或组件激活所跟踪的任务内等待归还自己，否则会等待自身；由外部控制者归还，或发出请求后结束当前任务。

页面或池的所有者结束时，自动回收还会等待本次一起取消的父级任务，例如 `show.run`。任务收尾期间节点已停用，但保持有效，也不会被下一位使用者借走。显式 `lease.release()` / `pool.close()` 表示调用方主动结束使用，可在父级任务的 `finally` 中等待；仍不能在借用自身的任务中等待归还或关池。

池重置每次借出的根节点位置、旋转、缩放。血量、文本、材质、子节点状态等业务数据由 `prepare` / `onActivate` 每轮重设；`prepare` 必须同步。池不接管任意第三方组件的异步任务，业务任务应使用 `GameComponent` 的 `activation.run` 和 `commit`。

`show.assets.createPool` 由本次页面展示持有，离开页面自动关闭并销毁节点。`ctx.assets.createPool` 默认由模块持有，适合跨页面共享。跨页面池的每次 `spawn` 仍应传当前使用者的期限。`pool.close()` 可提前结束池；`pool.inspect()` 提供只读容量摘要。不要自行销毁池内节点、将它们交给另一个池，或缓存已经失效的句柄。

完整 UIView 继续由 UIManager 管理，不能放进 PrefabPool；固定尺寸滚动列表继续使用 [VirtualList](virtual-list.md)，其条目绑定和复用已经集成。

## 示例与验证

Bootstrap 首页 → **资源准备、实例池与多语言**，可准备图片/音频/预制体、预热 3 个实例、借出与归还，观察同一实例编号复用。示例文件为 [ResourceLabPage.ts](../assets/game/modules/showcase/code/ui/ResourceLabPage.ts)。

```sh
node tests/integration/verify-resources-localization.mjs http://127.0.0.1:7456/
```

需要当前项目的 Creator 预览和 MCP。脚本在独立隐藏窗口检查真实输入、资源持有、失败回收、组件任务清理、语言切换、页面关闭和屏幕适配；退出时恢复设备选项并关闭自建窗口。目标平台性能和实际预热数量仍需以游戏内容实测。
