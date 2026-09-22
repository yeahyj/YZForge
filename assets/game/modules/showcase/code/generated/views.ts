// 自动生成的模块内部界面合同；import 不加载实现或资源。
import type { ViewKey } from '../../../../../framework/ui/ui-manager';
import type { ShowcasePageParams, ShowcasePageResult } from '../ui/ShowcasePage.types';
import type { UiLabPageParams, UiLabPageResult } from '../ui/UiLabPage.types';
import type { DataLabPageParams, DataLabPageResult } from '../ui/DataLabPage.types';
import type { TimeLabPageParams, TimeLabPageResult } from '../ui/TimeLabPage.types';
import type { AsyncLabPageParams, AsyncLabPageResult } from '../ui/AsyncLabPage.types';
import type { StorageLabPageParams, StorageLabPageResult } from '../ui/StorageLabPage.types';
import type { GuidePageParams, GuidePageResult } from '../ui/GuidePage.types';
import type { ConfirmPopupParams, ConfirmPopupResult } from '../ui/ConfirmPopup.types';
import type { InspectOverlayParams, InspectOverlayResult } from '../ui/InspectOverlay.types';
import type { NoticeToastParams, NoticeToastResult } from '../ui/NoticeToast.types';
import type { ProgressLoadingParams, ProgressLoadingResult } from '../ui/ProgressLoading.types';
import type { VirtualListLabPageParams, VirtualListLabPageResult } from '../ui/VirtualListLabPage.types';
/** showcase 的模块内全部界面引用。 */
export const ShowcaseViews = {
    /** showcase.showcase-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    showcasePage: { id: 'showcase.showcase-page', kind: 'page' } as ViewKey<
        ShowcasePageParams,
        ShowcasePageResult,
        'page'
    >,
    /** showcase.ui-lab-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    uiLabPage: { id: 'showcase.ui-lab-page', kind: 'page' } as ViewKey<UiLabPageParams, UiLabPageResult, 'page'>,
    /** showcase.data-lab-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    dataLabPage: { id: 'showcase.data-lab-page', kind: 'page' } as ViewKey<
        DataLabPageParams,
        DataLabPageResult,
        'page'
    >,
    /** showcase.time-lab-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    timeLabPage: { id: 'showcase.time-lab-page', kind: 'page' } as ViewKey<
        TimeLabPageParams,
        TimeLabPageResult,
        'page'
    >,
    /** showcase.async-lab-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    asyncLabPage: { id: 'showcase.async-lab-page', kind: 'page' } as ViewKey<
        AsyncLabPageParams,
        AsyncLabPageResult,
        'page'
    >,
    /** showcase.storage-lab-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    storageLabPage: { id: 'showcase.storage-lab-page', kind: 'page' } as ViewKey<
        StorageLabPageParams,
        StorageLabPageResult,
        'page'
    >,
    /** showcase.guide-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    guidePage: { id: 'showcase.guide-page', kind: 'page' } as ViewKey<GuidePageParams, GuidePageResult, 'page'>,
    /** showcase.confirm-popup；show.ui.open 等待打开，handle.result 等待最终结果。 */
    confirmPopup: { id: 'showcase.confirm-popup', kind: 'popup' } as ViewKey<
        ConfirmPopupParams,
        ConfirmPopupResult,
        'popup'
    >,
    /** showcase.inspect-overlay；show.ui.open 等待打开，handle.result 等待最终结果。 */
    inspectOverlay: { id: 'showcase.inspect-overlay', kind: 'overlay' } as ViewKey<
        InspectOverlayParams,
        InspectOverlayResult,
        'overlay'
    >,
    /** showcase.notice-toast；show.ui.open 等待打开，handle.result 等待最终结果。 */
    noticeToast: { id: 'showcase.notice-toast', kind: 'toast' } as ViewKey<
        NoticeToastParams,
        NoticeToastResult,
        'toast'
    >,
    /** showcase.progress-loading；show.ui.open 等待打开，handle.result 等待最终结果。 */
    progressLoading: { id: 'showcase.progress-loading', kind: 'loading' } as ViewKey<
        ProgressLoadingParams,
        ProgressLoadingResult,
        'loading'
    >,
    /** showcase.virtual-list-lab-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    virtualListLabPage: { id: 'showcase.virtual-list-lab-page', kind: 'page' } as ViewKey<
        VirtualListLabPageParams,
        VirtualListLabPageResult,
        'page'
    >,
} as const;
