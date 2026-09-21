// 根据 module.json 自动生成应用装配。
import type { ModuleDefinition } from '../../../framework/modules/module-manager';
import type { ViewDefinition } from '../../../framework/ui/ui-manager';
import { createLobbyModule as factoryLobby } from '../../modules/lobby/code/LobbyModule';
/** 模块装配列表；登记或加载工厂代码不等于执行业务初始化，首次 use 才初始化。 */
export const modules: readonly ModuleDefinition[] = [{ id: 'lobby', dependencies: [], factory: factoryLobby }];
/** UI 装配列表，供 App 创建 UIManager；业务通过生成的 ViewKey 打开界面。 */
export const views: readonly ViewDefinition[] = [
    {
        id: 'lobby.dashboard',
        module: 'lobby',
        prefab: {
            id: 'lobby/default/prefab/dashboard',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'lobby.reward-popup',
        module: 'lobby',
        prefab: {
            id: 'lobby/default/prefab/reward-popup',
            type: 'Prefab',
        },
        kind: 'popup',
        cache: 'none',
        duplicate: 'reject',
    },
];
