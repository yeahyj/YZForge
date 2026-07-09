# 新增 UI

UI 包括 Module View、Global View 和 Part。

## 用命令创建

```bash
npm run yzforge:create -- view PageBattle --owner Battle
npm run yzforge:create -- global-view ToastNotice
npm run yzforge:create -- part PartReward --owner Battle
```

## 资源规则

- View prefab 放 `res/view`。
- Part prefab 放 `res/part`。
- 业务加载 UI 使用生成的 `assets.views` 或 `assets.parts`。
- 不手写 `resources.load`、`bundle.load` 或跨 Scope 路径。
- 创建命令生成的是最小 prefab：根节点和对应脚本。不要假设里面已经有全屏背景或安全区节点。
- 需要全屏背景和安全区内容时，在业务 prefab 内自行拆节点，例如 `Background` + `SafeContent(YZSafeAreaRoot)`。

## AutoRef

Prefab 上的自动引用由生成器维护。不要手改 `refs/*.generated.ts`。

完成后运行：

```bash
npm run yzforge:generate
npm run yzforge:ai:doctor
```
