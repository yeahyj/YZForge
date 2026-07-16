# 16. YZForge V2 验收标准

## 必须通过的命令

```bash
npm run yzforge:generate:check
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
npm run yzforge:validate:build-matrix
npm run yzforge:ai:doctor
```

## Runtime 硬验收

- ReleaseScope identity 包含 generation，同路径重复创建不会产生相同 id。
- 子 Scope 独立释放后从父 Scope 活动 children 中移除。
- Ledger 保留历史 released scope，旧泄漏不会被新 generation 覆盖。
- Library 每次 acquire 返回独立 lease，release 不影响其他 owner。
- Module 的共享 record 与调用方 lease 分离；旧 lease 不能卸载新 generation。
- Module load 任意一步失败时，UI、unit lifecycle、assets、libraries、bundle 全部尝试释放。
- View `beforeOpen`、`onOpen` 任意一步失败时，disposer 被执行，结果被 cancel，Node 和 asset 被释放。
- Part 通过 `PartLease` 持有，初始化失败与 release 都覆盖 lifecycle、Node 和 prefab asset。
- ContentPack 每次 load 都有独立 lease asset scope；释放一个 lease 不影响同 record 的其他 Node、asset 或 Part。
- ContentPack 特殊表现只通过声明式 capability id + 精确 version 请求；缺失、版本不符或非 Prefab 请求必须回滚加载，不能执行内容包提供的脚本。
- Navigator enter/back/unload 串行化；rollback failure 进入结构化 snapshot。
- ContentPack 的运行时路径来自 manifest，不来自 TypeScript ref 中的路径副本。

## Public API 硬验收

- `yzforge` 不导出 Kernel controller 和 registry。
- `yzforge/authoring` 只允许 generated 文件和框架内部导入。
- `app.viewport` 和 `app.lifecycle` 是只读 capability。
- Module、View 的 runtime control method 不出现在业务 public API。
- Entry snapshot 分别报告 script resident 与 resource bundle resident。

## Generator 硬验收

- descriptor 引用正式 JSON Schema。
- 生成器先建立完整 write/delete plan，再验证，再原子提交。
- `tsconfig.yzforge.json` 是生成物，用户 `tsconfig.json` 不被整文件重写。
- package.json 和 import-map.json 保留非 YZForge 字段。
- 重复生成无 diff；故障注入不会留下半生成文件。
- `create-yzforge@x.y.z` 默认使用固定 `vx.y.z` 模板或随包归档。

## 测试结构硬验收

- Validator 规则按领域拆分，不继续集中增长在单一文件。
- runtime unit test、fixture validation、failure injection、Cocos build evidence 分层运行。
- CI 至少执行 generate check、config check、strict validate、typecheck 和 smoke。
