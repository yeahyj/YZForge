// 根据 dynamic 目录及稳定资源身份自动生成，请勿逐项手动添加或修改。
/** showcase/default-zh-cn 的类型化动态资源键；只描述资源身份，import 不会加载对应内容。 */
export const ShowcaseDefaultZhCnRes = {
    /** image 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    image: {
        /** ImageAsset：showcase/default-zh-cn/image/images/greeting。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesGreeting: { id: 'showcase/default-zh-cn/image/images/greeting', type: 'ImageAsset' },
    },
    /** texture 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    texture: {
        /** Texture2D：showcase/default-zh-cn/texture/images/greeting。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesGreeting: { id: 'showcase/default-zh-cn/texture/images/greeting', type: 'Texture2D' },
    },
    /** sprite 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    sprite: {
        /** SpriteFrame：showcase/default-zh-cn/sprite/images/greeting。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesGreeting: { id: 'showcase/default-zh-cn/sprite/images/greeting', type: 'SpriteFrame' },
    },
} as const;
