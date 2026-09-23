'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

/** CJS 入口可直接用于 Creator 构建进程，不在其沙箱中执行动态 import。 */
exports.withProjectLock = async function (root, action) {
    const directory = path.resolve(root, '.yzforge');
    const realRoot = await fs.realpath(root);
    let actual;
    try {
        actual = await fs.realpath(directory);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        actual = path.resolve(realRoot, '.yzforge');
    }
    const local = path.relative(realRoot, actual);
    if (path.isAbsolute(local) || local === '..' || local.startsWith(`..${path.sep}`))
        throw Error(`Path escapes project: ${directory}`);
    await fs.mkdir(directory, { recursive: true });
    const target = path.resolve(directory, 'generation.lock');
    let lock;
    try {
        lock = await fs.open(target, 'wx');
    } catch (error) {
        if (error.code === 'EEXIST')
            throw Error(
                'Generation is already running or was interrupted. Inspect .yzforge/generation.lock before recovery.',
                { cause: error },
            );
        throw error;
    }
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        return await action();
    } finally {
        await lock.close();
        await fs.unlink(target);
    }
};
