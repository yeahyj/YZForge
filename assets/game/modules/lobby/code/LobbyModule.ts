import type { ModuleContext } from '../../../../framework/modules/module-manager';
/**
 * 演示模块业务工厂，首次 use/打开所属 UI 时按需执行，同一代实例由外部持有者共享。
 * @param ctx - 模块上下文；新增共享服务可在此创建，并通过 ctx.scope.defer 登记清理。
 * @returns 对外 API；当前示例只暴露模块 ID。
 */
export function createLobbyModule(ctx: ModuleContext) {
    return {
        api: {
            get moduleId() {
                return ctx.id;
            },
        },
    };
}
