'use strict';
// 这是可选示例的阅读导航；不参与通用模块、资源或配置的运行机制。
exports.sources = Object.freeze({
    guide: 'docs/development-workflow.md',
    module: 'assets/game/modules/workshop/module.json',
    service: 'assets/game/modules/workshop/code/services/TaskService.ts',
    wallet: 'assets/game/modules/profile/code/services/WalletService.ts',
    presenter: 'assets/game/modules/workshop/code/ui/WorkflowPagePresenter.ts',
    page: 'assets/game/modules/workshop/code/ui/WorkflowPage.ts',
    part: 'assets/game/modules/workshop/code/components/TaskPart.ts',
    binding: 'assets/game/modules/workshop/code/ui/generated/WorkflowPageBinding.ts',
    contract: 'assets/game/modules/workshop/contracts/generated/config/Tasks.table.ts',
    tests: 'tests/examples/showcase.test.ts',
});
exports.steps = [
    {
        title: '1 · 划分职责与创建模块',
        detail: '看 workshop 的按需代码包、默认资源包和 Profile 依赖；练习时另建自己的模块。',
        sources: [['module', '模块声明']],
        jump: 'create',
        action: '前往创建',
    },
    {
        title: '2 · 编辑 XLSX 与生成合同',
        detail: '任务表含枚举、外键和约束；Samples 另有分片、资源引用与公式。',
        sources: [['contract', '表类型合同']],
        jump: 'tables',
        action: '任务配置表',
    },
    {
        title: '3 · 编写领域 Service',
        detail: '训练条件、存档和重复领取保护放在 Service，输入按钮不能替代业务检查。',
        sources: [
            ['service', '任务 Service'],
            ['wallet', '余额 Service'],
        ],
    },
    {
        title: '4 · 用 Presenter 协调流程',
        detail: '加载数据、打开确认弹窗、执行命令、交给 Port 渲染；不访问节点。',
        sources: [['presenter', 'Presenter 与 Port']],
    },
    {
        title: '5 · Page 与 Part 渲染',
        detail: 'Page 处理界面输入，Part 接收模型和回调；动态 Part 在赋值后激活。',
        sources: [
            ['page', '页面逻辑'],
            ['part', '部件逻辑'],
        ],
    },
    {
        title: '6 · 编辑预制体并自动绑定',
        detail: '节点命名 btn_ / lbl_ / spr_；工作台写入引用，业务不修改生成 Binding。',
        sources: [['binding', '生成的 Binding']],
        jump: 'bindings',
        action: '工作流页面绑定',
    },
    {
        title: '7 · 预览、故障验证与发布',
        detail: '打开 Bootstrap.scene 预览。npm run verify 检查框架，npm run test:showcase 检查示例业务；再做目标平台验证。',
        sources: [
            ['tests', '示例业务测试'],
            ['guide', '完整工作流'],
        ],
    },
];
