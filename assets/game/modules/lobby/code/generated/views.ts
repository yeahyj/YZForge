// 自动生成的模块内部界面合同；import 不加载实现或资源。
import type { ViewKey } from '../../../../../framework/ui/ui-manager';
import type { DashboardParams, DashboardResult } from '../ui/Dashboard.types';
import type { RewardPopupParams, RewardPopupResult } from '../ui/RewardPopup.types';
/** lobby 的模块内全部界面引用。 */
export const LobbyViews = {
    /** lobby.dashboard；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    dashboard: { id: 'lobby.dashboard', kind: 'page' } as ViewKey<DashboardParams, DashboardResult, 'page'>,
    /** lobby.reward-popup；show.ui.open 等待打开，handle.result 等待最终结果。 */
    rewardPopup: { id: 'lobby.reward-popup', kind: 'popup' } as ViewKey<RewardPopupParams, RewardPopupResult, 'popup'>,
} as const;
