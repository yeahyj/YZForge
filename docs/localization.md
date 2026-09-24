# 多语言与语言资源包

多语言使用已有 Bundle、资源 Key 和加载生命周期。每个语言目录是一份动态 JSON，保存文案与可选的资源 Key；加载目录不会提前加载其中引用的图片、字体和语音。

## 组织语言资源

小项目可以把所有目录放在默认包；资源较多时，用工作台创建 `lang-en`、`lang-ja` 等资源包，将对应目录、图片、字体、语音放入包内 `dynamic`。共用图片继续放在公共包，通过同一个逻辑 Key 引用。资源包交付方式仍由现有 Bundle 预设管理，不新增语言专用打包系统。

当前示例复用 showcase 的两个包：

| 文件                                                  | 用途                           |
| ----------------------------------------------------- | ------------------------------ |
| `showcase/bundles/default/dynamic/locales/zh-cn.json` | 默认中文，作为缺失项的回退目录 |
| `showcase/bundles/extra/dynamic/locales/en.json`      | 切换英文时按需加载             |
| `game/app/localization.ts`                            | 登记语言与生成的目录 Key       |

目录格式：

```json
{
  "formatVersion": 1,
  "locale": "zh-CN",
  "texts": {
    "home.title": "我的游戏",
    "home.balance": "金币：{count}",
    "home.welcome": "欢迎，{name}"
  },
  "assets": {
    "home.logo": {
      "id": "showcase/default/sprite/icons/alpha/token",
      "type": "SpriteFrame"
    }
  }
}
```

`texts` 使用平铺的命名 Key；上面的图片 Key 是现有示例资源，项目中替换为实际生成的 Key。`assets` 可省略，支持现有资源类型，包括 `Font` 和 `AudioClip`。不同语言的同名资源必须类型一致。

## 登记到应用

在 `GameRoot.appOptions` 提供可选的 `localization`：

```ts
localization: {
    defaultLocale: 'zh-CN',
    catalogs: {
        'zh-CN': ShowcaseRes.json.localesZhCn,
        en: ShowcaseExtraRes.json.localesEn,
    },
},
```

App 创建时只加载默认目录，首次打开页面即可同步查询文本。其他目录在切换时加载；加载 Bundle 不等于下载整个包所有资源。不配置多语言时不加载目录，也不影响原有页面。

新增语言的流程：用工作台创建或选定资源包 → 添加语言 JSON 和资源 → 等待资源 Key 生成 → 在 `catalogs` 登记新语言。修改文案直接编辑 JSON，重新导入后重新预览；无需修改框架、Inspector 或 `game-config.json`。默认语言应覆盖完整文案。

## 页面使用

模块、UIView 和 GameComponent 通过 `ctx.i18n` 访问，应用入口为 `app.i18n`：

```ts
const i18n = this.ctx.i18n;
i18n.subscribe(() => {
    show.commit(() => {
        this.lblTitle.string = i18n.t('home.title');
        this.lblBalance.string = i18n.t('home.balance', { count: 100 });
    });
    void show.run(() => show.assets.setSprite(
        this.sprLogo, i18n.asset('home.logo', 'SpriteFrame'),
    )).catch(error => {
        if (!(error instanceof OperationCancelled)) reportError(error);
    });
}, show.scope);

// show.listen 内：切换任务可取消；成功后的语言由应用持有。
await i18n.setLocale('en', show.scope);
```

`OperationCancelled`、`reportError` 从 `framework/core/errors` 导入；正常取消忽略，其他错误可改为页面自己的显示函数。组件订阅使用 `activation.scope`。订阅立即通知当前语言，之后仅在成功切换时通知，所有者结束自动解绑；回调必须同步，异步资源更新登记到 `show.run` 或 Actions。

- `t(key, parameters?)` 同步取文本，支持 `{name}` 参数以及 `{{` / `}}` 字面大括号。参数值为字符串或有限数字。
- 当前语言缺项 → 默认语言 → Key 本身。空字符串是有效翻译；`has(key)` 可判断当前或默认目录是否包含文本。
- 翻译与默认文案的参数集合必须一致；目录格式、参数集合或资源类型不匹配时拒绝切换。传入文本参数缺失时明确报错。
- `asset(name, type)` 返回当前语言或默认语言的资源 Key，实际图片、字体、语音仍由使用者加载和持有；缺失或类型错误时明确报错。
- `locale` 为当前已提交的语言，`locales` 为已登记语言列表。
- 尚未提交的连续切换只接受最后一次请求；提交前加载失败或调用者取消会保留旧语言。取消不强制中断引擎的共享加载。

切换后释放旧语言目录的持有，默认目录保留用于回退。页面中已加载的资源按各自所有者释放：`setSprite` 成功替换后会归还旧图；直接 `load` 的字体等需用自己的语言子 Scope 管理并在替换后关闭。不会卸载仍被其他界面使用的资源，也不会强制移除引擎 Bundle 缓存。

新语言提交并通知后，切换结果即为成功。旧目录的清理异常单独以 `I18N_PREVIOUS_CLEANUP_FAILED` 上报，不再导致 `setLocale` 拒绝或回退语言；清理期间再次切换或关闭应用也不撤销已提交的结果。切换 Promise 和应用关闭仍等待实际清理结束。

语言偏好是否存档、是否读取设备语言由游戏决定。可复用现有 StorageKey 保存语言，启动业务前校验它属于 `i18n.locales`，再调用 `setLocale(savedLocale, boot.scope)`。框架不改变已有存档命名空间。

当前范围是文本、参数替换、资源映射和语言通知；复数规则、日期/金额的地区格式、富文本转义和从右到左排版需要业务按目标语言接入。字体仍需包含目标语言字形。

## 可交互示例

Bootstrap 首页 → **资源准备、实例池与多语言**。切换中英文时，文案、按钮、实例标题和图标一起变化；英文刻意缺少一条说明，用于观察默认中文回退。

完整示例见 [ResourceLabPage.ts](../assets/game/modules/showcase/code/ui/ResourceLabPage.ts)。验证命令和资源生命周期见 [批量资源与实例池](resources.md#示例与验证)。
