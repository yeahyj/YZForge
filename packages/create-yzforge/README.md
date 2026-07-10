# create-yzforge

`create-yzforge` 是 YZForge 的项目创建器。发布到 npm 后，可以用它创建新的 Cocos Creator 项目：

```bash
npx create-yzforge@latest MyGame
```

创建完成后：

```bash
cd MyGame
npm run yzforge:ai:doctor
```

然后用 Cocos Creator 3.8.8 打开项目根目录。

## 开发期本地测试

在 YZForge 仓库里可以直接使用当前工作区作为模板：

```bash
node packages/create-yzforge/bin/create-yzforge.js ../MyGame --template . --skip-install
```

## 常用选项

| 选项 | 作用 |
| --- | --- |
| `--template <path>` | 从本地模板创建项目，适合框架开发期验证 |
| `--repo <git-url>` | 指定模板 Git 仓库 |
| `--ref <git-ref>` | 指定模板分支或 tag，默认 `main` |
| `--skip-install` | 只复制项目，不执行依赖安装 |
| `--package-manager <pm>` | 使用 `npm`、`pnpm` 或 `yarn` |
| `--git` | 创建后执行 `git init` |

`create-yzforge` 只负责第一次创建项目。项目创建后，日常创建 Module、View、配置表和升级框架，继续使用项目内的 YZForge 插件和 `npm run yzforge:*` 命令。
