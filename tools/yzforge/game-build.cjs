'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const projectLock = require('./project-lock.cjs');
const { randomUUID } = require('node:crypto');
const config = require('./game-config.cjs');

/** 冻结当前选择；与配置生成互斥，锁持续到构建完成或 onError/unload。 */
exports.begin = async function (root, options) {
    return projectLock.withProjectLock(root, async () => {
        const snapshot = await config.readConfig(root);
        config.assertBuild(snapshot, options);
        const requestedHash = options.packages?.['yzforge-editor']?.configHash;
        if (requestedHash && requestedHash !== snapshot.configHash)
            throw Error('构建任务引用了旧游戏配置，请重新导出/导入构建参数');
        const generated = JSON.parse(await fs.readFile(path.join(root, config.snapshotPath), 'utf8'));
        if (config.hash(generated) !== config.hash(snapshot))
            throw Error('游戏配置生成物已过期，请保存 Bootstrap 场景并等待自动生成完成');
        const buildId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
        const lease = {
            root,
            buildId,
            snapshot,
            scriptHash: config.hash(await fs.readFile(path.join(root, config.outputPath), 'utf8')),
        };
        const file = path.join(root, config.buildLockPath);
        let handle;
        try {
            handle = await fs.open(file, 'wx');
        } catch (error) {
            if (error.code === 'EEXIST') throw Error('同一工作目录已有游戏构建，请等待完成', { cause: error });
            throw error;
        }
        try {
            await handle.writeFile(
                JSON.stringify({
                    buildId,
                    pid: process.pid,
                    channel: snapshot.channel,
                    mode: snapshot.mode,
                    environment: snapshot.environment,
                    configHash: snapshot.configHash,
                }),
            );
        } catch (error) {
            await handle.close();
            await fs.unlink(file);
            throw error;
        }
        await handle.close();
        return lease;
    });
};
/** 外部 JSON/脚本编辑也会在产物验收时检测，不把内容变化的构建标为成功。 */
exports.verify = async function (lease) {
    if (!lease) throw Error('构建缺少配置快照');
    const current = await config.readConfig(lease.root);
    if (
        current.configHash !== lease.snapshot.configHash ||
        config.hash(await fs.readFile(path.join(lease.root, config.outputPath), 'utf8')) !== lease.scriptHash
    )
        throw Error('构建期间游戏配置发生变化，产物未通过一致性验收');
    return { buildId: lease.buildId, ...lease.snapshot };
};
/** 只释放自己持有的构建锁；失败重试不会删除其他任务的锁。 */
exports.end = async function (lease) {
    if (!lease) return;
    const file = path.join(lease.root, config.buildLockPath);
    try {
        const state = JSON.parse(await fs.readFile(file, 'utf8'));
        if (state.buildId === lease.buildId) await fs.unlink(file);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
};

/** 只恢复已退出进程的构建；互斥期间核对 Creator 状态和锁内容，绝不凭时间删除活动锁。 */
exports.recover = async function (root, isBuilderIdle) {
    return projectLock.withProjectLock(root, async () => {
        const file = path.join(root, config.buildLockPath);
        let original;
        try {
            original = await fs.readFile(file, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return { recovered: false };
            throw error;
        }
        const lock = JSON.parse(original);
        if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0 || typeof lock.buildId !== 'string' || !lock.buildId)
            throw Error('构建锁缺少有效进程和任务标识，未修改锁文件');
        if (isBuilderIdle && (await isBuilderIdle()) !== true)
            throw Error('Creator 仍有构建任务或状态不可确认，未修改锁文件');
        let alive = true;
        try {
            process.kill(lock.pid, 0);
        } catch (error) {
            if (error.code !== 'ESRCH') throw Error('无法确认原构建进程已退出，未修改锁文件', { cause: error });
            alive = false;
        }
        if (alive) throw Error('原构建进程仍在运行，未修改锁文件；请等待构建完成或关闭占用它的编辑器');
        if ((await fs.readFile(file, 'utf8')) !== original) throw Error('构建锁已变化，请重新检查');
        await fs.unlink(file);
        return { recovered: true, buildId: lock.buildId };
    });
};
