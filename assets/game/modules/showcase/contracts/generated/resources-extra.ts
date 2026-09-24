// 根据 dynamic 目录及稳定资源身份自动生成，请勿逐项手动添加或修改。
/** showcase/extra 的类型化动态资源键；只描述资源身份，import 不会加载对应内容。 */
export const ShowcaseExtraRes = {
    /** json 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    json: {
        /** JsonAsset：showcase/extra/json/locales/en。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        localesEn: { id: 'showcase/extra/json/locales/en', type: 'JsonAsset' },
        /** JsonAsset：showcase/extra/json/config/samples。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        configSamples: { id: 'showcase/extra/json/config/samples', type: 'JsonAsset' },
    },
} as const;
