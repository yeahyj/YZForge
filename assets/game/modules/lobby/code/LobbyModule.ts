import { dependencies } from './generated/dependencies';
import { defineModule } from '../../../../framework/modules/module-manager';
import { LobbyModule } from '../public';
import { LobbyServices } from './LobbyServices';
import { LobbyService } from './services/LobbyService';
/**
 * 演示模块业务工厂，首次 use/打开所属 UI 时按需执行，同一代实例由外部持有者共享。
 * @param ctx - 模块上下文；新增共享服务可在此创建，并通过 ctx.scope.defer 登记清理。
 * @returns 对外 API；当前示例只暴露模块 ID。
 */
export const createLobbyModule = defineModule(LobbyModule, { services: LobbyServices, dependencies }, (ctx, deps) => {
    return {
        services: { lobby: new LobbyService(ctx, deps.profile) },
        api: {
            get moduleId() {
                return ctx.id;
            },
        },
    };
});
