# 游戏设置与 SDK 接入

打开 `assets/game/boot/Bootstrap.scene`，选择 `GameRoot`。`GameSettings` 使用原生 Inspector，只展示四项选择：

| 选项     | 用途                                                |
| -------- | --------------------------------------------------- |
| 游戏版本 | 例如 `1.0.0`，独立于存档数据版本                    |
| 渠道     | 一个具体发行渠道，例如微信自发行、微信发行商 A      |
| 构建模式 | Debug / Release，控制 Creator Debug、日志和性能统计 |
| 服务环境 | Dev / Staging / Prod，选择服务地址和 SDK 参数       |

支持 **Debug + Prod** 和 **Release + Staging**。修改后按 **Ctrl+S 保存场景**，编辑器自动生成配置，等待导入完成后重新启动预览。这里没有额外的保存、生成或构建按钮。

## 配置归属

- 四项选择只保存在 `Bootstrap/GameRoot/GameSettings`；JSON 中没有 `selection`。
- 渠道参数只保存在 [`project-settings/game-config.json`](../project-settings/game-config.json)。可从菜单 **YZForge → 游戏设置 → 打开渠道参数 JSON** 打开。
- `assets/game/app/generated/game-config.ts` 和 `project-settings/generated/game-config.json` 是自动生成的本次运行配置，不手动修改。
- `assets/game/app/generated/channel-options.ts` 是自动生成的下拉列表，只包含渠道 ID 和名称。

组件保存字符串 `channelId`，下拉框的数字序号不序列化。因此增删、重排渠道或修改显示名称，不会把已选渠道变成另一个渠道。删除当前渠道后，重新选择有效渠道并保存；不会自动回退到第一项。

JSON 保存后自动更新下拉列表和运行配置。JSON 不合法时，生成器报错；预览会核对源配置摘要，拒绝使用过期配置启动。构建同样核对保存的场景、配置快照和真实构建选项。四项选择尚未保存或脚本尚未导入完成时，应保存并等待后再预览/构建。

## 新增渠道和修改参数

**同一 SDK 增加发行渠道**：复制 `channels` 中一条完整记录，使用新的稳定 ID，例如 `wechat_partner_b`，修改 `name`、`platformAppId`、广告位和环境参数。`integration` 复用相同接入实现，保存 JSON 后下拉框自动出现新渠道。

**接入新发行 SDK**：实现 `SdkIntegrationFactory`，在 [`assets/game/app/sdk-integrations.ts`](../assets/game/app/sdk-integrations.ts) 的 `sdkIntegrations` 中登记，例如 `partner: createPartnerIntegration`，再将渠道的 `integration` 设为 `partner`。

常用参数位置（以微信自发行为例）：

| JSON 路径                                                | 用途                                             |
| -------------------------------------------------------- | ------------------------------------------------ |
| `channels.wechat_self.platformAppId`                     | 微信小游戏公开 AppID                             |
| `channels.wechat_self.integration`                       | SDK 接入实现；内置 `platform` 直接使用平台能力   |
| `channels.wechat_self.ads.revive`                        | 游戏逻辑广告位 `revive` 对应的实际广告位 ID      |
| `channels.wechat_self.share.default`                     | 默认分享标题、图片                               |
| `channels.wechat_self.environments.prod.apiBaseUrl`      | 正式环境 API 地址                                |
| `channels.wechat_self.environments.prod.resourceBaseUrl` | 供业务远程图片等请求使用的 CDN 根地址            |
| `channels.wechat_self.environments.prod.sdkParameters`   | 正式环境的发行/广告 SDK 公开参数，允许 JSON 对象 |
| `channels.wechat_self.environments.prod.timeoutMs`       | 初始化及普通 SDK 调用超时，广告等待至少 180 秒   |
| `modes.debug` / `modes.release`                          | 日志级别、性能统计开关                           |

现有 Bundle 的位置由发布清单管理，`resourceBaseUrl` 不自动重定位 Bundle。初始地址、AppID、广告位都为空；填写实际参数后才能接入相关在线功能。客户端参数会进入包，服务端密钥不放在这里。

