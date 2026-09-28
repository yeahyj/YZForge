// 根据 dynamic 目录及稳定资源身份自动生成，请勿逐项手动添加或修改。
/** showcase/default-en 的类型化动态资源键；只描述资源身份，import 不会加载对应内容。 */
export const ShowcaseDefaultEnRes = {
    /** image 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    image: {
        /** ImageAsset：showcase/default-en/image/images/greeting。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesGreeting: { id: 'showcase/default-en/image/images/greeting', type: 'ImageAsset' },
        /** ImageAsset：showcase/default-en/image/images/logo。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesLogo: { id: 'showcase/default-en/image/images/logo', type: 'ImageAsset' },
    },
    /** texture 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    texture: {
        /** Texture2D：showcase/default-en/texture/images/greeting。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesGreeting: { id: 'showcase/default-en/texture/images/greeting', type: 'Texture2D' },
        /** Texture2D：showcase/default-en/texture/images/logo。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesLogo: { id: 'showcase/default-en/texture/images/logo', type: 'Texture2D' },
    },
    /** sprite 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    sprite: {
        /** SpriteFrame：showcase/default-en/sprite/images/greeting。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesGreeting: { id: 'showcase/default-en/sprite/images/greeting', type: 'SpriteFrame' },
        /** SpriteFrame：showcase/default-en/sprite/images/logo。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        imagesLogo: { id: 'showcase/default-en/sprite/images/logo', type: 'SpriteFrame' },
    },
} as const;
