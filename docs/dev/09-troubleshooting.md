# 09. 常见问题

## 生成物过期

现象：

```text
generated file is stale
hash mismatch
```

处理：

```bash
npm run yzforge:generate
npm run yzforge:generate:check
```

不要手改 generated 文件里的 hash。

## import 被拦截

现象：

```text
forbidden import
module imports another module internal code
library imports module internal code
```

处理：

- 进入另一个功能，用 `ModuleRef`。
- 使用复用能力，抽成 `Library` 并通过 token 使用。
- 共享无状态工具，移到 `shared/code`。
- 只共享类型，放进 `code/public.ts`，从 `yzforge/contracts/...` 导入。

## 找不到 Module 或 Library 入口

现象：

```text
missing code/generated/entry.ts
entry mismatch
module ref does not match entry
```

处理：

1. 检查 `module.json` 或 `library.json` 的 `entry` 是否是 `code/generated/entry.ts`。
2. 运行 `npm run yzforge:generate`。
3. 检查 Cocos Bundle 名是否与描述文件一致。

## 资源没有出现在 assets

处理：

- 确认资源放在 `res/runtime`、`res/view` 或 `res/part`。
- 只被 prefab 间接引用的资源放 `res/content`，默认不会成为普通 asset ref。
- 运行 `npm run yzforge:generate`。
- 检查资源类型是否被生成器支持。

## UI refs 不对

处理：

1. 确认 prefab 根节点挂了对应 View 或 Part 脚本。
2. 确认节点名和组件存在。
3. 保存 prefab。
4. 运行 `npm run yzforge:generate`。
5. 不要手改 `*.refs.generated.ts`。

## Service 打开 UI 被拦截

规则是有意的：Service 写业务规则，Flow 编排 UI。

处理方式：

- Service 发事件或返回结果。
- Flow 调用 Service 后决定打开哪个 UI。
- View 调用 Flow 或触发事件，不直接把流程塞进 Service。

## public.ts 校验失败

常见原因：

- `public.ts` import 了 `cc`。
- 导出了运行时对象。
- 放了业务实现。
- 引用了目标 Bundle 内部实现。

处理：

- `public.ts` 只保留 interface、type 和公开 token map。
- 实现放回当前 Scope 内部。

## Cocos 构建失败但 typecheck 通过

先看是不是本机环境：

- Cocos 是否安装。
- `.yzforge/toolchain.json` 路径是否正确。
- Cocos 版本是否匹配项目。
- `settings/v2/packages/project.json` 是否指向 `project://import-map.json`。

如果环境没问题，再看最近是否改了 import maps、Bundle meta 或生成入口。

## CLI 没有帮助输出

当前 CLI 还没有 `--help`。可用命令以 `package.json` scripts 和本开发文档为准。

后续可以补一个真正的 `yzforge --help`，但在那之前不要按 Node CLI 习惯猜参数。
