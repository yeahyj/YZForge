import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from './game-config.cjs';
import { generate } from './generate.mjs';
import build from './game-build.cjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
try {
    const command = process.argv[2] ?? 'show';
    if (!['show', 'build-options', 'recover-build'].includes(command))
        throw Error('使用 show、build-options 或 recover-build；四项选择请在原生 GameSettings 中修改并保存场景');
    const args = process.argv.slice(3);
    if (args.length && (command !== 'build-options' || args.length !== 2 || args[0] !== '--platform' || !args[1]))
        throw Error('仅 build-options 支持 --platform <构建目标>');
    if (command === 'recover-build') {
        const recovery = await build.recover(root);
        await generate(root);
        console.log(JSON.stringify({ ok: true, ...recovery }, null, 2));
    } else {
        const snapshot = await config.readConfig(root);
        let file;
        if (command === 'build-options') {
            await generate(root, { check: true });
            const platform = args[1] ?? snapshot.buildTargets[0];
            const scene = JSON.parse(await readFile(resolve(root, config.selectionPath + '.meta'), 'utf8'));
            const options = {
                platform,
                debug: snapshot.mode === 'debug',
                mainBundleCompressionType: 'merge_dep',
                name: `yzforge-${snapshot.channel}`,
                buildPath: 'project://build',
                outputName: `${snapshot.channel}-${snapshot.environment}-${snapshot.mode}`,
                startScene: scene.uuid,
                scenes: [{ uuid: scene.uuid, url: 'db://' + config.selectionPath }],
                packages: { 'yzforge-editor': { configHash: snapshot.configHash } },
            };
            if (['wechat', 'douyin'].includes(snapshot.platform))
                options.packages[platform] = { appid: snapshot.platformAppId };
            config.assertBuild(snapshot, options);
            const directory = resolve(root, '.yzforge/build-configs');
            await mkdir(directory, { recursive: true });
            file = resolve(directory, `${options.outputName}.json`);
            await writeFile(file, JSON.stringify(options, null, 2) + '\n');
        }
        console.log(
            JSON.stringify(
                { ok: true, selection: await config.readSelection(root), configHash: snapshot.configHash, file },
                null,
                2,
            ),
        );
    }
} catch (error) {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exitCode = 1;
}
