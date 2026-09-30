'use strict';
const fs = require('fs/promises');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 创建预览即操作边界；失败时保留完整前后快照，撤销仅处理本次变化且拒绝覆盖后续修改。 */
exports.createCreationHistory = function (ctx) {
    const { inside, url } = ctx;
    const directory = () => inside('.yzforge/creations');
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
    async function capture(record) {
        record.after = Object.fromEntries(
            await Promise.all(record.files.map(async (file) => [file, await snapshot(file)])),
        );
    }
    async function run(preview, execute) {
        const files = [...new Set(preview.files.map((file) => file.path))];
        const record = {
            id: `${Date.now()}-${randomUUID()}`,
            stage: 'creating',
            request: preview.request,
            files,
            before: Object.fromEntries(await Promise.all(files.map(async (file) => [file, await snapshot(file)]))),
        };
        await save(record);
        try {
            const value = await execute();
            await capture(record);
            record.stage = 'awaiting-generation';
            await save(record);
            return { ...value, creationId: record.id };
        } catch (error) {
            await capture(record);
            record.stage = 'failed';
            record.error = error.message;
            await save(record);
            throw Error(`${error.message}\n创建记录 ${record.id} 已保留，可在“删除与恢复”预览并撤销本次创建。`, {
                cause: error,
            });
        }
    }
    async function mark(id, stage, error) {
        if (!id) return;
        const record = await read(id);
        // 状态变化不认领文件内容。特别是重试生成时，文件可能已由用户修改；
        // 原始创建完成快照必须保持不变，生成自己的修改由生成事务记录负责。
        record.stage = stage;
        record.error = error;
        await save(record);
    }
    async function retryGeneration(id, generate) {
        const record = await read(id);
        if (!['awaiting-generation', 'generation-failed'].includes(record.stage))
            throw Error('创建步骤尚未完成，不能仅通过重新生成标记成功');
        try {
            await generate();
            await mark(id, 'ready');
        } catch (error) {
            await mark(id, 'generation-failed', error.message);
            throw error;
        }
        return { id, stage: 'ready' };
    }
    async function list() {
        const entries = await fs.readdir(directory()).catch((error) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        const records = await Promise.all(
            entries.filter((file) => file.endsWith('.json')).map((file) => read(file.slice(0, -5))),
        );
        return records
            .filter((record) => !['ready', 'rolled-back'].includes(record.stage))
            .map((record) => ({
                id: record.id,
                stage: record.stage,
                request: record.request,
                error: record.error,
                files: record.files,
            }));
    }
    async function previewRollback({ id }) {
        const record = await read(id);
        if (!record.after || ['ready', 'rolled-back'].includes(record.stage))
            throw Error('此创建记录不能直接撤销；中途崩溃无完整快照时请检查残留并走普通删除流程');
        const changes = [],
            conflicts = [];
        for (const file of record.files) {
            const before = record.before[file],
                after = record.after[file],
                current = await snapshot(file);
            if (hash(before) === hash(after) || hash(current) === hash(before)) continue;
            if (hash(current) !== hash(after)) {
                conflicts.push(file + ' 在创建后又被修改');
                continue;
            }
            if (!before && current?.directory) {
                for (const child of await fs.readdir(inside(file))) {
                    if (!record.files.includes(file + '/' + child))
                        conflicts.push(file + '/' + child + ' 不属于本次创建');
                }
            }
            changes.push({ path: file, action: before ? 'restore' : 'delete', directory: !!current?.directory });
        }
        const references = ctx.references ? await ctx.references(record, changes) : [];
        return {
            id,
            changes,
            conflicts,
            references,
            signature: hash({ id, changes, conflicts, references, after: record.after }),
        };
    }
    async function rollback(args) {
        const preview = await previewRollback(args);
        if (preview.signature !== args.signature) throw Error('撤销条件已变化，请重新预览');
        if (preview.conflicts.length || preview.references.length)
            throw Error([...preview.conflicts, ...preview.references].join('\n'));
        const record = await read(args.id);
        record.stage = 'rolling-back';
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
                if (hash(await snapshot(file)) !== hash(before)) throw Error('撤销后读回不一致：' + file);
            }
            record.stage = 'rolled-back';
            await save(record);
            return { id: record.id, stage: record.stage, changes: preview.changes };
        } catch (error) {
            record.stage = 'rollback-failed';
            record.error = error.message;
            await save(record);
            throw Error(`撤销中断，备份仍保留：${record.id}；${error.message}`, { cause: error });
        }
    }
    return { run, mark, list, previewRollback, rollback, retryGeneration };
};
