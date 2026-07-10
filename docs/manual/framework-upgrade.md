# 框架升级

YZForge 当前仍处于早期开发阶段。现阶段的次版本升级也可能调整目录、生成物、公开接口或开发流程，因此升级前必须先提交 Git，或者完整备份项目。

## 升级解决什么问题

业务项目会记录自己已经应用的 YZForge 版本：

```text
.yzforge/framework-lock.json
```

当项目拿到新版 YZForge 后，升级器会：

1. 比较项目版本锁与当前安装的框架版本。
2. 按版本顺序执行 `extensions/yzforge/migrations` 中的迁移。
3. 重新同步 runtime、生成入口、import map、TypeScript 配置和 npm 脚本。
4. 运行 YZForge 健康检查。
5. 检查通过后更新框架版本锁，并输出实际改动和迁移记录。

升级器不会在缺少迁移路径时强行继续，也不支持静默降级。

版本锁只会在迁移、生成同步和健康检查全部通过后推进。升级脚本按可重复执行设计；如果过程失败，修复问题后可以重新运行。

## 两步升级模型

框架更新分为两步：

1. 通过 YZForge 发布包、Git 更新或未来的包管理渠道，先把新版 `extensions/yzforge` 和框架源文件放进项目。
2. 再执行项目迁移，让现有业务工程适配这个已安装版本。

插件里的“升级框架”负责第 2 步。它不会在 Cocos 运行期间联网覆盖自身代码，这样可以避免下载中断、版本来源不明或插件自更新到一半导致项目损坏。

## 插件操作

打开 Cocos Creator：

```text
YZForge -> 仪表盘 -> 框架
```

- `升级检查`：只报告版本锁、迁移和生成物是否需要变化，不写文件。
- `升级框架`：执行迁移、同步生成物并运行健康检查。

也可以直接使用顶部菜单：

```text
YZForge -> 升级框架
```

建议先点“升级检查”阅读结果，再执行升级。

## CLI 操作

只检查：

```bash
npm run yzforge:update:check
```

执行升级：

```bash
npm run yzforge:update
```

需要排查工具链时，可以暂时跳过部分后置检查：

```bash
npm run yzforge:update -- --no-doctor
npm run yzforge:update -- --no-typecheck
```

这些参数只用于定位问题，不能代替提交前的完整检查。

## 版本锁

`.yzforge/framework-lock.json` 是项目状态，不是本机缓存，应提交到 Git。示例：

```json
{
  "schemaVersion": 1,
  "framework": "YZForge",
  "version": "0.1.0",
  "channel": "development",
  "source": {
    "kind": "local-extension",
    "package": "extensions/yzforge/package.json"
  }
}
```

不要手改版本号来跳过迁移。版本锁只由升级器更新。

## 开发期约定

- 每个发布版本都必须更新 `extensions/yzforge/package.json` 的版本号。
- 破坏项目结构的版本必须提供连续迁移脚本。
- 升级器只改框架拥有的结构和生成物，不应猜测性重写业务代码。
- 升级后检查 `git diff`，再运行 `npm run yzforge:smoke`。
- 团队成员应在同一次提交中提交版本锁、迁移结果和必要的业务适配。

等框架进入稳定阶段后，再按语义化版本收紧兼容承诺；在此之前，文档和升级结果会明确保留“可能包含破坏性修改”的提示。
