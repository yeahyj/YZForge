import type { App } from '../../framework/core/app';
import type { Lifetime } from '../../framework/core/scope';
import type { DemoNavigation, DemoPage, LabParams } from '../modules/showcase/contracts/demo-navigation';
import { ShowcaseViews } from '../modules/showcase/contracts/generated/views';
import { WorkshopViews } from '../modules/workshop/contracts/generated/views';
import { LobbyViews } from '../modules/lobby/contracts/generated/views';

/** 示例应用的导航组合层。页面依赖能力接口，业务模块互相不导入界面实现。 */
export class ShowcaseNavigation implements DemoNavigation {
    /** @param owner 应用启动会话，覆盖所有页面的导航期限。 */
    constructor(
        private readonly app: App,
        private readonly owner: Lifetime,
    ) {}

    /** 选择类型化路由并压栈，不用上一页即将结束的 show.scope 持有下一页。 */
    async open(page: DemoPage): Promise<void> {
        const params: LabParams = { navigation: this };
        if (page === 'legacy') {
            await this.app.ui.pushPage(LobbyViews.dashboard, { title: '综合示例' }, this.owner);
            return;
        }
        if (page === 'workflow') {
            await this.app.ui.pushPage(WorkshopViews.workflowPage, { inspect: () => this.inspect() }, this.owner);
            return;
        }
        const routes = {
            home: ShowcaseViews.showcasePage,
            ui: ShowcaseViews.uiLabPage,
            data: ShowcaseViews.dataLabPage,
            time: ShowcaseViews.timeLabPage,
            async: ShowcaseViews.asyncLabPage,
            storage: ShowcaseViews.storageLabPage,
            guide: ShowcaseViews.guidePage,
        };
        await this.app.ui.pushPage(routes[page], params, this.owner);
    }

    /** 展示“代码已加载”和“业务实例存活”的区别，以及页面栈与实际资源持有。 */
    inspect() {
        const state = this.app.inspect();
        return {
            pages: state.ui.pages,
            modules: state.modules.map((item) => item.id),
            bundles: state.assets.bundles,
            resourceCount: state.assets.resources.filter((entry) => entry.users > 0).length,
            configCount: state.config.filter((entry) => entry.users > 0).length,
            configDrainingCount: state.config.filter((entry) => entry.users === 0).length,
            workshopCodeReady: this.app.modules.isCodeReady('workshop'),
            workshopBusinessReady: this.app.modules.isReady('workshop'),
        };
    }
}
