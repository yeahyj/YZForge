// 自动生成的发布快照；切换发布版本需要重启游戏运行时。
import type { ContentRelease } from '../../../framework/assets/asset-types';
/** 当前发布的 Bundle、动态索引及配置路由；由 App 装配使用，运行中不修改。 */
export const release: ContentRelease = {
    releaseId: 'dev-20260920',
    bundles: {
        'm-common': {
            id: 'm-common',
            namespace: 'common/default',
            dependencies: [],
        },
        'm-lobby': {
            id: 'm-lobby',
            namespace: 'lobby/default',
            dependencies: [],
        },
    },
    namespaces: {
        'common/default': {
            bundle: 'm-common',
            path: 'yz-index',
        },
        'lobby/default': {
            bundle: 'm-lobby',
            path: 'yz-index',
        },
    },
    tables: {
        'common.economy': [
            {
                bundle: 'm-common',
                path: 'dynamic/config/economy',
                dataRevision: 'sha256:8f2125fbc3774ab99d31cc739e25c8877d6cecb6627fee1ed179260ae04efb52',
            },
        ],
        'lobby.items': [
            {
                bundle: 'm-lobby',
                path: 'dynamic/config/items',
                dataRevision: 'sha256:68821a6513140031db77adb219a6231b7591176e2c6163d4a3d60f4970ff8c60',
            },
        ],
    },
};