JSON 的 `platforms` 保存平台 ID 对应的 Creator 构建目标列表，第一项是默认导出目标。**接入全新平台**时，在 `sdk-integrations.ts` 的 `sdkPlatforms` 中登记 `id`、实际宿主检测 `isAvailable()`、工厂 `create(config, runtime)`，并在 JSON 的 `platforms` 中配置目标、`channels` 中配置渠道。游戏业务接口无需改变。新宿主如需专用 HTTP 传输，可通过 `AppOptions.http.transport` 接入。

## SDK 组合

游戏只调用 `app.sdk` / `ctx.sdk`。当前渠道的 `integration` 决定采用哪个组合工厂。工厂获得：

- `platform`：已封装的实际平台能力。
- `config`：当前渠道、环境、模式的只读参数。
- `runtime`：真实宿主与是否预览。
- `use(adapter)`：登记依赖 SDK，同一实例只初始化和清理一次。

工厂同步完成组装；初始化先执行平台，再按 `use` 登记顺序执行依赖，最后执行返回的渠道适配器。关闭时逆序清理，等待异步销毁。平台或依赖初始化失败则不继续初始化后续 SDK。适配器使用 `signal` 检查取消；异步初始化及每一步串联之后都应检查，不能在取消后继续提交登录请求。

初始化超时或取消后，调用方会收到失败；App 清理仍等待已经开始的底层初始化结束，再销毁 SDK，避免迟到的资源泄漏。适配器必须让底层初始化最终结束，不能遗留永不完成的 Promise。广告销毁失败也会传递到关闭流程，不会被当作清理成功。

以下是“微信临时凭证 → 发行登录，发行广告接口，微信分享”的接入示意。`createPublisherAdapter` 需按实际供应商 SDK 实现，项目未内置虚构的发行 SDK：

```ts
const createPartnerIntegration: SdkIntegrationFactory = ({ platform, config, use }) => {
    const publisher = use(createPublisherAdapter(config.sdk.parameters));
    return {
        id: 'partner',
        async login(signal) {
            if (!platform.login) throw new SdkError('SDK_UNSUPPORTED', '宿主不支持登录');
            const credential = await platform.login(signal);
            signal.throwIfAborted();
            if (credential.kind !== 'platform' || !credential.code)
                throw new SdkError('SDK_INVALID_RESULT', '缺少平台登录凭证');
            // 按发行方协议返回统一 ChannelCredential；不是游戏服务端会话。
            return publisher.loginWithCode(credential.code, signal);
        },
        rewardedVideo: (id, signal) => publisher.showRewarded(id, signal),
        share: platform.share?.bind(platform),
        vibrate: platform.vibrate?.bind(platform),
        setClipboard: platform.setClipboard?.bind(platform),
        getClipboard: platform.getClipboard?.bind(platform),
    };
};
```

如果发行 SDK 已封装微信登录，渠道的 `login` 直接调用发行 SDK，不再先调用一次 `platform.login`。广告也可以使用另一个 `use(adAdapter)` 登记的服务。调用顺序明确写在 TypeScript 中；JSON 只选实现和传参数。

返回的渠道适配器只委托需要的能力，不用 `{ ...platform }` 复制平台的 `initialize` / `dispose`。第三方实例由 `use` 管理，不再在渠道适配器中重复初始化或销毁它。工厂构造期间应只分配可回收对象，SDK 的异步启动放到 `initialize`。

## 业务接口

```ts
const credential = await ctx.sdk.auth.login(ctx.scope);
// 交给游戏服务端验证并建立游戏会话，不把 SDK 凭证当作游戏登录成功。

if (ctx.sdk.capabilities.rewardedVideo) {
    const result = await ctx.sdk.ads.showRewarded('revive', ctx.scope);
    if (result.status === 'completed' && !result.simulated) {
        // 进入业务奖励确认流程。
    }
}
await ctx.sdk.share.open('default', { room: '123' }, ctx.scope);
await ctx.sdk.system.setClipboard('邀请内容', ctx.scope);
ctx.sdk.lifecycle.onShow((launch) => ctx.log.debug('回到前台', launch.scene), ctx.scope);
```

