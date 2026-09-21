// 根据 dynamic 目录及稳定资源身份自动生成，请勿逐项手动添加或修改。
/** lobby/default 的类型化动态资源键；只描述资源身份，import 不会加载对应内容。 */
export const LobbyRes = {
    /** audio 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    audio: {
        /** AudioClip：lobby/default/audio/confirm。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        confirm: { id: 'lobby/default/audio/confirm', type: 'AudioClip' },
    },
    /** image 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    image: {
        /** ImageAsset：lobby/default/image/icons/status。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        iconsStatus: { id: 'lobby/default/image/icons/status', type: 'ImageAsset' },
    },
    /** texture 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    texture: {
        /** Texture2D：lobby/default/texture/icons/status。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        iconsStatus: { id: 'lobby/default/texture/icons/status', type: 'Texture2D' },
    },
    /** sprite 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    sprite: {
        /** SpriteFrame：lobby/default/sprite/status。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        status: { id: 'lobby/default/sprite/status', type: 'SpriteFrame' },
    },
    /** prefab 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    prefab: {
        /** Prefab：lobby/default/prefab/dashboard。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        dashboard: { id: 'lobby/default/prefab/dashboard', type: 'Prefab' },
        /** Prefab：lobby/default/prefab/reward-popup。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        rewardPopup: { id: 'lobby/default/prefab/reward-popup', type: 'Prefab' },
    },
    /** json 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    json: {
        /** JsonAsset：lobby/default/json/config/items。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        configItems: { id: 'lobby/default/json/config/items', type: 'JsonAsset' },
    },
} as const;
