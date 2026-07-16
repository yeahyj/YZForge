# 07. 生成文件

`code/generated/`、`*.generated.ts`、`manifest.generated.json` 和配置导出的 JSON 都是生成物。原则很简单：不手改，改源头，然后重新生成。

## 常见生成物

```text
assets/app/registry/**/*.generated.ts
assets/app/contracts/**/*.generated.ts
assets/app/bootstrap/install.generated.ts
assets/app/global/code/generated/*.ts
assets/modules/<Module>/code/generated/*.ts
assets/libraries/<Library>/code/generated/*.ts
assets/content-packs/<Owner>/<Pack>/manifest.generated.json
assets/**/res/content/config/*.json
import-map.json
tsconfig.json
package.json
```

配置表相关源头是：

```text
config-source/excel/**/*.xlsx
config-source/export-plan.json
```

## 怎么判断

以 `*.generated.ts` 命名或位于 `code/generated/` 的 TS 文件就是生成物。

配置 JSON 会带 `_yzforgeConfig` 元信息：

```json
{
  "_yzforgeConfig": {
    "schemaVersion": 1,
    "source": "config-source/excel/Battle.xlsx",
    "sheet": "Items"
  },
  "rows": []
}
```

## 改哪里

| 想改什么 | 改源头 |
| --- | --- |
| Module 名称、bundle、依赖 | `module.json` |
| Library 名称、bundle、依赖 | `library.json` |
| 公开参数或 token 类型 | `code/public.ts` |
| 资源清单 | `res/` 下的资源和 prefab |
| UI AutoRefs | Cocos prefab 节点名和组件 |
| ContentPack 元信息 | `content-pack.json` |
| 配置表字段和数据 | `config-source/excel/**/*.xlsx` |
| 配置表归属和导出名 | `config-source/export-plan.json` 或 YZForge 面板 |

然后运行：

```bash
npm run yzforge:generate
npm run yzforge:config:build
```

如果只改配置表，通常跑：

```bash
npm run yzforge:config:build
```

## 检查生成物

```bash
npm run yzforge:generate:check
npm run yzforge:config:check
```

失败说明生成物不是当前源文件的结果。直接运行对应 build/generate，再看 git diff。

## 清理生成物

先预览：

```bash
npm run yzforge:clean:generated:check
```

确认后清理并重新生成：

```bash
npm run yzforge:clean:generated
npm run yzforge:generate
npm run yzforge:config:build
```

默认清理会保护 generated TS。只有非常确定时才勾选或传入“包含 generated TS”。

## 常见误区

- 不要手动改 `hash`。
- 不要在 `code/generated/` 写业务逻辑。
- 不要从别的 Module import 对方的 `generated/assets.ts` 或 `generated/config.ts`。
- 不要手改 `res/content/config/*.json`，它应该来自 Excel 导出。
- 不要把配置系统当数据库；复杂查询应该由 Service 基于配置表构建只读索引。
