'use strict';
const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Backups are immutable copies. Creator alone removes/imports assets and their metadata.
exports.createRecovery = function ({
    inside,
    rel,
    url,
    read,
    journal,
    moduleInfo,
    previewDelete,
    saveJson,
    ensureFolder,
    workbookTools,
}) {
    const db = (method, ...args) => Editor.Message.request('asset-db', method, ...args);
    const writeRecord = (archive, record) =>
        fs.writeFile(path.join(archive, 'record.json'), JSON.stringify(record, null, 2));
    async function remove(args) {
        const preview = await previewDelete(args);
        if (preview.references.length) throw Error('仍被引用，不能删除：\n' + preview.references.join('\n'));
        if (args.signature !== preview.signature) throw Error('文件状态已变化，请重新预览删除清单');
        if (await Editor.Message.request('scene', 'query-dirty')) throw Error('请先保存当前场景或预制体，再执行删除');
        const { directory, manifest } = await moduleInfo(args.module, true);
        const id = await journal('delete-items-v2', { original: rel(directory), preview });
        const archive = inside(`.yzforge/trash/${id}`);
        const record = {
            id,
            stage: 'backing-up',
            original: rel(directory),
            manifest,
            preview,
            files: [],
            assets: [],
            deleted: [],
            workbookChanges: [],
        };
        await fs.mkdir(archive, { recursive: true });
        for (const source of preview.targets)
            if ((await fs.stat(inside(source))).isDirectory())
                await fs.mkdir(path.join(archive, 'files', source), { recursive: true });
        await writeRecord(archive, record);
        for (const source of preview.files) {
            const bytes = await fs.readFile(inside(source));
            const destination = path.join(archive, 'files', source);
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.writeFile(destination, bytes, { flag: 'wx' });
            if (hash(await fs.readFile(destination)) !== hash(bytes)) throw Error(`备份校验失败：${source}`);
            record.files.push({ source, hash: hash(bytes) });
            if (!source.endsWith('.meta')) {
                const info = await db('query-asset-info', url(inside(source)));
                if (info) record.assets.push({ source, uuid: info.uuid });
            }
        }
        // Include folder UUIDs, including the root, which are not ordinary files.
        for (const source of preview.files.filter((file) => file.endsWith('.meta'))) {
            const asset = source.slice(0, -5);
            if (!record.assets.some((item) => item.source === asset)) {
                const info = await db('query-asset-info', url(inside(asset)));
                if (info) {
                    record.assets.push({ source: asset, uuid: info.uuid, directory: info.isDirectory });
                    if (info.isDirectory) await fs.mkdir(path.join(archive, 'files', asset), { recursive: true });
                }
            }
        }
        record.stage = 'backed-up';
        await writeRecord(archive, record);
        // Recheck after the potentially lengthy backup. No stale preview can delete new work.
        const latest = await previewDelete(args);
        if (latest.signature !== preview.signature || latest.references.length)
            throw Error('备份期间项目发生变化，请重新预览');
        try {
            for (const change of preview.workbooks ?? []) {
                const tool = await workbookTools();
                const result = await tool.writeWorkbookConfig(
                    Editor.Project.path,
                    change.source,
                    change.next,
                    change.hash,
                );
                record.workbookChanges.push({ ...change, afterHash: result.hash });
                await writeRecord(archive, record);
            }
            record.stage = 'deleting';
            await writeRecord(archive, record);
            // Windows may reject recycling a directory held by Creator's script watcher.
            // Let Creator remove leaves first, then remove verified empty directories.
            const ordered = [...record.assets].sort((a, b) => {
                if (!!a.directory !== !!b.directory) return a.directory ? 1 : -1;
                return b.source.split('/').length - a.source.split('/').length;
            });
            for (const item of ordered) {
                const target = inside(item.source);
                if (!preview.targets.some((source) => item.source === source || item.source.startsWith(source + '/')))
                    throw Error('删除路径不属于预览范围');
                const info = await db('query-asset-info', url(target));
                if (!info) {
                    if (
                        await fs.stat(target).then(
                            () => true,
                            (error) => {
                                if (error.code === 'ENOENT') return false;
                                throw error;
                            },
                        )
                    )
                        throw Error('文件尚未被 Creator 导入：' + item.source);
                    continue;
                }
                if (info.uuid !== item.uuid) throw Error('删除前 UUID 已变化：' + item.source);
                if (item.directory && (await fs.readdir(target)).length)
                    throw Error('目录仍有未删除文件：' + item.source);
                await db('delete-asset', url(target));
                if (await db('query-asset-info', url(target))) throw Error('Creator 未完成删除：' + item.source);
                record.deleted.push(item.source);
                await writeRecord(archive, record);
            }
            for (const source of preview.targets)
                if (await db('query-asset-info', url(inside(source)))) throw Error('Creator 未完成删除：' + source);
            if (preview.nextManifest) await saveJson(path.join(directory, 'module.json'), preview.nextManifest);
            record.stage = 'deleted';
            await writeRecord(archive, record);
            return { restoreId: id, archive: rel(archive), files: preview.files, workbooks: preview.workbooks ?? [] };
        } catch (error) {
            record.stage = 'interrupted';
            record.error = error.message;
            await writeRecord(archive, record);
            throw Error(`操作中断，完整备份已保留。请在恢复列表恢复 ${id}：${error.message}`, { cause: error });
        }
    }
    async function restore(args) {
        if (!/^[\d]+-[\da-f-]+$/.test(args.id)) throw Error('无效恢复记录');
        const archive = inside(`.yzforge/trash/${args.id}`),
            record = await read(path.join(archive, 'record.json'));
        if (!['deleted', 'interrupted', 'restoring'].includes(record.stage))
            throw Error(`此记录不能恢复：${record.stage}`);
        const manifestPath = inside(path.join(record.original, 'module.json'));
        if (record.preview.nextManifest) {
            const current = await read(manifestPath);
            if (
                ![JSON.stringify(record.preview.nextManifest), JSON.stringify(record.manifest)].includes(
                    JSON.stringify(current),
                )
            )
                throw Error('删除后模块清单已修改，恢复会覆盖新内容；请先处理冲突');
        }
        const tool = await workbookTools();
        for (const change of record.workbookChanges) {
            const current = await tool.readWorkbook(Editor.Project.path, change.source);
            if (current.hash !== change.afterHash && JSON.stringify(current.config) !== JSON.stringify(change.previous))
                throw Error(`配置表已修改，不能覆盖恢复：${change.source}`);
        }
        for (const item of record.files) {
            if (hash(await fs.readFile(path.join(archive, 'files', item.source))) !== item.hash)
                throw Error(`备份损坏：${item.source}`);
            const existing = await fs.readFile(inside(item.source)).catch((error) => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            if (existing && hash(existing) !== item.hash) throw Error(`原位置存在不同内容，不能覆盖：${item.source}`);
        }
        record.stage = 'restoring';
        await writeRecord(archive, record);
        for (const source of record.preview.targets) {
            if (await db('query-asset-info', url(inside(source)))) continue;
            await ensureFolder(path.dirname(inside(source)));
            await db('import-asset', path.join(archive, 'files', source), url(inside(source)), {
                overwrite: false,
                rename: false,
            });
        }
        // Resume a partial import, including empty directories that contain only a sibling .meta.
        for (const item of [...record.assets].sort((a, b) => a.source.split('/').length - b.source.split('/').length)) {
            if (await db('query-asset-info', url(inside(item.source)))) continue;
            const backup = path.join(archive, 'files', item.source);
            const meta = await read(backup + '.meta');
            if (meta.importer === 'directory') await fs.mkdir(backup, { recursive: true });
            await db('import-asset', backup, url(inside(item.source)), { overwrite: false, rename: false });
        }
        for (const item of record.assets) {
            const info = await db('query-asset-info', url(inside(item.source)));
            if (info?.uuid !== item.uuid) throw Error(`恢复 UUID 校验失败，备份仍保留：${item.source}`);
        }
        if (record.preview.nextManifest) await saveJson(manifestPath, record.manifest);
        for (const change of record.workbookChanges) {
            const current = await tool.readWorkbook(Editor.Project.path, change.source);
            if (JSON.stringify(current.config) !== JSON.stringify(change.previous))
                await tool.writeWorkbookConfig(Editor.Project.path, change.source, change.previous, change.afterHash);
        }
        record.stage = 'restored';
        await writeRecord(archive, record);
        return { restored: record.original, verifiedUUIDs: record.assets.length };
    }
    return { remove, restore };
};
