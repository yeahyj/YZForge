// 自动生成的类型化 UI 引用，不导入预制体、组件实现或配置数据。
import type { ViewKey } from '../../../../../framework/ui/ui-manager';
import type { WorkflowPageParams, WorkflowPageResult } from '../../code/ui/WorkflowPage.types';
import type { ClaimPopupParams, ClaimPopupResult } from '../../code/ui/ClaimPopup.types';
/** workshop 的 UI 公开合同；参数与结果类型由各界面 .types.ts 声明，打开时才加载界面。 */
export const WorkshopViews = {
    /** workshop.workflow-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    workflowPage: { id: 'workshop.workflow-page' } as ViewKey<WorkflowPageParams, WorkflowPageResult>,
    /** workshop.claim-popup 的 popup 界面合同；使用 ui.open，通过返回句柄 result 等待结果。 */
    claimPopup: { id: 'workshop.claim-popup' } as ViewKey<ClaimPopupParams, ClaimPopupResult>,
} as const;
