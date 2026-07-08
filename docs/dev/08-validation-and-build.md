# 08. 校验与构建

## 日常检查

写完一个小功能：

```bash
npm run yzforge:generate
npm run yzforge:validate:strict
npm run typecheck
```

提交前：

```bash
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
```

需要证明 Cocos 真能构建：

```bash
npm run yzforge:validate:build-matrix
npm run yzforge:cocos:build:web
```

## 每个命令检查什么

| 命令 | 作用 |
| --- | --- |
| `yzforge:generate` | 扫描描述文件、生成 contract、registry、entry、assets、config、import map |
| `yzforge:generate:check` | 检查生成物是否最新，不写文件 |
| `yzforge:validate` | 基础架构校验 |
| `yzforge:validate:strict` | 严格架构校验，提交前默认使用 |
| `typecheck` | 使用项目工具链解析 Cocos 和 TypeScript 类型 |
| `yzforge:smoke` | 在临时项目里跑核心生成、校验和迁移烟测 |
| `yzforge:validate:build-matrix` | 检查 Cocos 构建矩阵配置 |
| `yzforge:cocos:build:web` | 调用 Cocos 构建 Web Desktop |

## 推荐 CI 顺序

```bash
npm run yzforge:generate:check
npm run yzforge:validate:strict
npm run typecheck
npm run yzforge:smoke
```

构建机有 Cocos 环境时再加：

```bash
npm run yzforge:validate:build-matrix
npm run yzforge:cocos:build:web
```

## 本机 Cocos 构建

真实构建依赖本机 Cocos 安装。路径写在：

```text
.yzforge/toolchain.json
```

这个文件不提交。团队可以提交：

```text
.yzforge/toolchain.schema.json
.yzforge/toolchain.example.json
```

如果 Cocos 被删除或移动，`typecheck` 和普通校验可能仍能工作，但 `yzforge:cocos:build:web` 会失败。先修本机 toolchain 配置，再判断框架问题。

## 什么时候跑真实构建

建议跑真实构建的情况：

- 改了 `import-map.json`、`tsconfig`、runtime 同步逻辑。
- 改了 Cocos Bundle、meta、构建矩阵。
- 改了生成器入口和动态 Bundle 注册。
- 准备合并到主分支。
- 怀疑 TypeScript 能过但 Cocos assembly 解析会失败。

普通业务小改可以先跑 generate、validate、typecheck。
