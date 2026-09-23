'use strict';
const fs = require('fs/promises');
const path = require('path');
const config = require('../../tools/yzforge/game-config.cjs');
const { withProjectLock } = require('../../tools/yzforge/project-lock.cjs');
const root = () => Editor.Project.path;
/** 即使当前渠道被删除，也先更新选项，允许从原生面板重新选择有效渠道。 */
exports.refreshChannels = async function () {
    const changed = await withProjectLock(root(), async () => {
        await config.assertUnlocked(root());
        const source = await config.readSource(root());
        const file = path.join(root(), config.channelOptionsPath);
        const content = await require('../../tools/yzforge/format.cjs').formatScript(
            file,
            config.channelOptionsSource(source),
        );
        if (
            (await fs.readFile(file, 'utf8').catch((error) => {
                if (error.code === 'ENOENT') return '';
                throw error;
            })) === content
        )
            return false;
        await fs.writeFile(file, content);
        return true;
    });
    if (changed) await Editor.Message.request('asset-db', 'refresh-asset', 'db://' + config.channelOptionsPath);
};
exports.state = async function () {
    const source = await config.readSource(root());
    return {
        selection: await config.readSelection(root()),
        channels: Object.entries(source.channels).map(([id, value]) => ({
            id,
            name: value.name,
            platform: value.platform,
            environments: Object.keys(value.environments),
        })),
        sourceHash: config.hash(source),
        resolved: await config.readConfig(root()),
    };
};
/** 生成可导入 Creator 或供命令行使用的真实构建参数，含固定配置摘要。 */
exports.buildOptions = async function () {
    const { resolved } = await exports.state();
    const scene = await Editor.Message.request('asset-db', 'query-asset-info', 'db://assets/game/boot/Bootstrap.scene');
    if (!scene) throw Error('Bootstrap.scene 未导入');
    const platform = resolved.buildTargets[0];
    const options = {
        name: `yzforge-${resolved.channel}-${resolved.environment}-${resolved.mode}`,
        platform,
        debug: resolved.mode === 'debug',
        mainBundleCompressionType: 'merge_dep',
        buildPath: 'project://build',
        outputName: `${resolved.channel}-${resolved.environment}-${resolved.mode}`,
        startScene: scene.uuid,
        scenes: [{ url: scene.url, uuid: scene.uuid }],
        packages: { 'yzforge-editor': { configHash: resolved.configHash } },
    };
    if (['wechat', 'douyin'].includes(resolved.platform))
        options.packages[platform] = { appid: resolved.platformAppId };
    config.assertBuild(resolved, options);
    const directory = path.join(root(), '.yzforge/build-configs');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${options.outputName}.json`);
    await fs.writeFile(file, JSON.stringify(options, null, 2) + '\n');
    return { file, options, configHash: resolved.configHash };
};
