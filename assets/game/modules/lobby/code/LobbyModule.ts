import type { ModuleContext } from '../../../../framework/modules/module-manager';
export function createLobbyModule(ctx: ModuleContext) {
    return {
        api: {
            get moduleId() {
                return ctx.id;
            },
        },
    };
}
