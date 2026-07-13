# create-yzforge

`create-yzforge` 是 YZForge 的项目创建器，可以用它创建新的 Cocos Creator 项目：

```bash
npx create-yzforge@latest MyGame
```

也可以使用等价的 npm create 写法：

```bash
npm create yzforge@latest MyGame
```

创建完成后：

```bash
cd MyGame
npm run yzforge:check
```

然后用 Cocos Creator 3.8.8 打开项目根目录。

创建器只会复制 `extensions/yzforge`，模板维护者自用的其他 Cocos 插件不会进入新项目。

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
| `--ref <git-ref>` | 显式覆盖模板 tag；默认固定为与 create-yzforge 包版本一致的 `v<version>` |
| `--skip-install` | 只复制项目，不执行依赖安装 |
| `--package-manager <pm>` | 使用 `npm`、`pnpm` 或 `yarn` |
| `--git` | 创建后执行 `git init` |

`create-yzforge` 只负责第一次创建项目。项目创建后，日常创建 Module、View、配置表和升级框架，继续使用项目内的 YZForge 插件和 `npm run yzforge:*` 命令。
