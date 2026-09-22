// 自动生成的公开界面合同；import 不加载实现或资源。
import type { ViewKey } from '../../../../../framework/ui/ui-manager';
import type { ShowcasePageParams, ShowcasePageResult } from '../../code/ui/ShowcasePage.types';
/** showcase 的明确公开界面引用。 */
export const ShowcaseViews = {
    /** showcase.showcase-page；show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。 */
    showcasePage: { id: 'showcase.showcase-page', kind: 'page' } as ViewKey<
        ShowcasePageParams,
        ShowcasePageResult,
        'page'
    >,
} as const;
