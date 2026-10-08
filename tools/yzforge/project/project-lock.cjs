'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function lockDirectory(root) {
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
    return directory;
}
async function readLock(target) {
    const stat = await fs.lstat(target).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (stat?.isSymbolicLink()) throw Error('项目锁不允许符号链接：' + target);
    const raw = await fs.readFile(target, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (raw === null) return { raw, active: false };
    let pid;
    try {
        pid = JSON.parse(raw).pid;
    } catch {
        throw Error('项目锁内容无效，请检查：' + target);
    }
    if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('项目锁缺少有效进程信息：' + target);
    try {
        process.kill(pid, 0);
        return { raw, active: true };
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        return { raw, active: false };
    }
}
async function releaseInterruptedLock(target) {
    const state = await readLock(target);
    if (state.active) throw Error('项目操作仍在运行，请等待完成');
    if (state.raw === null) return;
    if ((await fs.readFile(target, 'utf8')) !== state.raw) throw Error('项目锁已变化，请重新检查');
    await fs.unlink(target);
}
/** 创建记录的持久化阶段不代表进程仍在执行；以项目锁判断是否可以检查。 */
exports.projectLockActive = async function (root) {
    const directory = await lockDirectory(root);
    for (const name of ['generation.lock', 'recovery.lock']) {
        if ((await readLock(path.join(directory, name))).active) return true;
    }
    return false;
};
/** CJS 入口可直接用于 Creator 构建进程，不在其沙箱中执行动态 import。 */
exports.withProjectLock = async function (root, action) {
    const target = path.join(await lockDirectory(root), 'generation.lock');
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

/** 创建清理和生成恢复共用；只接管已经退出的进程留下的锁。 */
exports.withProjectRecovery = async function (root, action) {
    const directory = await lockDirectory(root),
        guard = path.join(directory, 'recovery.lock');
    await releaseInterruptedLock(guard);
    const reservation = await fs.open(guard, 'wx');
    try {
        await reservation.writeFile(JSON.stringify({ pid: process.pid }));
        await releaseInterruptedLock(path.join(directory, 'generation.lock'));
        return await exports.withProjectLock(root, action);
    } finally {
        await reservation.close();
        await fs.unlink(guard);
    }
};
