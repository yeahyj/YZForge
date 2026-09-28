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
        'm-showcase': {
            id: 'm-showcase',
            namespace: 'showcase/default',
            dependencies: [],
        },
        'showcase-extra': {
            id: 'showcase-extra',
            namespace: 'showcase/extra',
            dependencies: [],
        },
        'showcase-default-zh-cn': {
            id: 'showcase-default-zh-cn',
            namespace: 'showcase/default-zh-cn',
            dependencies: [],
        },
        'showcase-default-en': {
            id: 'showcase-default-en',
            namespace: 'showcase/default-en',
            dependencies: [],
        },
        'm-workshop': {
            id: 'm-workshop',
            namespace: 'workshop/default',
            dependencies: [],
        },
        'code-workshop': {
            id: 'code-workshop',
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
        'showcase/default': {
            bundle: 'm-showcase',
            path: 'yz-index',
        },
        'showcase/extra': {
            bundle: 'showcase-extra',
            path: 'yz-index',
        },
        'showcase/default-zh-cn': {
            bundle: 'showcase-default-zh-cn',
            path: 'yz-index',
        },
        'showcase/default-en': {
            bundle: 'showcase-default-en',
            path: 'yz-index',
        },
        'workshop/default': {
            bundle: 'm-workshop',
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
        'showcase.samples': [
            {
                bundle: 'm-showcase',
                path: 'dynamic/config/samples',
                dataRevision: 'sha256:32cee657e8378a723736851e6790f343a40585bcf245640197ad06de55f04627',
            },
            {
                bundle: 'showcase-extra',
                path: 'dynamic/config/samples',
                dataRevision: 'sha256:d27ec5c3685d598800cd4f369f066f5ca4a81b687d907298d8f2124b57b9d336',
            },
        ],
        'workshop.tasks': [
            {
                bundle: 'm-workshop',
                path: 'dynamic/config/tasks',
                dataRevision: 'sha256:f20a9e26454d58c2e41c097a1a52aa3402957cfce74659bfa92cb95fe08d477c',
            },
        ],
    },
    localization: {
        defaultLocale: 'zh-CN',
        locales: ['zh-CN', 'en'],
        bundles: {
            'm-showcase': {
                namespace: 'showcase/default',
                contract: 'sha256:4c884e918c8c0f46d4f7933b8e80fe3fed04ada0f1f372413203559c287fa8a5',
                catalogs: {
                    'zh-CN': {
                        bundle: 'showcase-default-zh-cn',
                        path: 'yz-locale',
                        revision: 'sha256:1ffdc736f559f74c842a2a1c0e82e8349ab6c721d041830d982f41bff21b742e',
                    },
                    en: {
                        bundle: 'showcase-default-en',
                        path: 'yz-locale',
                        revision: 'sha256:3f96b9878d0d9b29a33791faf232fe297b40c68980d64c87f20adb84223b2c49',
                    },
                },
            },
        },
    },
};
