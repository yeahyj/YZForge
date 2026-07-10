# 创建项目

YZForge 有两类命令，名字相近但职责不同：

| 命令 | 用途 |
| --- | --- |
| `create-yzforge` | 第一次创建一个新的 YZForge Cocos 项目 |
| `npm run yzforge:create` | 在已有项目里创建 Module、Library、View、Part、Model、Service、Flow |
| `npm run yzforge:update` | 已有项目拿到新版框架后，执行迁移和生成同步 |

## 推荐方式

新项目推荐直接使用已经发布到 npm 的创建器：

```bash
npx create-yzforge@latest MyGame
cd MyGame
npm run yzforge:ai:doctor
```

也可以使用等价的 npm create 写法：

```bash
npm create yzforge@latest MyGame
```

然后用 Cocos Creator 3.8.8 打开 `MyGame` 目录。

## 源码方式

如果要测试 GitHub 上的最新源码，或者验证本地未发布改动，可以从仓库源码创建：

```bash
git clone https://github.com/yeahyj/YZForge.git
cd YZForge
node packages/create-yzforge/bin/create-yzforge.js ../MyGame --template . --skip-install
cd ../MyGame
npm install
npm run yzforge:ai:doctor
```

也可以继续用传统方式直接克隆框架仓库作为项目起点：

```bash
git clone https://github.com/yeahyj/YZForge.git MyGame
cd MyGame
npm install
npm run yzforge:ai:doctor
```

## 创建器会做什么

`create-yzforge` 会：

1. 从 YZForge 模板复制 Cocos 项目。
2. 跳过 `node_modules`、`library`、`temp`、`local`、`build` 等本机产物。
3. 把根 `package.json` 的 `name` 改成项目名。
4. 生成新的 Cocos 项目 `uuid`。
5. 初始化 `.yzforge/framework-lock.json`。
6. 默认执行依赖安装。

它不会在创建时改业务模块结构，也不会自动删除示例模块。创建完成后，你可以用 `YZForge -> 创建` 面板或 `npm run yzforge:create` 开始添加自己的业务模块。

## 常用参数

```bash
npx create-yzforge@latest MyGame --skip-install
npx create-yzforge@latest MyGame --package-manager pnpm
npx create-yzforge@latest MyGame
npx create-yzforge@latest MyGame --git
```

框架仍处于早期开发阶段。创建新项目建议固定明确的发布版本或 tag；已有项目升级前先提交 Git，再执行 `npm run yzforge:update:check` 和 `npm run yzforge:update`。
