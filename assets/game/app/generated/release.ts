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
                contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
                catalogs: {
                    'zh-CN': {
                        bundle: 'showcase-default-zh-cn',
                        path: 'yz-locale',
                        revision: 'sha256:82214ade125915c9784f74f7694f03a62f518c724eb68cf93b5d6d513386acca',
                    },
                    en: {
                        bundle: 'showcase-default-en',
                        path: 'yz-locale',
                        revision: 'sha256:96bfa0b6c8ab4f8ab41ed26b2a800a9e45b0971dcd9f15894e3fe108571344ee',
                    },
                },
            },
        },
        sources: {
            '5749fee4-a52a-49eb-b411-c95cd8c19e1c': 'showcase/default',
            '721bf3d6-8cd8-487d-b70d-2bd2f7f5ff95': 'showcase/default',
            'f88586bf-6b8f-4204-860c-999fcc980147': 'showcase/default',
            '5bc3950a-6092-4976-ac90-91f99c15cc7c': 'showcase/default',
            '0bfff9dc-4756-4c1e-b895-48ce0610ac2d': 'showcase/default',
            '4fb7e20c-d2f2-40ef-a89b-ae3aadc399b3': 'showcase/default',
            '71c2f9f6-5f41-4c36-8aa4-8b57172ab5fb': 'showcase/default',
            '2a251395-701f-4a7d-aa29-f83593db2173': 'showcase/default',
            '3d12663b-ba91-464d-82c7-d633747950a8': 'showcase/default',
            '12e49999-f446-4638-9250-bee204247220': 'showcase/default',
            '05b72dc8-89c5-4ffc-afa2-ab7c56a991d2': 'showcase/default',
            '2659ac62-9ff7-4bfa-afff-4fb9573832d0': 'showcase/default',
            '1bbad6a1-6f5b-408d-b018-b6ec400ba6b1': 'showcase/default',
            'ec1281e5-c39e-43e6-a8b5-3c4e7ca1257e': 'showcase/default',
            '70da8183-ef80-4310-a7f7-6ea7f755c201': 'showcase/default',
            '970df49b-3931-4db7-a142-41f2ac134736': 'showcase/default',
            '48218f21-46ee-4352-af28-80aaa2f7718b': 'showcase/default',
            'a0eec93b-b3ed-4cbb-8a1b-f6d98ec39cd9': 'showcase/default',
            '3c70358c-8a45-4ee7-8829-7fe9b388aece': 'showcase/default',
        },
    },
};
