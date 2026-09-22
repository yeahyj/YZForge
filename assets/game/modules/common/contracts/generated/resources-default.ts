// 根据 dynamic 目录及稳定资源身份自动生成，请勿逐项手动添加或修改。
/** common/default 的类型化动态资源键；只描述资源身份，import 不会加载对应内容。 */
export const CommonRes = {
    /** json 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    json: {
        /** JsonAsset：common/default/json/config/economy。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        configEconomy: { id: 'common/default/json/config/economy', type: 'JsonAsset' },
    },
} as const;
