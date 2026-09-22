// 自动生成的公开界面合同；import 不加载实现或资源。
import type { ViewKey } from '../../../../../framework/ui/ui-manager';
import type { WorkflowPageParams, WorkflowPageResult } from '../../code/ui/WorkflowPage.types';
/** workshop 的明确公开界面引用。 */
export const WorkshopViews = {
    /** workshop.workflow-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    workflowPage: { id: 'workshop.workflow-page', kind: 'page' } as ViewKey<
        WorkflowPageParams,
        WorkflowPageResult,
        'page'
    >,
} as const;
