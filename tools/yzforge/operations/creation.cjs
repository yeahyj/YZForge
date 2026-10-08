'use strict';
const fs = require('fs/promises');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { withProjectLock, withProjectRecovery, projectLockActive } = require('../project/project-lock.cjs');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 只跟踪未完成的源文件创建；创建完成即结束，生成由自己的事务负责。 */
exports.createCreationTracker = function (ctx) {
    const { inside, url } = ctx;
    const directory = () => inside('.yzforge/incomplete-creations');
    const finished = (record) => ['complete', 'cleaned'].includes(record.stage);
    const recordPath = (id) => {
        if (!/^\d+-[a-f\d-]+$/.test(id)) throw Error('无效创建记录');
        return path.join(directory(), id + '.json');
    };
    const read = async (id) => JSON.parse(await fs.readFile(recordPath(id), 'utf8'));
    async function save(record) {
        await fs.mkdir(directory(), { recursive: true });
        const target = recordPath(record.id);
        await fs.writeFile(target + '.tmp', JSON.stringify(record, null, 2));
        await fs.rename(target + '.tmp', target);
    }
    async function snapshot(file) {
        const target = inside(file);
        try {
            const stat = await fs.stat(target);
            return stat.isDirectory()
                ? { directory: true }
                : { content: (await fs.readFile(target)).toString('base64') };
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    }
    async function checkpoint(record, step, action) {
        const touched = Object.keys(step.expected);
        const before = {};
        for (const file of touched) {
            if (!record.files.includes(file)) throw Error('步骤超出创建计划：' + file);
            before[file] = await snapshot(file);
            if (hash(before[file]) !== hash(record.after[file])) throw Error('创建期间文件被修改：' + file);
        }
        record.pending = { step, before };
        await save(record);
        let value,
            confirmed = false;
        try {
            value = await action();
            confirmed = true;
        } finally {
            // 响应丢失时也先读回；预期内容不一致时保留待核对状态，不认领人工修改。
            let matched = true;
            for (const [file, expected] of Object.entries(step.expected)) {
                if (expected === 'Creator') {
                    if (!confirmed) matched = false;
                    continue;
                }
                if (hash(await snapshot(file)) !== hash(expected)) matched = false;
            }
            if (matched) {
                for (const file of touched) record.after[file] = await snapshot(file);
                record.steps.push({ ...step, result: value });
                delete record.pending;
                await save(record);
            }
        }
        if (record.pending) throw Error('步骤写入读回不一致，保留恢复记录：' + step.label);
        return value;
    }
    async function run(preview, execute, preflight = async () => {}) {
        return withProjectLock(inside('.'), async () => {
            await preflight();
            const files = [...new Set(preview.files.map((file) => file.path))];
            const record = {
                id: `${Date.now()}-${randomUUID()}`,
                stage: 'creating',
                request: preview.request,
                files,
                before: Object.fromEntries(await Promise.all(files.map(async (file) => [file, await snapshot(file)]))),
                steps: [],
            };
            record.after = { ...record.before };
            await save(record);
            let value;
            try {
                value = await execute((step, action) => checkpoint(record, step, action));
            } catch (error) {
                record.stage = 'failed';
                record.error = error.message;
                await save(record);
                throw Error(
                    `${error.message}\n创建记录 ${record.id} 已保留，可在“删除与恢复”检查残留并清理本次创建。`,
                    {
                        cause: error,
                    },
                );
            }
            record.stage = 'complete';
            await save(record);
            await fs.unlink(recordPath(record.id));
            return value;
        });
    }
    async function list() {
        const entries = await fs.readdir(directory()).catch((error) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        const records = await Promise.all(
            entries.filter((file) => file.endsWith('.json')).map((file) => read(file.slice(0, -5))),
        );
        const busy = await projectLockActive(inside('.'));
        return records
            .filter((record) => !finished(record))
            .map((record) => ({
                id: record.id,
                stage: record.stage,
                busy,
                request: record.request,
                error: record.error,
                files: record.files,
            }));
    }
    async function inspect(id) {
        const record = await read(id);
        if (finished(record)) throw Error('此创建记录已结束，无需清理');
        const changes = [],
            conflicts = [];
        const afterState = { ...record.after };
        if (record.pending)
            for (const [file, expected] of Object.entries(record.pending.step.expected)) {
                const current = await snapshot(file);
                if (hash(current) === hash(record.before[file]) || hash(current) === hash(record.pending.before[file]))
                    continue;
                if (expected === 'Creator') {
                    conflicts.push(file + ' 原生写入中断，元数据结果未确认；保留文件供核对');
                } else if (hash(current) === hash(expected)) afterState[file] = expected;
                else conflicts.push(file + ' 与中断步骤的预期内容不一致');
            }
        for (const file of record.files) {
            const before = record.before[file],
                after = afterState[file],
                current = await snapshot(file);
            if (hash(current) === hash(before)) continue;
            if (hash(current) !== hash(after)) {
                conflicts.push(file + ' 在创建后又被修改');
                continue;
            }
            if (
                !before &&
                file.startsWith('assets/') &&
                file.endsWith('.meta') &&
                !(await snapshot(file.slice(0, -5)))
            ) {
                conflicts.push(file + ' 对应资源缺失，请先在 Creator 核对元数据');
                continue;
            }
            if (!before && current?.directory) {
                for (const child of await fs.readdir(inside(file))) {
                    if (!record.files.includes(file + '/' + child))
                        conflicts.push(file + '/' + child + ' 不属于本次创建');
                }
            }
            changes.push({
                path: file,
                action: before ? 'restore' : 'delete',
                directory: !!current?.directory,
                hash: hash(current),
            });
        }
        const references = ctx.references ? await ctx.references(record, changes) : [];
        return {
            id,
            changes,
            conflicts,
            references,
            signature: hash({ id, changes, conflicts, references, after: afterState }),
        };
    }
    async function previewCleanup({ id }) {
        if (await projectLockActive(inside('.'))) throw Error('项目操作仍在运行，请等待完成');
        return inspect(id);
    }
    async function cleanup(args) {
        return withProjectRecovery(inside('.'), async () => {
            const preview = await inspect(args.id);
            if (preview.signature !== args.signature) throw Error('清理条件已变化，请重新检查');
            if (preview.conflicts.length || preview.references.length)
                throw Error([...preview.conflicts, ...preview.references].join('\n'));
            const record = await read(args.id);
            record.stage = 'cleaning';
            await save(record);
            const ordered = [...preview.changes].sort((a, b) => {
                if (a.action !== b.action) return a.action === 'restore' ? -1 : 1;
                if (a.directory !== b.directory) return a.directory ? 1 : -1;
                return b.path.split('/').length - a.path.split('/').length;
            });
            try {
                for (const change of ordered) {
                    const file = change.path,
                        target = inside(file),
                        before = record.before[file];
                    if (file.startsWith('assets/') && file.endsWith('.meta') && !before) continue; // Creator 删除所属资源时处理。
                    if (hash(await snapshot(file)) !== change.hash) throw Error('清理期间文件被修改：' + file);
                    if (file.startsWith('assets/') && !file.endsWith('.meta')) {
                        const metadata = file + '.meta',
                            meta = preview.changes.find((item) => item.path === metadata);
                        if (
                            record.files.includes(metadata) &&
                            hash(await snapshot(metadata)) !== (meta?.hash ?? hash(record.before[metadata]))
                        )
                            throw Error('清理期间元数据被修改：' + metadata);
                    }
                    if (change.action === 'restore') {
                        const bytes = Buffer.from(before.content, 'base64');
                        if (file.startsWith('assets/')) {
                            const metadata = file.endsWith('.meta');
                            await ctx.db(
                                metadata ? 'save-asset-meta' : 'save-asset',
                                url(metadata ? target.slice(0, -5) : target),
                                bytes.toString('utf8'),
                            );
                        } else await fs.writeFile(target, bytes);
                    } else if (file.startsWith('assets/')) {
                        if (change.directory && (await fs.readdir(target)).length) throw Error('目录仍非空：' + file);
                        await ctx.db('delete-asset', url(target));
                    } else if (change.directory) await fs.rmdir(target);
                    else await fs.unlink(target);
                    if (hash(await snapshot(file)) !== hash(before)) throw Error('清理后读回不一致：' + file);
                }
                for (const file of record.files) {
                    if (hash(await snapshot(file)) !== hash(record.before[file]))
                        throw Error('清理后读回不一致：' + file);
                }
            } catch (error) {
                record.stage = 'cleanup-failed';
                record.error = error.message;
                await save(record);
                throw Error(`清理中断，记录仍保留，可重新检查后继续：${record.id}；${error.message}`, { cause: error });
            }
            record.stage = 'cleaned';
            await save(record);
            await fs.unlink(recordPath(record.id));
            return { id: record.id, stage: record.stage, changes: preview.changes };
        });
    }
    return { run, list, previewCleanup, cleanup };
};
