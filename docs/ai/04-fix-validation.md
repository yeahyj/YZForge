# 修复校验错误

先运行：

```bash
npm run yzforge:ai:doctor
```

看输出里的 `recommendations`。

## 常见修复

| 问题 | 处理 |
| --- | --- |
| generated stale | 运行 `npm run yzforge:generate` 或 `npm run yzforge:config:build` |
| 手改 generated | 撤掉 generated 改动，改源文件再生成 |
| config 失败 | 改 Excel 或 `config-source/export-plan.json` |
| import boundary | 用 public contract、Library、ContentPack 或 generated refs |
| AutoRef 失败 | 改 prefab 或脚本后运行 `npm run yzforge:generate` |

不要通过放宽 Validator 来“修复”业务错误。
