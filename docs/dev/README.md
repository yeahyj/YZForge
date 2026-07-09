# YZForge 开发帮助文档

这组文档面向每天写业务的人，回答“现在要做功能，应该改哪里、跑什么、不要碰什么”。架构设计文档解释为什么；开发帮助文档只讲怎么做。

## 最短路径

日常开发通常按这个闭环走：

```text
创建结构
写手写代码
在 Cocos 中维护 prefab 和资源
npm run yzforge:generate
npm run yzforge:validate:strict
npm run typecheck
```

如果改了配置表：

```text
维护 config-source/excel/**/*.xlsx
在 YZForge -> Config Tables 面板保存导出规则，或运行 yzforge:config:table
npm run yzforge:config:build
npm run yzforge:validate:strict
npm run typecheck
```

提交前建议再跑：

```bash
npm run yzforge:generate:check
npm run yzforge:config:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
```

需要真实构建证据时再跑：

```bash
npm run yzforge:validate:build-matrix
npm run yzforge:cocos:build:web
```

## 阅读顺序

1. [00-quick-start.md](./00-quick-start.md)：第一次接手和常用命令。
2. [01-project-layout.md](./01-project-layout.md)：业务代码和资源应该放哪里。
3. [02-create-module.md](./02-create-module.md)：新增一个可进入功能。
4. [03-create-library.md](./03-create-library.md)：新增可复用领域能力。
5. [04-assets-and-config.md](./04-assets-and-config.md)：资源和配置表怎么放、怎么生成、怎么读。
6. [05-ui-prefab-workflow.md](./05-ui-prefab-workflow.md)：UI prefab、View、Part 和 AutoRefs 流程。
7. [06-events-and-contracts.md](./06-events-and-contracts.md)：事件、公开契约和跨 Scope 通信。
8. [07-generated-files.md](./07-generated-files.md)：生成文件规则和修复方式。
9. [08-validation-and-build.md](./08-validation-and-build.md)：校验、类型检查和构建。
10. [09-troubleshooting.md](./09-troubleshooting.md)：常见问题排查。
11. [10-release-checklist.md](./10-release-checklist.md)：提交前检查清单。
12. [11-time-clock.md](./11-time-clock.md)：时间、跨天、跨周、跨月和倒计时。
13. [12-framework-usage-manual.md](./12-framework-usage-manual.md)：框架日常使用手册。
14. [13-config-table-manual.md](./13-config-table-manual.md)：配置表使用手册。

## 一句话原则

- 功能入口用 `Module`。
- 多模块复用的业务能力用 `Library`。
- 纯共享无状态工具放 `shared/code`。
- 全局有状态能力放 `app/global`。
- 资源引用走 `generated/assets.ts`。
- 配置访问走 `generated/config.ts`。
- 跨 Scope 通信走 `contracts`、`registry`、事件或 Library token。
- `code/generated/` 下面的文件不手改。
