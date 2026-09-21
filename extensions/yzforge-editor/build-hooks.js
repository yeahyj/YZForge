'use strict';
const { execFile } = require('child_process');
const path = require('path');
exports.throwError = true;
exports.onBeforeBuild = async function (options) {
    await new Promise((resolve, reject) =>
        execFile(
            'node',
            [path.join(Editor.Project.path, 'tools/yzforge/cli.mjs'), 'check', '--platform', options.platform],
            { cwd: Editor.Project.path, windowsHide: true, timeout: 120000 },
            (error, stdout, stderr) => (error ? reject(Error(stderr || stdout)) : resolve()),
        ),
    );
    await new Promise((resolve, reject) =>
        execFile(
            'node',
            [
                path.join(Editor.Project.path, 'node_modules/typescript/bin/tsc'),
                '--noEmit',
                '-p',
                path.join(Editor.Project.path, 'tsconfig.json'),
            ],
            { cwd: Editor.Project.path, windowsHide: true, timeout: 120000 },
            (error, stdout, stderr) => (error ? reject(Error(stderr || stdout)) : resolve()),
        ),
    );
};

/** Verify actual Creator output; a hand-written 'verified' flag is never a substitute. */
exports.onAfterBuild = async function (options, result) {
    const fs = require('fs/promises');
    const root = Editor.Project.path;
    const moduleRoot = path.join(root, 'assets/game/modules');
    const definitions = [];
    for (const entry of await fs.readdir(moduleRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
            definitions.push(JSON.parse(await fs.readFile(path.join(moduleRoot, entry.name, 'module.json'), 'utf8')));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    const configs = new Map();
    async function scan(directory) {
        if (!directory) return;
        for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await scan(file);
            else if (/^config(?:\.[\da-z]+)?\.json$/i.test(entry.name)) {
                const config = JSON.parse(await fs.readFile(file, 'utf8'));
                if (config.name) configs.set(config.name, { config, file });
            }
        }
    }
    for (const directory of new Set(
        [result.paths.assets, result.paths.subpackages, result.paths.remote].filter(Boolean),
    ))
        await scan(directory);
    const bundles = [],
        problems = [];
    for (const module of definitions) {
        for (const bundle of Object.values(module.bundles)) {
            const output = configs.get(bundle.id);
            if (!output) problems.push('资源 Bundle 未出现在构建中：' + bundle.id);
            else
                bundles.push({
                    id: bundle.id,
                    kind: 'resources',
                    config: output.file,
                    hasPreloadScript: output.config.hasPreloadScript,
                });
        }
        if (module.code?.mode !== 'bundled') continue;
        const id = module.code.bundle,
            output = configs.get(id);
        const entry = await Editor.Message.request(
            'asset-db',
            'query-asset-info',
            'db://assets/game/modules/' +
                module.id +
                '/' +
                (module.code.root ?? 'code') +
                '/' +
                module.code.entryPath +
                '.prefab',
        );
        const locations = entry ? result.getAssetPathInfo(entry.uuid) : [];
        if (
            !output ||
            !entry ||
            !result.containsAsset(entry.uuid) ||
            !locations.some((location) => location.bundleName === id)
        )
            problems.push('代码入口未保留在独立代码 Bundle：' + id);
        if (result.settings?.assets?.remoteBundles?.includes(id)) problems.push('代码 Bundle 不允许远程部署：' + id);
        if (output?.config.hasPreloadScript === false) problems.push('代码 Bundle 缺少可加载脚本：' + id);
        bundles.push({
            id,
            kind: 'code',
            config: output?.file,
            entryUUID: entry?.uuid,
            locations,
            subpackage: result.settings?.assets?.subpackages?.includes(id),
            hasPreloadScript: output?.config.hasPreloadScript,
        });
    }
    const report = {
        formatVersion: 1,
        timestamp: new Date().toISOString(),
        platform: options.platform,
        output: result.dest,
        bundles,
        problems,
        passed: problems.length === 0,
    };
    const directory = path.join(root, '.yzforge/build-reports');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, options.platform + '.json'), JSON.stringify(report, null, 2));
    if (problems.length) throw Error(problems.join('\n'));
};
