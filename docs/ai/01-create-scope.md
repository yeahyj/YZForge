# 新增 Scope

Scope 指 Module、Library、ContentPack。

## 用命令创建

```bash
npm run yzforge:create -- module Battle
npm run yzforge:create -- library BattleCore
npm run yzforge:create -- content-pack Level001 --owner Battle
```

## 应该改

- 新 Scope 的 descriptor：`module.json`、`library.json` 或 `content-pack.json`
- 新 Scope 的 `code/**`
- 新 Scope 的 `res/**`

## 不应该改

- `code/generated/**`
- 其他 Scope 的私有 `code/**`
- 其他 Scope 的 `res/**`

## 完成后

```bash
npm run yzforge:generate
npm run yzforge:ai:context
npm run yzforge:ai:doctor
```
