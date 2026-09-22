// 根据 dynamic 目录及稳定资源身份自动生成，请勿逐项手动添加或修改。
/** workshop/default 的类型化动态资源键；只描述资源身份，import 不会加载对应内容。 */
export const WorkshopRes = {
    /** prefab 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    prefab: {
        /** Prefab：workshop/default/prefab/prefabs/task-part。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        prefabsTaskPart: { id: 'workshop/default/prefab/prefabs/task-part', type: 'Prefab' },
        /** Prefab：workshop/default/prefab/ui/claim-popup。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        uiClaimPopup: { id: 'workshop/default/prefab/ui/claim-popup', type: 'Prefab' },
        /** Prefab：workshop/default/prefab/ui/workflow-page。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        uiWorkflowPage: { id: 'workshop/default/prefab/ui/workflow-page', type: 'Prefab' },
    },
    /** json 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */
    json: {
        /** JsonAsset：workshop/default/json/config/tasks。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */
        configTasks: { id: 'workshop/default/json/config/tasks', type: 'JsonAsset' },
    },
} as const;
