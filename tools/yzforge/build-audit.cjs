'use strict';
const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
/** 读取项目默认和目标平台预算，供 Creator 构建钩子与 CLI 使用同一规则。 */
exports.auditProjectBuild = async function (project, destination, platform) {
    if (typeof destination !== 'string' || !destination.trim()) throw Error('请指定 --output 构建输出目录');
    const settings = await fs
        .readFile(path.join(project, 'project-settings/build-budgets.json'), 'utf8')
        .then(JSON.parse)
        .catch((error) => {
            if (error.code === 'ENOENT') return {};
            throw error;
        });
    return exports.auditBuild(destination, { ...settings.default, ...settings.platforms?.[platform] });
};
/** 审计磁盘上的实际构建文件；字节数为未压缩输出，不冒充网络首屏流量或平台最终压缩包大小。 */
exports.auditBuild = async function (destination, budgets = {}) {
    const root = path.resolve(destination),
        files = [],
        configs = [];
    const relative = (file) => path.relative(root, file).replaceAll('\\', '/');
    async function scan(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw Error('构建审计不跟随符号链接：' + file);
            if (entry.isDirectory()) await scan(file);
            else if (entry.isFile()) {
                const bytes = await fs.readFile(file);
                files.push({
                    path: relative(file),
                    bytes: bytes.length,
                    hash: bytes.length >= 1024 ? createHash('sha256').update(bytes).digest('hex') : null,
                });
                if (/^config(?:\.[\da-z]+)?\.json$/i.test(entry.name)) {
                    const config = JSON.parse(bytes.toString('utf8'));
                    if (config.name)
                        configs.push({ bundle: config.name, path: relative(file), dependencies: config.deps ?? [] });
                }
            }
        }
    }
    await scan(root);
    const game = await fs
        .readFile(path.join(root, 'game.json'), 'utf8')
        .then(JSON.parse)
        .catch((error) => {
            if (error.code === 'ENOENT') return {};
            throw error;
        });
    const roots = (game.subpackages ?? game.subPackages ?? [])
        .map((item) => {
            const value = String(item.root).replaceAll('\\', '/').replace(/\/$/, '');
            if (path.isAbsolute(value) || value.split('/').includes('..') || !value)
                throw Error('无效分包目录：' + value);
            return value;
        })
        .sort((a, b) => b.length - a.length);
    const groups = {},
        hashes = new Map();
    for (const file of files) {
        const group = file.path.startsWith('remote/')
            ? 'remote'
            : (roots.find((root) => file.path.startsWith(root + '/')) ?? 'local-root');
        groups[group] = (groups[group] ?? 0) + file.bytes;
        if (file.hash) {
            const list = hashes.get(file.hash) ?? [];
            list.push(file);
            hashes.set(file.hash, list);
        }
    }
    const identicalFiles = [...hashes.values()]
        .filter((group) => group.length > 1)
        .map((group) => ({
            bytesEach: group[0].bytes,
            duplicateBytes: group[0].bytes * (group.length - 1),
            paths: group.map((file) => file.path),
        }));
    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0),
        duplicateBytes = identicalFiles.reduce((sum, group) => sum + group.duplicateBytes, 0);
    const problems = [];
    for (const [name, actual] of Object.entries({
        maxTotalBytes: totalBytes,
        maxLocalRootBytes: groups['local-root'] ?? 0,
        maxDuplicateBytes: duplicateBytes,
    })) {
        const limit = budgets[name];
        if (limit == null) continue;
        if (!Number.isSafeInteger(limit) || limit < 0) throw Error('构建预算必须是非负字节整数：' + name);
        if (actual > limit) problems.push(`${name} 超出预算：${actual} > ${limit} 字节`);
    }
    return {
        measurement: 'uncompressed-output-bytes',
        totalBytes,
        fileCount: files.length,
        groups,
        duplicateBytes,
        identicalFiles,
        bundleDependencies: configs,
        budgets,
        problems,
    };
};
