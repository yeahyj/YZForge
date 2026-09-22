import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import { GuidePageBinding } from './generated/GuidePageBinding';
import { WorkshopViews } from '../../../workshop/contracts/generated/views';
const { ccclass } = _decorator;
/** 运行时说明与真实源码一一对应；详细编辑流程见工作台“示例工作流”。 */
@ccclass('showcase.GuidePage')
export class GuidePage extends GuidePageBinding {
    protected onShow(show: ViewShowContext<void, void>): void {
        const entries: readonly [Button, string][] = [
            [
                this.btnStructure,
                '① 工作台创建模块 workshop\n代码按需分包 code-workshop，资源 m-workshop\n公开合同放 contracts，私有实现放 code\n项目导航只导入生成的 ViewKey。',
            ],
            [
                this.btnConfig,
                '② 配置表：config-source/workshop/tasks.xlsx\n__config 设置导出目标、索引与约束\n__enums 定义 Quality；Tasks 引用 common.economy\n生成 TS 合同与分包 JSON，运行时 config.load。',
            ],
            [
                this.btnService,
                '③ TaskService / WalletService\nService 检查条件、保存状态、发布业务事件\n余额和领取记录一次写入；重复命令不重复发奖\n跨模块经 ProfileApi，不访问别人的私有脚本。',
            ],
            [
                this.btnPresenter,
                '④ WorkflowPagePresenter\n加载表 → 生成模型 → 打开确认弹窗\ncompleted 才提交命令 → 刷新 → 提示\n只依赖渲染 Port，不依赖节点和 Label。',
            ],
            [
                this.btnView,
                '⑤ WorkflowPage / TaskPart\nPage 绑定输入、创建 Part、同步渲染\nPart 接收模型，通过 ID 回传点击\n复杂页面配 Presenter；简单页面可直接组织交互。',
            ],
            [
                this.btnBinding,
                '⑥ 节点命名 lbl_title / btn_claim\n工作台扫描、生成 Binding 并自动写入引用\n业务只编辑 Page / Part；Binding 可重新生成\n用 onShow / onActivate，不覆盖引擎生命周期。',
            ],
            [
                this.btnVerify,
                '⑦ 验证：npm run verify + Cocos 实际预览\n业务测试、资源检查、脚本诊断和构建检查\n实验页可观察取消、失败、恢复和回收\n发布前还需目标小游戏 / 原生设备真机验证。',
            ],
        ];
        show.listen(this.btnBack.node, Button.EventType.CLICK, () => show.ui.back());
        for (const [button, text] of entries)
            show.listen(button.node, Button.EventType.CLICK, () => {
                this.lblOutput.string = text;
            });
        show.listen(
            this.btnWorkflow.node,
            Button.EventType.CLICK,
            async () => {
                await show.ui.pushPage(WorkshopViews.workflowPage, undefined);
            },
            (error) =>
                show.commit(() => {
                    this.lblOutput.string = String(error);
                }),
        );
        this.lblOutput.string =
            '正式流程：创建 → 配置 → 业务 → 交互 → 渲染 → 绑定 → 验证\n左上返回恢复上一页的新 show。\n工作台也提供源码定位、表格与绑定入口。\n完整说明：docs/development-workflow.md';
    }
}
