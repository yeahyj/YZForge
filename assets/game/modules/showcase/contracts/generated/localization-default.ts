// 根据多语言工作簿生成；修改源工作簿后通过工作台生成。
import type { TextKey, LocalizedAssetKey } from '../../../../../framework/localization/localization';
/** showcase/default 的文案与语言资源合同，不加载任何内容。 */
export const ShowcaseI18n = {
    text: {
        resourcesTitle: {
            namespace: 'showcase/default',
            key: 'resources.title',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesSubtitle: {
            namespace: 'showcase/default',
            key: 'resources.subtitle',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesInfo: {
            namespace: 'showcase/default',
            key: 'resources.info',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: ['fallback'],
        } as TextKey<'fallback'>,
        resourcesFallback: {
            namespace: 'showcase/default',
            key: 'resources.fallback',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesBack: {
            namespace: 'showcase/default',
            key: 'resources.back',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesLoad: {
            namespace: 'showcase/default',
            key: 'resources.load',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesCancel: {
            namespace: 'showcase/default',
            key: 'resources.cancel',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesWarm: {
            namespace: 'showcase/default',
            key: 'resources.warm',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesSpawn: {
            namespace: 'showcase/default',
            key: 'resources.spawn',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesRelease: {
            namespace: 'showcase/default',
            key: 'resources.release',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesLanguage: {
            namespace: 'showcase/default',
            key: 'resources.language',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesProgress: {
            namespace: 'showcase/default',
            key: 'resources.progress',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: ['completed', 'total'],
        } as TextKey<'completed' | 'total'>,
        resourcesReady: {
            namespace: 'showcase/default',
            key: 'resources.ready',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: ['locale'],
        } as TextKey<'locale'>,
        resourcesLoaded: {
            namespace: 'showcase/default',
            key: 'resources.loaded',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
        resourcesPool: {
            namespace: 'showcase/default',
            key: 'resources.pool',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: ['borrowed', 'idle', 'size'],
        } as TextKey<'borrowed' | 'idle' | 'size'>,
        resourcesToken: {
            namespace: 'showcase/default',
            key: 'resources.token',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: ['id'],
        } as TextKey<'id'>,
        resourcesCancelled: {
            namespace: 'showcase/default',
            key: 'resources.cancelled',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            parameters: [],
        } as TextKey<never>,
    },
    asset: {
        resourcesLogo: {
            namespace: 'showcase/default',
            key: 'resources.logo',
            contract: 'sha256:724fc60bd9941b9f484066483f883a41998f047227e08177e2fc099b7a1255d3',
            type: 'SpriteFrame',
        } as LocalizedAssetKey<'SpriteFrame'>,
    },
} as const;
