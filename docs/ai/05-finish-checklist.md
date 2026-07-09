# 收尾检查

AI 完成任务前按顺序检查：

```bash
npm run yzforge:ai:context
npm run yzforge:ai:doctor
```

如果改了配置表，还要确认：

```bash
npm run yzforge:config:check
```

如果改了生成规则、目录结构、runtime 或 editor 工具，还要运行：

```bash
npm run yzforge:smoke
```

提交前确认：

- 没有手改 generated。
- 没有手写动态资源路径。
- 没有跨 Scope 私有 import。
- 新增能力有文档或 AI 手册更新。
- 涉及启动渠道或 Debug/Release 行为时，检查 `assets/app/main/AppBootSettings.ts` 和 `app.boot`，不要写进业务配置表。
- 涉及每日刷新、倒计时、冷却、离线收益或跨月判断时，使用 `app.clock`，不要在业务逻辑里散落 `Date.now()`。
