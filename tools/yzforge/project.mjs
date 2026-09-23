import { readFile, writeFile, mkdir, rename, readdir, realpath, unlink, open } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import projectLock from './project-lock.cjs';
export const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
export const digest = (value) =>
    `sha256:${createHash('sha256')
        .update(typeof value === 'string' ? value : JSON.stringify(value))
        .digest('hex')}`;
export function within(root, path) {
    const absolute = resolve(root, path);
    const local = relative(resolve(root), absolute);
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
        throw Error(`Path escapes project: ${path}`);
    return absolute;
}
export async function safePath(root, path) {
    const target = within(root, path);
    let ancestor = target;
    while (true) {
        try {
            const resolved = await realpath(ancestor);
            within(await realpath(root), resolved);
            return target;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor) throw error;
            ancestor = parent;
        }
    }
}
export async function files(root, extension) {
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const result = [];
    for (const entry of entries) {
        if (entry.isSymbolicLink())
            throw Error(`Symlinks are not supported in generated project sources: ${entry.name}`);
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) result.push(...(await files(path, extension)));
        else if (!extension || path.endsWith(extension)) result.push(path);
    }
    return result;
}
export async function modules(root) {
    const manifests = (await files(resolve(root, 'assets/game/modules'), '/module.json')).concat(
        await files(resolve(root, 'assets/game/modules'), '\\module.json'),
    );
    const unique = [...new Set(manifests)];
    return Promise.all(
        unique.map(async (path) => ({ ...(await json(path)), directory: dirname(path), manifestPath: path })),
    );
}
export function identifier(value) {
    const result = value.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
    if (
        !/^[a-zA-Z_$][\w$]*$/.test(result) ||
        ['class', 'delete', 'import', 'new', 'function', '__proto__', 'constructor', 'prototype'].includes(result)
    )
        throw Error(`Cannot generate TypeScript identifier: ${value}`);
    return result;
}
export const pascal = (value) => {
    const name = identifier(value);
    return name[0].toUpperCase() + name.slice(1);
};
/** 分步提交普通生成文件，保存不可变前后内容；失败回滚遇到用户修改立即保留冲突。 */
export async function writeBatch(root, output, label = 'generate') {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const base = await safePath(root, `.yzforge/changes/${id}`);
    const entries = [];
    for (const [path, content] of Object.entries(output)) {
        if (/\.(scene|prefab|meta)$/.test(path))
            throw Error('Serialized Cocos assets must be written through the editor');
        const target = await safePath(root, path),
            previous = await textOrNull(target);
        if (previous !== content)
            entries.push({ path: relative(root, target).replaceAll('\\', '/'), previous, content });
    }
    if (!entries.length) return { transaction: null, paths: [] };
    await mkdir(base, { recursive: true });
    const record = { formatVersion: 2, id, label, status: 'prepared', entries, applied: [] };
    await saveTransaction(base, record);
    for (let index = 0; index < entries.length; index++)
        await writeFile(resolve(base, index + '.staged'), entries[index].content);
    try {
        for (let index = 0; index < entries.length; index++) {
            const item = entries[index],
                target = await safePath(root, item.path);
            if ((await textOrNull(target)) !== item.previous) throw Error('生成期间文件被修改：' + item.path);
            await mkdir(dirname(target), { recursive: true });
            await rename(resolve(base, index + '.staged'), target);
            record.applied.push(item.path);
            await saveTransaction(base, record);
            if ((await textOrNull(target)) !== item.content) throw Error('生成写回校验失败：' + item.path);
        }
        record.status = 'complete';
        await saveTransaction(base, record);
        return { transaction: id, paths: entries.map((item) => item.path) };
    } catch (error) {
        record.status = 'interrupted';
        record.error = error.message;
        await saveTransaction(base, record);
        const conflicts = [];
        for (const item of [...entries].reverse()) {
            try {
                const target = await safePath(root, item.path),
                    current = await textOrNull(target);
                if (current === item.previous) continue;
                if (current !== item.content) {
                    conflicts.push(item.path);
                    continue;
                }
                if (item.previous === null) await unlink(target);
                else await writeFile(target, item.previous);
            } catch (recovery) {
                conflicts.push(item.path + ': ' + recovery.message);
            }
        }
        record.conflicts = conflicts;
        record.status = conflicts.length ? 'interrupted' : 'rolled-back';
        await saveTransaction(base, record);
        throw Error(error.message + (conflicts.length ? '；恢复冲突：' + conflicts.join(', ') : '；本次生成已回滚'), {
            cause: error,
        });
    }
}
async function textOrNull(target) {
    try {
        return await readFile(target, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}
async function saveTransaction(base, record) {
    const file = resolve(base, 'transaction.json');
    await writeFile(file + '.tmp', JSON.stringify(record, null, 2));
    await rename(file + '.tmp', file);
}
/** 列出需要恢复的生成，旧版已结束日志不会被当成中断任务。 */
export async function pendingTransactions(root) {
    const base = await safePath(root, '.yzforge/changes');
    const names = await readdir(base).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    const pending = [];
    for (const id of names) {
        if (!/^\d+-[a-f0-9]+$/.test(id)) continue;
        const record = await json(resolve(base, id, 'transaction.json')).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (record?.formatVersion === 2 && ['prepared', 'interrupted'].includes(record.status))
            pending.push({ id, status: record.status, error: record.error, files: record.entries.length });
    }
    return pending;
}
/** 预览中断生成的恢复，重新读取每个文件，不覆盖任何不匹配的内容。 */
export async function previewTransaction(root, id) {
    if (!/^\d+-[a-f0-9]+$/.test(id)) throw Error('无效生成记录');
    const base = await safePath(root, `.yzforge/changes/${id}`),
        record = await json(resolve(base, 'transaction.json'));
    if (record.formatVersion !== 2 || !['prepared', 'interrupted'].includes(record.status))
        throw Error('此生成记录不需要恢复');
    const changes = [],
        conflicts = [],
        snapshots = [];
    for (const item of record.entries) {
        if (/\.(scene|prefab|meta)$/.test(item.path)) throw Error('引擎资源必须通过编辑器恢复');
        const current = await textOrNull(await safePath(root, item.path));
        snapshots.push([item.path, current]);
        if (current === item.previous) continue;
        if (current !== item.content) conflicts.push(item.path);
        else changes.push({ path: item.path, action: item.previous === null ? 'delete' : 'restore' });
    }
    return { id, changes, conflicts, signature: digest({ record, snapshots }) };
}
/** 恢复前重新校验预览；生成锁在仍存活的其他进程持有时拒绝执行。 */
export async function recoverTransaction(root, request) {
    const guard = await safePath(root, '.yzforge/recovery.lock');
    const reservation = await open(guard, 'wx').catch((error) => {
        if (error.code === 'EEXIST') throw Error('已有恢复正在执行；若上次恢复进程中断，请检查 .yzforge/recovery.lock');
        throw error;
    });
    try {
        await reservation.writeFile(JSON.stringify({ pid: process.pid }));
        const lock = await safePath(root, '.yzforge/generation.lock'),
            raw = await textOrNull(lock);
        if (raw !== null) {
            const state = JSON.parse(raw);
            if (!Number.isSafeInteger(state.pid) || state.pid <= 0) throw Error('生成锁缺少有效进程信息，请检查后恢复');
            try {
                process.kill(state.pid, 0);
                throw Error('生成进程仍在运行，请等待完成');
            } catch (error) {
                if (error.code !== 'ESRCH') throw error;
            }
            if ((await textOrNull(lock)) !== raw) throw Error('生成锁已变化，请重新预览');
            await unlink(lock);
        }
        return await withProjectLock(root, async () => {
            const plan = await previewTransaction(root, request.id);
            if (plan.signature !== request.signature || plan.conflicts.length)
                throw Error('恢复条件变化或存在用户修改，请重新预览');
            const base = await safePath(root, `.yzforge/changes/${request.id}`),
                record = await json(resolve(base, 'transaction.json'));
            for (const change of [...plan.changes].reverse()) {
                const item = record.entries.find((item) => item.path === change.path),
                    target = await safePath(root, item.path);
                if ((await textOrNull(target)) !== item.content) throw Error('恢复期间文件被修改：' + item.path);
                if (item.previous === null) await unlink(target);
                else await writeFile(target, item.previous);
                if ((await textOrNull(target)) !== item.previous) throw Error('恢复写回校验失败：' + item.path);
            }
            record.status = 'rolled-back';
            await saveTransaction(base, record);
            return { id: record.id, status: record.status, changes: plan.changes };
        });
    } finally {
        await reservation.close();
        await unlink(guard);
    }
}
export function withProjectLock(root, action) {
    return projectLock.withProjectLock(root, action);
}
