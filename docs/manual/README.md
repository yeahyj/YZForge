# 使用手册

这些文档面向日常开发。你不需要先理解完整架构，也可以按这里的流程开始写功能。

## 推荐阅读顺序

1. [框架使用手册](./framework.md)
2. [配置表使用手册](./config-table.md)
3. [UI 与 Prefab 流程](./ui.md)
4. [本地存储](./storage.md)
5. [时间与刷新周期](./clock.md)
6. [AI 开发手册](./ai-development.md)

## 一句话规则

- 可进入功能用 `Module`。
- 多模块复用的领域能力用 `Library`。
- 模块解释的内容资源用 `ContentPack`。
- 跨模块只走生成的 Ref 和 Contract。
- 显式加载资源走生成的 `assets.ts`。
- 配置表读取走生成的 `config.ts`。
- 时间逻辑走 `app.clock`。
- 本地数据走 `app.storage.save/settings/cache`。
- `code/generated/*` 不手改。
