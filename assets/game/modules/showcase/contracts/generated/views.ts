// 自动生成的类型化 UI 引用，不导入预制体、组件实现或配置数据。
import type { ViewKey } from '../../../../../framework/ui/ui-manager';
import type { ShowcasePageParams, ShowcasePageResult } from '../../code/ui/ShowcasePage.types';
import type { UiLabPageParams, UiLabPageResult } from '../../code/ui/UiLabPage.types';
import type { DataLabPageParams, DataLabPageResult } from '../../code/ui/DataLabPage.types';
import type { TimeLabPageParams, TimeLabPageResult } from '../../code/ui/TimeLabPage.types';
import type { AsyncLabPageParams, AsyncLabPageResult } from '../../code/ui/AsyncLabPage.types';
import type { StorageLabPageParams, StorageLabPageResult } from '../../code/ui/StorageLabPage.types';
import type { GuidePageParams, GuidePageResult } from '../../code/ui/GuidePage.types';
import type { ConfirmPopupParams, ConfirmPopupResult } from '../../code/ui/ConfirmPopup.types';
import type { InspectOverlayParams, InspectOverlayResult } from '../../code/ui/InspectOverlay.types';
import type { NoticeToastParams, NoticeToastResult } from '../../code/ui/NoticeToast.types';
import type { ProgressLoadingParams, ProgressLoadingResult } from '../../code/ui/ProgressLoading.types';
/** showcase 的 UI 公开合同；参数与结果类型由各界面 .types.ts 声明，打开时才加载界面。 */
export const ShowcaseViews = {
    /** showcase.showcase-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    showcasePage: { id: 'showcase.showcase-page' } as ViewKey<ShowcasePageParams, ShowcasePageResult>,
    /** showcase.ui-lab-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    uiLabPage: { id: 'showcase.ui-lab-page' } as ViewKey<UiLabPageParams, UiLabPageResult>,
    /** showcase.data-lab-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    dataLabPage: { id: 'showcase.data-lab-page' } as ViewKey<DataLabPageParams, DataLabPageResult>,
    /** showcase.time-lab-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    timeLabPage: { id: 'showcase.time-lab-page' } as ViewKey<TimeLabPageParams, TimeLabPageResult>,
    /** showcase.async-lab-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    asyncLabPage: { id: 'showcase.async-lab-page' } as ViewKey<AsyncLabPageParams, AsyncLabPageResult>,
    /** showcase.storage-lab-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    storageLabPage: { id: 'showcase.storage-lab-page' } as ViewKey<StorageLabPageParams, StorageLabPageResult>,
    /** showcase.guide-page 的 page 界面合同；页面导航使用 ui.pushPage，通过返回句柄 result 等待结果。 */
    guidePage: { id: 'showcase.guide-page' } as ViewKey<GuidePageParams, GuidePageResult>,
    /** showcase.confirm-popup 的 popup 界面合同；使用 ui.open，通过返回句柄 result 等待结果。 */
    confirmPopup: { id: 'showcase.confirm-popup' } as ViewKey<ConfirmPopupParams, ConfirmPopupResult>,
    /** showcase.inspect-overlay 的 overlay 界面合同；使用 ui.open，通过返回句柄 result 等待结果。 */
    inspectOverlay: { id: 'showcase.inspect-overlay' } as ViewKey<InspectOverlayParams, InspectOverlayResult>,
    /** showcase.notice-toast 的 toast 界面合同；使用 ui.open，通过返回句柄 result 等待结果。 */
    noticeToast: { id: 'showcase.notice-toast' } as ViewKey<NoticeToastParams, NoticeToastResult>,
    /** showcase.progress-loading 的 loading 界面合同；使用 ui.open，通过返回句柄 result 等待结果。 */
    progressLoading: { id: 'showcase.progress-loading' } as ViewKey<ProgressLoadingParams, ProgressLoadingResult>,
} as const;
