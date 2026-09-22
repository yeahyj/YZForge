// 自动生成的公开界面合同；import 不加载实现或资源。
import type { ViewKey } from '../../../../../framework/ui/ui-manager';
import type { DashboardParams, DashboardResult } from '../../code/ui/Dashboard.types';
/** lobby 的明确公开界面引用。 */
export const LobbyViews = {
    /** lobby.dashboard；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    dashboard: { id: 'lobby.dashboard', kind: 'page' } as ViewKey<DashboardParams, DashboardResult, 'page'>,
} as const;