登录返回 `SdkCredential`：

- `kind: 'platform'`：`provider`、临时 `code` / `anonymousCode`、`simulated`。微信客户端取得 code，服务端交换 openid；openid 本身不是登录令牌。
- `kind: 'channel'`：`provider`、发行方 `userId`、`token`、可选公开结构 `extra`、`simulated`。

激励视频返回 `completed` / `skipped` / `unknown` 与 `completedCount`，不自动发奖；分享只承诺 `invoked`。取消或超时后不交付迟到结果。已展示广告保留监听直至真实关闭，并等异步销毁完成才允许下一次广告；销毁失败后当前适配器拒绝继续创建广告。

内置 wx/tt 适配登录、激励视频、分享、震动、剪贴板、启动参数；前后台事件由 App 统一转发。Web 和原生基础适配只提供可用的系统能力，登录和广告需要具体接入实现。自定义平台必须通过实际宿主检测，配置不会把浏览器伪装成小游戏平台。

## 构建与预览模拟

1. 修改 GameSettings 并 Ctrl+S 保存场景，等待自动生成和脚本导入。
2. 菜单 **YZForge → 游戏设置 → 导出构建参数**，文件位于 `.yzforge/build-configs/<渠道>-<环境>-<模式>.json`。
3. Creator 构建面板导入该文件并构建，也可将文件交给 Creator 命令行 `configPath`。

```sh
npm run game:config -- show
npm run game:config -- build-options
npm run game:config -- build-options --platform web-desktop
```

命令行读取已保存场景，不直接改写 `.scene`。切换配置后重新导出构建参数；旧任务摘要、错误平台、Debug 或 AppID 不匹配都会报错。构建期间配置被冻结，结束时再次校验；产物包含 `yzforge-build.json`，`.yzforge/build-reports` 保存独立记录。

构建期间保存的新配置会排队，锁释放后自动生成，无需再次保存。若本次构建的配置因此发生变化，一致性检查仍会拒绝该产物，需使用新配置重新构建。

编辑器崩溃或重启后若残留构建锁，使用 **YZForge → 游戏设置 → 恢复中断的构建**。恢复会核对 Creator 已空闲、原进程已退出、锁内容未变化，再释放锁并生成配置；不会移除活动进程的锁。命令行可运行 `npm run game:config -- recover-build`，同样检查原进程已退出并与生成/构建互斥。

显式设置 `preview.mockSdk: true` 后重新预览，可模拟整套 SDK，真实发行和广告 SDK 不初始化。`sdk.simulation.nextAd` 支持 `completed` / `skipped` / `error`，默认 `skipped`；`failNextLogin` 模拟一次登录失败。模拟结果始终带 `simulated: true`，构建禁止开启模拟。Debug 模式本身不启用模拟。

## 默认共用存档

存储前缀继续使用 `framework.json` 的 **`appId + ':'`**，不增加渠道、环境、模式或游戏版本；原有存档直接读取。`storage.in(...)` 账号或存档槽仍由业务显式选择。

共用发生在相同宿主存储空间中。不同浏览器域名、微信 AppID 或平台的本地存储本来就不同；跨平台进度需要业务账号和服务端同步。SDK 不保存临时登录凭证或业务令牌，环境间的会话是否通用由后端决定。

## 验证

`npm run verify` 包含 SDK 组合、登录结果、取消/超时、异步广告销毁、配置解析、场景选择和构建一致性检查。真实微信、抖音、第三方 SDK 接入仍需开发者工具或真机、真实 AppID 和广告位联调。

构建 `web_local-prod-debug` 与 `web_local-staging-release` 后，运行 `node tests/integration/serve-build.mjs build`，再用 `node tests/integration/verify-game-settings.mjs <本机 URL>` 检查构建配置和默认共用存档。该检查使用独立临时浏览器存储，并清理自己的测试键。
