import type { App } from '../../framework/core/app';
import type { BootContext } from '../../framework/core/boot';
import { LobbyViews } from '../modules/lobby/contracts/generated/views';

/**
 * 项目的业务启动入口；复制框架后在这里选择自己的首屏或登录流程。
 * 当前打开可删除的大厅示例。清理示例时，移除 LobbyViews 导入和下面的 pushPage 调用，
 * 保留空函数即可独立启动框架，再通过工作台删除示例模块。步骤见 docs/copy-project.md。
 * @param app 已装配的应用服务；导入 UI 合同不会提前加载预制体或启动模块业务。
 * @param boot 本次启动尝试，首屏与会话由 boot.scope 持有；异步提交使用 boot.commit。
 * @returns 首屏打开完成；失败应抛出，由框架回收本次尝试并显示启动错误。
 */
export async function startGame(app: App, boot: BootContext): Promise<void> {
    await app.ui.pushPage(LobbyViews.dashboard, { title: 'YZForge' }, boot.scope);
}
