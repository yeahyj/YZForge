'use strict';
const codeId = 'yzforge-code',
    resourceId = 'yzforge-resources';
function preset(displayName) {
    const normal = { isRemote: false, compressionType: 'merge_dep' };
    return {
        displayName,
        configs: {
            miniGame: {
                preferredOptions: { isRemote: false, compressionType: 'subpackage' },
                fallbackOptions: normal,
                configMode: 'auto',
            },
            web: { preferredOptions: normal, fallbackOptions: normal, configMode: 'auto' },
            native: { preferredOptions: normal, fallbackOptions: normal, configMode: 'auto' },
        },
    };
}
async function ensurePresets() {
    const custom = (await Editor.Profile.getProject('builder', 'bundleConfig.custom')) ?? {};
    let changed = false;
    for (const [id, label] of [
        [codeId, 'YZForge 代码配置'],
        [resourceId, 'YZForge 资源配置'],
    ]) {
        if (!custom[id]) {
            custom[id] = preset(label);
            changed = true;
        }
    }
    if (changed) await Editor.Profile.setProject('builder', 'bundleConfig.custom', custom);
    const check = await Editor.Profile.getProject('builder', 'bundleConfig.custom');
    if (!check?.[codeId] || !check?.[resourceId]) throw Error('Creator Bundle 配置保存失败');
    return check;
}
module.exports = { codeId, resourceId, ensurePresets };
