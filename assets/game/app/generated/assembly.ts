// 根据 module.json 自动生成应用装配。
import type { ModuleDefinition } from '../../../framework/modules/module-manager';
import type { ViewDefinition } from '../../../framework/ui/ui-manager';
import { createLobbyModule as factoryLobby } from '../../modules/lobby/code/LobbyModule';
import { createProfileModule as factoryProfile } from '../../modules/profile/code/ProfileModule';
import { createShowcaseModule as factoryShowcase } from '../../modules/showcase/code/ShowcaseModule';
/** 模块装配列表；登记或加载工厂代码不等于执行业务初始化，首次 use 才初始化。 */
export const modules: readonly ModuleDefinition[] = [
    { id: 'lobby', dependencies: ['profile'], factory: factoryLobby },
    { id: 'profile', dependencies: [], factory: factoryProfile },
    { id: 'showcase', dependencies: [], factory: factoryShowcase },
    { id: 'workshop', dependencies: ['profile'], codeBundle: 'code-workshop', entryPath: 'entry' },
];
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
    {
        id: 'showcase.showcase-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/showcase-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.ui-lab-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/ui-lab-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.data-lab-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/data-lab-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.time-lab-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/time-lab-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.async-lab-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/async-lab-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.storage-lab-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/storage-lab-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.guide-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/guide-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.confirm-popup',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/confirm-popup',
            type: 'Prefab',
        },
        kind: 'popup',
        cache: 'keep-one',
        duplicate: 'reject',
    },
    {
        id: 'showcase.inspect-overlay',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/inspect-overlay',
            type: 'Prefab',
        },
        kind: 'overlay',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.notice-toast',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/notice-toast',
            type: 'Prefab',
        },
        kind: 'toast',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.progress-loading',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/progress-loading',
            type: 'Prefab',
        },
        kind: 'loading',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'showcase.virtual-list-lab-page',
        module: 'showcase',
        prefab: {
            id: 'showcase/default/prefab/ui/virtual-list-lab-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'workshop.workflow-page',
        module: 'workshop',
        prefab: {
            id: 'workshop/default/prefab/ui/workflow-page',
            type: 'Prefab',
        },
        kind: 'page',
        cache: 'none',
        duplicate: 'reject',
    },
    {
        id: 'workshop.claim-popup',
        module: 'workshop',
        prefab: {
            id: 'workshop/default/prefab/ui/claim-popup',
            type: 'Prefab',
        },
        kind: 'popup',
        cache: 'none',
        duplicate: 'reject',
    },
];
