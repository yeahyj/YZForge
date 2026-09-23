# HTTP 请求与取消

框架入口为 `ctx.http` / `app.http`，实现位于 `assets/framework/network`。提供文本请求、JSON 验证、独立超时、Scope 取消和平台适配；当前范围是 HTTP，不包含 WebSocket、登录协议、消息推送或自动重连。

## 请求和业务验证

```ts
import { jsonBody } from '路径/framework/network';

await show.actions.latest('profile-query', async task => {
    const profile = await this.ctx.http.json(
        { url: 'https://api.example.com/profile', query: { id: 42 } },
        task.scope,
        value => {
            if (!value || typeof value !== 'object' ||
                typeof (value as { name?: unknown }).name !== 'string') {
                throw Error('缺少 name 字符串');
            }
            return value as { name: string };
        },
    );
    task.commit(() => { this.lblName.string = profile.name; });
});

// 写入请求不自动重试；幂等键与完成确认由业务协议决定。
await show.actions.exclusive('claim', async task => {
    const response = await this.ctx.http.request({
        url: 'https://api.example.com/reward',
        method: 'POST',
        ...jsonBody({ rewardId: 42 }),
    }, task.scope);
});
```

`request` 接受全部 2xx，返回 `{ status, headers, body }`；响应头使用小写键，正文是字符串。`json` 将正文解析成 `unknown` 后交给同步 `decode`，空正文（例如 204）传 `undefined`。泛型不代替运行时验证，异步 decode 会被拒绝。业务请求错误可按 `error.code` 处理；界面回写仍使用 `task.commit`。

| 请求字段    | 默认值和约束                                                               |
| ----------- | -------------------------------------------------------------------------- |
| `url`       | 完整 http(s) URL，或配置 baseUrl 后的相对路径；禁止 URL 凭据、片段和反斜杠 |
| `method`    | GET；支持 HEAD / POST / PUT / PATCH / DELETE / OPTIONS                     |
| `query`     | 字符串、有限数字、布尔值；undefined 忽略，自动编码后追加                   |
| `headers`   | 覆盖同名默认头，名称大小写无关                                             |
| `body`      | 已编码文本，GET/HEAD 禁止正文；JSON 使用 jsonBody                          |
| `timeoutMs` | 默认 10000 毫秒，最大 2147483647，必须为正数                               |

若 `jsonBody` 之后另行提供 `headers`，应合并其 Content-Type，避免对象展开时覆盖。取消只是停止等待和尽可能中止传输，不能证明服务端没有处理写入请求。

## 装配与平台

App 默认将当前游戏设置的 `apiBaseUrl` 作为 HTTP 地址前缀，来源见 [游戏设置与 SDK](game-settings-sdk.md)。`AppOptions.http` 可覆盖 `baseUrl`、默认头、超时、计时器和 `transport`。省略 transport 时依次选择 `wx.request`、`tt.request`、`XMLHttpRequest`；没有可用适配器时首次请求报 `HTTP_TRANSPORT_UNAVAILABLE`。创建 HTTP 客户端本身不联网，也可单独创建：

```ts
const http = new HttpClient({
    baseUrl: 'https://api.example.com/v1',
    transport: createPlatformHttpTransport(),
    timeoutMs: 8000,
});
// /profile 与 profile 都相对于 v1 前缀追加，不采用 URL 根目录解析。
const response = await http.request({ url: '/profile' }, owner);
```

配置 baseUrl 后只允许同源请求；不同服务创建不同客户端。默认头在构造时复制，账号凭据变化时重新装配客户端或显式提供本次请求头。框架不实现自动令牌刷新，也不自动发送失败请求第二次。

- `createXhrTransport(factory?, withCredentials = false)`：支持浏览器和提供 XHR 的宿主；取消调用 `abort` 并解除回调。跨站 Cookie 默认关闭，浏览器同源 Cookie 仍遵守 XHR 自身规则。
- `createWechatTransport(api)`：注入 `wx.request` 合同，自动选择抖音宿主时也用该合同适配 `tt.request`；强制文本响应，取消调用 RequestTask.abort。业务仍需配置平台合法域名。
- `HttpTransport.send(request, signal)`：自定义平台/测试传输合同。应响应取消、清理回调，不持有 UI；即使适配器忽略取消，客户端也不会将迟到结果交付给旧调用方。

每次请求独立创建子 Scope，完成/超时/取消都会归还；一个请求取消不影响其他请求。超时使用宿主计时器，后台唤醒可能延迟。`inspect().pending` 统计仍在等待的请求，不代表宿主仍在下载的数据量。

| 错误码                 | 含义                                 |
| ---------------------- | ------------------------------------ |
| `HTTP_REQUEST_INVALID` | 发送前配置校验失败（FrameworkError） |
| `HTTP_STATUS`          | 非 2xx，HttpError.status 提供状态码  |
| `HTTP_NETWORK`         | 连接失败或无效传输响应               |
| `HTTP_TIMEOUT`         | 本次请求超时                         |
| `HTTP_DECODE`          | JSON 语法或结构校验失败              |
| `OPERATION_CANCELLED`  | owner 结束或被 latest 取代           |

错误详情不复制 URL、请求头或响应正文。响应中敏感内容的展示和日志由业务控制。

## 可运行示例

进入“UI 与 Part → 网络 / 请求与取消”：先体验明确标注的模拟成功、503、超时及取消。真实请求示例要求返回 `{ "message": "..." }`。在项目根目录启动本机服务：

```sh
node tests/integration/http-fixture.mjs
```

输入 `http://127.0.0.1:8787/health` 点击“真实 HTTP GET”。测试服务仅监听回环地址，Ctrl+C 停止；`/failure` 返回 503，`/invalid` 返回无效 JSON，`/slow` 延迟响应。远程服务的 CORS、HTTPS 和平台域名限制仍由对应宿主执行。

`tests/network.test.ts` 验证请求编码、错误分类、超时、并发取消、迟到结果以及 XHR/微信适配合同。`tests/integration/verify-network-guide.mjs` 启动随机端口的同一服务，通过实际浏览器 XHR 验证请求和关页 abort。微信、抖音和原生设备需要项目接入后单独验证。
