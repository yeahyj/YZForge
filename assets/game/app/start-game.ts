import type { App } from '../../framework/core/app';
import type { BootContext } from '../../framework/core/boot';
import { ShowcaseViews } from '../modules/showcase/contracts/generated/views';

/**
 * 项目的启动接入点；通过公开界面合同选择首屏，复杂业务调用所属模块的公开 API。
 * 当前打开可删除的功能展示首页。清理示例时移除 ShowcaseViews 导入和下面的调用，
 * 再通过工作台依次清理示例模块。步骤见 docs/copy-project.md。
 * @param app 已装配的应用服务；导入 UI 合同不会提前加载预制体或启动模块业务。
 * @param boot 本次启动尝试，首屏与会话由 boot.scope 持有；异步提交使用 boot.commit。
 * @returns 首屏打开完成；失败应抛出，由框架回收本次尝试并显示启动错误。
 */
export async function startGame(app: App, boot: BootContext): Promise<void> {
    await app.ui.pushPage(ShowcaseViews.showcasePage, undefined, boot.scope);
}
