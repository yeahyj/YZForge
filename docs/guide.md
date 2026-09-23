# 新手引导与连续聚焦

流程实现位于 `assets/framework/guide`；Cocos 视觉组件为 `assets/framework/ui/components/guide/guide-focus-overlay.ts`。业务决定步骤、目标和完成条件，预制体仍留在业务模块，沿用自动绑定。

## 动画设计

首次进入时，亮区从视口收拢，灰色遮罩柔和渐入；亮区显示原本界面，白色只用于轮廓。切换步骤时保持同一张遮罩，从上一帧的位置、大小和圆角连续变成下一个目标，不重新铺白色，也不先关闭再打开。

形状统一表达为圆角矩形：`circle` 是目标可见矩形的外接圆，`rect` 为零圆角矩形，`rounded-rect` 为指定圆角。三者可双向过渡，默认 0.55 秒 cubic ease-in-out；`duration: 0` 立即定位。矩形跟随目标尺寸，正方形目标自然得到方形镂空。

上一目标点击后，遮罩保留最后一帧，等待业务完成或列表定位。等待及变形期间拦截底层输入；聚焦完成后只放行“真实目标 Button 与镂空形状的交集”。圆角外、圆形包围盒角落及亮区留白仍不能点击其他按钮；跳过按钮在整个显示期可用。引导最终完成、取消、失败或关闭页面时统一释放遮罩。

## 流程与目标注册

```ts
import { GuideRunner, GuideTargets, StorageGuideProgress, type GuideHandle } from '路径/framework/guide';
import { GuideFocusOverlay } from '路径/framework/ui/components/guide/guide-focus-overlay';

const runner = new GuideRunner(new StorageGuideProgress(this.ctx.storage.in(accountId)));
const targets = new GuideTargets<Node>();
targets.register('inventory/open', this.btnOpen.node, show.scope);

// 在按钮回调中启动，每次执行共用一个 presentation。
let handle: GuideHandle | undefined;
const focus = this.nodeFocus.getComponent(GuideFocusOverlay)!;
const presentation = focus.begin(show.scope, () => handle?.skip());
try {
    handle = runner.start({
        id: 'inventory/intro', version: 1, allowSkip: true,
        steps: [
            {
                id: 'open',
                run: async task => {
                    const target = await targets.wait('inventory/open', task.scope);
                    await presentation.waitForClick(target, {
                        message: '打开背包', shape: 'circle',
                    }, task.scope);
                    // 如按钮触发异步业务，在这里继续等待业务成功。
                },
            },
            {
                id: 'claim-42',
                run: async task => {
                    list.scrollToIndex(indexOfReward42, 'center');
                    await list.whenIdle();
                    task.signal.throwIfAborted();
                    const target = await targets.wait('inventory/reward/42', task.scope);
                    await presentation.waitForClick(target, {
                        message: '领取奖励', shape: 'rect', padding: 8,
                    }, task.scope);
                    // 验证领取成功后再返回；框架不会代发点击或奖励。
                },
            },
        ],
    }, show.scope);
    const result = await handle.result;
    // completed / skipped / cancelled；业务异常和持久化失败会拒绝。
} finally {
    presentation.close();
}
```

示例省略业务变量声明；完整代码见 `TutorialLabPage.ts`。`begin` 只创建使用期，首次 `waitForClick` 才显示；已完成引导直接返回时不会闪现。不要每一步都 `begin/close`，也不要把 presentation 绑到单步 Scope，否则失去跨步骤连续性。

虚拟列表在每次 render 时用业务 ID 注册目标：

```ts
targets.register(`inventory/reward/${item.data.id}`, part.node, item.scope);
```

条目刷新、滚出或换数据时，旧 `GuideTarget` 租约立即失效；相同池化 Node 或同名 Key 后续重用，不会让旧引导误指向新条目。先滚动并 `whenIdle`，再等待目标注册。目标必须含 Button，且保持可交互；目标注销、不可见或禁用会结束当前等待，业务可按保存的检查点重新启动。

## API 与生命周期

