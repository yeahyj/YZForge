# 10. 提交前检查清单

## 必跑

```bash
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run typecheck
```

如果改了生成器、runtime、目录规则或迁移逻辑，再跑：

```bash
npm run yzforge:smoke
```

如果改了 `create-yzforge` 创建器，再用本地模板创建一次测试项目：

```bash
node packages/create-yzforge/bin/create-yzforge.js ../YZForgeCreateSmoke --template . --skip-install
```

如果改了 Cocos 构建相关内容，再跑：

```bash
npm run yzforge:validate:build-matrix
npm run yzforge:cocos:build:web
```

## 看 diff

提交前看这些点：

- generated 文件变化是否来自真实源文件变化。
- 有没有手写业务代码落进 `code/generated/`。
- 有没有新增旧式 `*.generated.ts` 平铺文件。
- 有没有跨 Module 或跨 Library 内部 import。
- `.meta` 文件是否和新增、移动、删除的 Cocos 资源对应。
- 本机配置 `.yzforge/toolchain.json` 没有被提交。
- 临时日志、插件目录、调试输出没有被提交。

## 新增 Module

- `module.json` 正确。
- `code/public.ts` 只放公开类型。
- 入口 UI 由 Flow 打开。
- 资源通过 `generated/assets.ts`。
- 依赖 Library 已声明。

## 新增 Library

- `library.json` 正确。
- `public.ts` 只放类型和 token map。
- `providers.ts` 绑定公开 token。
- 使用方 Module 已声明依赖。
- 没有外部 import Library 内部代码。

## 新增 UI

- prefab 存在。
- prefab 根节点挂对应 View 或 Part 脚本。
- refs 由生成器生成。
- View 监听用 `this.listen`。
- 打开 UI 走 `module.ui.open` 或 `openForResult`。

## 新增资源或配置

- 显式加载资源放 `res/runtime`。
- UI prefab 放 `res/view`。
- Part prefab 放 `res/part`。
- 间接依赖放 `res/content`。
- 配置原始数据放 `config-source/excel`，`res/content/config` 只放生成后的 JSON。
- 配置访问走 `generated/config.ts`。

## 提交信息

中文提交信息建议写清楚改了哪类东西：

```text
新增：Battle 模块基础流程
修复：生成器识别 UI refs 失败
重构：收敛 Library provider 入口
文档：补充开发帮助文档
```
