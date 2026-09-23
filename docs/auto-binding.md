# 自动绑定

在节点挂组件并命名，保存预制体后，在 **YZForge 工作台 → 自动绑定** 选择界面或 Part，执行更新绑定。工作台生成 Binding 基类，并通过 Creator 写入序列化引用。业务直接调用 getter，无需手动拖拽，也无需重复 getComponent。

## 命名与类型

| 节点名称        | 节点上挂载            | 生成的 getter 类型 | 使用方式                           |
| --------------- | --------------------- | ------------------ | ---------------------------------- |
| `btn_submit`    | AsyncButton           | AsyncButton        | `this.btnSubmit.run(...)`          |
| `lbl_countdown` | CountdownLabel        | CountdownLabel     | `this.lblCountdown.startFor(60)`   |
| `spr_preview`   | AsyncSprite           | AsyncSprite        | `this.sprPreview.setSource(...)`   |
| `comp_state`    | Switch                | Switch             | `this.compState.updateCheck(1)`    |
| `comp_marquee`  | MarqueeLabel          | MarqueeLabel       | `this.compMarquee.string = '公告'` |
| `comp_item`     | 业务自定义组件或 Part | 实际导出的类       | `this.compItem.render(data)`       |
| `node_content`  | 任意组件              | Node               | `this.nodeContent.active = true`   |

`btn_`、`lbl_`、`spr_` 等原生前缀先按基础类型筛选，然后识别实际挂载的项目脚本子类。普通原生 Button、Label、Sprite 仍生成原生类型。`comp_` 跳过引擎内置组件，只查找自定义脚本；不要求继承 GameComponent。`node_` 始终返回节点。

**同节点有多个匹配组件时，按 Inspector 中的组件顺序取第一个。** `btn_` 只在 Button 及其子类中选择；`comp_` 在自定义组件中选择。调整组件顺序后需要重新更新绑定。若要访问同节点的其他组件，可从已绑定引用调用 getComponent，或按职责放到独立节点。

其余默认前缀是 `edit_`、`scroll_`、`toggle_`、`slider_`、`rich_`。团队可在 `project-settings/framework.json` 的 `bindingPrefixes` 配置基础类型映射；映射到 `Component` 的前缀均遵循自定义组件规则。

后缀以字母开头，可含字母、数字、单下划线。例如 `btn_claim_all` → `btnClaimAll`；不接受连续或末尾下划线。未标记节点不会生成字段。生成后的 getter 名称在当前绑定范围内必须唯一。

## 业务调用

```ts
// 节点分别挂 AsyncButton、CountdownLabel、AsyncSprite、Switch、MarqueeLabel。
await this.btnSubmit.run(async task => {
    const result = await service.submit(task.signal);
    task.commit(() => {
        this.compState.updateCheckByName('content');
        this.compMarquee.string = result.message;
        this.lblCountdown.startFor(60);
    });
});
await this.sprPreview.setSource('icons/alpha/token');
```

实际示例见 [ComponentsLabPage](../assets/game/modules/showcase/code/ui/ComponentsLabPage.ts) 和它的 [生成绑定](../assets/game/modules/showcase/code/ui/generated/ComponentsLabPageBinding.ts)。预制体保留在 showcase 业务模块。

自动绑定只提供引用，不启动组件、不创建订阅，也不改变 Scope、Part 或异步任务的清理规则。页面业务仍使用 onShow/onHide，Part 使用 onActivate/onDeactivate；异步回写继续通过 task.commit/show.commit。

## 脚本与预制体要求

- 自定义组件必须是当前项目 `assets` 中已经编译、可定位的 TypeScript 组件类。支持命名导出、默认导出和 `export { LocalClass as PublicName }`，文件名不必等于类名。
- 通过 Creator 脚本标识与 AssetDB 找到源码，不按 ccclass 注册名猜路径。多个文件导出同名类时，生成器自动为导入添加别名。
- 具体组件使用 `import type`。序列化装饰器仍声明原生基础类型或 Component，实际写入的是选中的组件对象；不会因绑定而额外引入业务模块的运行时代码依赖。
- 扫描包括非激活节点。嵌套预制体只扫描其根节点，不进入内部；内部引用由自身 Part 绑定管理。不要在父界面绑定子预制体的内部节点。
- 移动、改名、增删节点，替换组件、调整组件顺序或修改导出后，重新更新绑定。生成文件会覆盖，业务逻辑应写在派生脚本中。

## 排错与验证

找不到匹配组件、重复 getter 名称、组件未导出或脚本无法定位时，会报告节点/脚本信息。修复后重新编译并更新绑定。多个匹配组件不会报错，固定取第一个。

工作台扫描前和写回前都会检查未保存的场景/预制体编辑；请先保存再更新绑定。写回前还会核对本次生成的编译签名和重新扫描结果，防止脚本尚未更新就写入旧字段。节点结构在生成期间变化会要求重新扫描。检查失败不会清空预制体原有引用。

单元测试：`node --test tests/bindings.test.mjs`。Creator 集成测试：`node tests/integration/verify-workbench.mjs`；通用组件真实浏览器预览：`node tests/integration/verify-ui-components.mjs http://127.0.0.1:7456/`。集成测试需当前项目的 Cocos MCP 已连接。