| API                                                | 约定                                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| `GuideTargets.register(key, value, owner)`         | 同名不可同时注册，返回主动注销函数；随 owner 取消注销 |
| `GuideTargets.wait(key, owner)`                    | 等待注册；取消立即拒绝并删除等待者                    |
| `GuideTargets.get / inspect`                       | 查询目标、注册数与等待者数                            |
| `GuideRunner.start(definition, owner)`             | 一个执行器同时只执行一次，清理期间也拒绝重入          |
| `GuideHandle.cancel / skip`                        | 同步发取消信号；skip 需 allowSkip，保存 skipped       |
| `GuideHandle.result / inspect`                     | 等待清理后的结果；状态 running / draining / ended     |
| `StorageGuideProgress.reset(id)`                   | 清除指定引导；先取消运行并等待 result                 |
| `GuideFocusOverlay.begin(owner, onSkip?)`          | 整次引导视觉使用期，返回 session                      |
| `session.waitForClick(target, options, stepOwner)` | 聚焦并等待真实 CLICK；完成后保留遮罩                  |
| `session.close()`                                  | 幂等释放视觉和监听，恢复输入检测方法                  |

步骤默认超时 30000 毫秒，可用 `timeoutMs` 设置有效正毫秒数。超时只发取消信号，随后等待步骤任务及异步清理退出；不配合取消的 Promise 不会被强杀。异步工作响应 `task.signal`，节点写入使用 `task.commit`，清理登记到 `task.scope.defer`。不能在步骤内等待自身引导的 `result`。

只有步骤业务和清理成功后才保存检查点并开始下一步，保存的是下一步稳定 ID。取消保留最近成功检查点，跳过保存 skipped；版本变化从第一步重启，同版本找不到步骤 ID 会明确报错，需迁移或递增版本。存档错误不会伪装成完成。奖励写入和引导进度不是同一事务，业务操作应支持幂等恢复。

页面内流程使用 show.scope；跨页面流程需要外部会话持有 runner，目标注册仍归各自 show/item Scope，视觉应放在该流程可持续使用的 UI 层。账号隔离通过 `storage.in(accountId)` 完成，切换账号先结束旧引导。

## Creator 预制体配置

可参考 showcase 模块 `TutorialLabPage.prefab`，结构如下，场景和预制体通过当前 Cocos MCP / Creator 修改：

```text
node_focus [UITransform, Widget 四边贴父级, GuideFocusOverlay]
└─ Visual [Widget 四边贴父级；空闲 inactive]
   ├─ HoleMask [Mask: GRAPHICS_STENCIL, inverted=true]
   │  └─ Shade [Graphics]
   ├─ FocusOutline [Graphics]
   ├─ InputShield [UITransform, BlockInputEvents]
   └─ SafeControls [Widget, SafeArea]
      ├─ HintPanel [业务背景和提示 Label]
      └─ Skip [Button]
```

Mask 自带 Graphics，不另加第二个；将对应组件拖入 `holeMask/shade/outline` 字段，再绑定 `visual/inputShield/messageLabel/skipButton`。HintPanel 应拦截自己的输入，提示与跳过区域不要覆盖目标。业务可自行设计提示布局，通用组件不加载业务资源。

Visual、Mask、Shade、Outline 相对父节点使用位置零、旋转零、缩放一；InputShield 必须是 Visual 的直接子节点。组件使用真实正交 UI 相机视口覆盖全面屏额外区域，并临时接管输入层的公开 `UITransform.hitTest`，结束后恢复。组件使用期间不要同时改写该方法。

当前支持同一 Canvas、轴对齐 2D 目标与矩形祖先 Mask 的可见交集；不解析任意多边形 Mask、透视相机、旋转目标或其他页面的覆盖关系。业务须先展示合适页面、滚动目标到位，并让引导层位于需要拦截的业务控件上方。

## 演示与验证

“UI 与 Part → 新手引导 / 聚焦动画”展示：圆形聚焦训练按钮 → 连续移动变形成第 21 项矩形 → 点击领取并保存完成；支持重置、跳过和中断恢复。训练与领取使用本地业务状态，重复领取不会重复发奖。

单元测试覆盖执行顺序、取消排空、超时、跳过、持久化、租约隔离、几何插值和形状命中。`tests/integration/verify-network-guide.mjs` 在实际 Creator 浏览器预览验证物理点击、入口锁定、步骤间保留、半途变形锁定、目标复用中止、恢复/跳过/关闭、长屏和平板尺寸；截图输出到 `temp/mcp-captures/guide-focus-*.png`。微信和原生真机仍需项目接入后验证。
