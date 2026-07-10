# 使用手册

这些文档面向日常开发。你不需要先理解完整架构，也可以按这里的流程开始写功能。

在 Cocos 编辑器里，日常创建结构、维护配置表和手动生成可以优先走顶部菜单 `YZForge`；CLI 主要用于提交前检查、CI、脚本和 AI 开发。

## 推荐阅读顺序

1. [创建项目](./create-project.md)
2. [框架使用手册](./framework.md)
3. [框架升级](./framework-upgrade.md)
4. [配置表使用手册](./config-table.md)
5. [UI 与 Prefab 流程](./ui.md)
6. [本地存储](./storage.md)
7. [时间与刷新周期](./clock.md)
8. [AI 开发手册](./ai-development.md)

## 一句话规则

- 可进入功能用 `Module`。
- 多模块复用的领域能力用 `Library`。
- 模块解释的内容资源用 `ContentPack`。
- 跨模块只走生成的 Ref 和 Contract。
- 显式加载资源走生成的 `assets.ts`。
- 配置表读取走生成的 `config.ts`。
- 时间逻辑走 `app.clock`。
- 本地数据走 `app.storage.save/settings/cache`。
- 框架升级前先提交或备份，再运行 `npm run yzforge:update`。
- `code/generated/*` 不手改。
