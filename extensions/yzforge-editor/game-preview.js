'use strict';
const config = require('../../tools/yzforge/game-config.cjs');

/** Creator 预览设置钩子：把当前源配置摘要交给运行时，阻止使用过期的生成快照启动。 */
exports.checkSettings = async function (settings) {
    try {
        const current = await config.readConfig(Editor.Project.path);
        settings.yzforge = { gameConfigHash: current.configHash };
    } catch (error) {
        // Creator 会吞掉预览钩子的异常，因此通过设置显式交给 GameSettings.resolve 报错。
        settings.yzforge = { gameConfigError: error.message ?? String(error) };
    }
};
