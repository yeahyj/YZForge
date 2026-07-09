# 14. 本地存档、设置与缓存

这篇只讲本机键值存储。结论：业务不要直接用 `sys.localStorage` 或 `window.localStorage`，统一走 `app.storage`。

## 三个固定分区

| 分区 | 用途 | 是否可以随时清 |
| --- | --- | --- |
| `app.storage.save` | 本地存档、玩家进度、离线收益记录 | 不可以 |
| `app.storage.settings` | 音量、画质、语言、震动开关、本机偏好 | 不可以，除非用户重置设置 |
| `app.storage.cache` | etag、接口缓存、下载索引、可重建的临时数据 | 可以 |

不要新增第四种随意分区。需要细分时，用 slash key 或 `child()`：

```ts
app.storage.save.child('slot/user001').setJson('profile', profile);
```

## 常用写法

保存存档：

```ts
app.storage.save.setJson('player', {
    level: 12,
    exp: 340,
    updatedAtMs: app.clock.serverUnixMs(),
});
```

读取存档：

```ts
const player = app.storage.save.getJson<PlayerSave>('player');
```

保存设置：

```ts
app.storage.settings.setBoolean('audio/enabled', true);
app.storage.settings.setNumber('audio/bgmVolume', 0.8);
app.storage.settings.setString('language', 'zh-CN');
```

读取设置：

```ts
const audioEnabled = app.storage.settings.getBoolean('audio/enabled', true);
const volume = app.storage.settings.getNumber('audio/bgmVolume', 1);
const language = app.storage.settings.getString('language', 'zh-CN');
```

写缓存：

```ts
app.storage.cache.setString('bundle/startEtag', etag);
app.storage.cache.setJson('notice/latest', noticePayload);
```

清缓存：

```ts
app.storage.clearCache();
```

## key 命名

key 只能使用：

```text
letters
numbers
.
_
-
/
```

推荐：

```text
player
audio/enabled
audio/bgmVolume
slot/user001/profile
notice/latest
bundle/startEtag
```

不要写：

```text
../player
audio:enabled
中文键
带 空 格
```

框架会拒绝空 key、包含 `..` 的 key、包含 `:` 的 key 和不在白名单里的字符。

## 隔离规则

底层 key 会自动带前缀：

```text
yzforge:<appId>:<channel>:<profile>:<partition>:<key>
```

这意味着：

- `save`、`settings`、`cache` 互相隔离。
- 不同渠道隔离。
- Debug 和 Release profile 隔离。
- 业务代码不用也不应该拼这个前缀。

## 存档边界

`app.storage.save` 只负责把本地存档对象存起来，不负责设计存档模型。

适合放：

- 单机进度。
- 本机最近一次登录信息。
- 离线收益结算时间。
- 新手引导本机状态。

不适合直接放：

- 服务端权威数据的最终真相。
- 多端冲突合并策略。
- 加密、压缩、签名格式。
- 云存档上传下载流程。

这些应该由业务存档系统或 Storage Extension 处理。

## 设置边界

`app.storage.settings` 放本机偏好，不放玩法数值。

适合放：

- 音量。
- 画质。
- 语言。
- 震动。
- 新手提示是否隐藏。

不适合放：

- 关卡数值。
- 活动参数。
- 掉落概率。
- 远程开关。

这些走配置表或服务端。

## 缓存边界

`app.storage.cache` 的原则是：删掉以后游戏仍然能正常恢复。

适合放：

- 接口 etag。
- 可重新请求的公告缓存。
- 下载索引。
- 上次预热资源列表。

不适合放：

- 玩家进度。
- 支付状态。
- 未同步的关键操作。
- 用户设置。

## 快照

`app.snapshot().storage` 会返回三个分区的统计信息：

```ts
const snapshot = app.snapshot().storage;
console.log(snapshot.save.keyCount);
console.log(snapshot.cache.byteSize);
```

快照只暴露 key 数量和字符串体积，不暴露具体存档内容。

## 不要做

不要直接操作底层存储：

```ts
sys.localStorage.setItem('player', json);
window.localStorage.removeItem('cache');
```

不要清全部本地存储：

```ts
sys.localStorage.clear();
```

不要把缓存当存档：

```ts
app.storage.cache.setJson('player', saveData);
```

不要把设置当配置表：

```ts
app.storage.settings.setNumber('monsterHp', 1000);
```

## 提交前检查

涉及本地存储的改动至少跑：

```bash
npm run yzforge:validate:strict
npm run typecheck
```

如果改了 `AppStorage`、校验器或 runtime 模板，再跑：

```bash
npm run yzforge:smoke
```
