// 根据文案工作簿与语言 dynamic 相对路径生成；通过工作台更新。
import type { TextKey, LocalizedAssetKey } from '../../../../../framework/localization/localization';
/** showcase/default 的文案与语言资源合同，不加载任何内容。 */
export const ShowcaseI18n = {
    text: {
        resourcesTitle: {
            namespace: 'showcase/default',
            key: 'resources.title',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesSubtitle: {
            namespace: 'showcase/default',
            key: 'resources.subtitle',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesInfo: {
            namespace: 'showcase/default',
            key: 'resources.info',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: ['fallback'],
        } as TextKey<'fallback'>,
        resourcesFallback: {
            namespace: 'showcase/default',
            key: 'resources.fallback',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesBack: {
            namespace: 'showcase/default',
            key: 'resources.back',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesLoad: {
            namespace: 'showcase/default',
            key: 'resources.load',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesCancel: {
            namespace: 'showcase/default',
            key: 'resources.cancel',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesWarm: {
            namespace: 'showcase/default',
            key: 'resources.warm',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesSpawn: {
            namespace: 'showcase/default',
            key: 'resources.spawn',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesRelease: {
            namespace: 'showcase/default',
            key: 'resources.release',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesLanguage: {
            namespace: 'showcase/default',
            key: 'resources.language',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesProgress: {
            namespace: 'showcase/default',
            key: 'resources.progress',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: ['completed', 'total'],
        } as TextKey<'completed' | 'total'>,
        resourcesReady: {
            namespace: 'showcase/default',
            key: 'resources.ready',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: ['locale'],
        } as TextKey<'locale'>,
        resourcesLoaded: {
            namespace: 'showcase/default',
            key: 'resources.loaded',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        resourcesPool: {
            namespace: 'showcase/default',
            key: 'resources.pool',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: ['borrowed', 'idle', 'size'],
        } as TextKey<'borrowed' | 'idle' | 'size'>,
        resourcesToken: {
            namespace: 'showcase/default',
            key: 'resources.token',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: ['id'],
        } as TextKey<'id'>,
        resourcesCancelled: {
            namespace: 'showcase/default',
            key: 'resources.cancelled',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleTitle: {
            namespace: 'showcase/default',
            key: 'example.title',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleSubtitle: {
            namespace: 'showcase/default',
            key: 'example.subtitle',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleDynamicText: {
            namespace: 'showcase/default',
            key: 'example.dynamicText',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleCounter: {
            namespace: 'showcase/default',
            key: 'example.counter',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: ['count'],
        } as TextKey<'count'>,
        exampleIncrement: {
            namespace: 'showcase/default',
            key: 'example.increment',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleDynamicImage: {
            namespace: 'showcase/default',
            key: 'example.dynamicImage',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleLoad: {
            namespace: 'showcase/default',
            key: 'example.load',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleStaticText: {
            namespace: 'showcase/default',
            key: 'example.staticText',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleWelcome: {
            namespace: 'showcase/default',
            key: 'example.welcome',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: ['name'],
        } as TextKey<'name'>,
        exampleStaticImage: {
            namespace: 'showcase/default',
            key: 'example.staticImage',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
        exampleHelp: {
            namespace: 'showcase/default',
            key: 'example.help',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            parameters: [],
        } as TextKey<never>,
    },
    asset: {
        'images/greeting': {
            namespace: 'showcase/default',
            key: 'images/greeting',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            type: 'SpriteFrame',
        } as LocalizedAssetKey<'SpriteFrame'>,
        'images/logo': {
            namespace: 'showcase/default',
            key: 'images/logo',
            contract: 'sha256:b9629081ee18a21cc01bdabafe47944052d231cebc5bd7c605c21f370cd6df01',
            type: 'SpriteFrame',
        } as LocalizedAssetKey<'SpriteFrame'>,
    },
} as const;
