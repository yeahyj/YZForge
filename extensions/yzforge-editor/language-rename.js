'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');

/** Creator 只执行共享计划中的资源操作；预览、引用分析和恢复规则位于 tools。 */
exports.createLanguageRenames = function ({ root, inside, ensureFolder, assertBindingSceneSaved }) {
    const tools = () => import(pathToFileURL(inside('tools/yzforge/operations/language-rename.mjs')).href);
    const db = (method, ...args) => Editor.Message.request('asset-db', method, ...args);
    const adapter = {
        assertClean: assertBindingSceneSaved,
        async move(from, to, uuid) {
            const before = await db('query-asset-info', 'db://' + from);
            if (before?.uuid !== uuid) throw Error('资源身份已变化：' + from);
            await ensureFolder(path.dirname(inside(to)));
            await db('move-asset', 'db://' + from, 'db://' + to);
            const after = await db('query-asset-info', 'db://' + to);
            if (after?.uuid !== uuid) throw Error('移动未保留资源 UUID：' + to);
        },
        async save(file, content) {
            await assertBindingSceneSaved();
            await db('save-asset', 'db://' + file, content);
            if ((await fs.readFile(inside(file), 'utf8')) !== content) throw Error('Creator 写入尚未完成：' + file);
        },
    };
    return {
        async previewLanguageRename(args) {
            await adapter.assertClean();
            const plan = await (await tools()).planLanguageRename(root(), args);
            return {
                ...plan.request,
                signature: plan.signature,
                files: [
                    ...plan.moves.map((move) => ({ path: move.from + ' → ' + move.to, operation: 'move' })),
                    ...plan.updates.map((file) => ({ path: file.path, operation: 'update', count: file.count })),
                    ...plan.unresolved.map((file) => ({
                        path: file.path + (file.line ? ':' + file.line : '') + ' · ' + file.reason,
                        operation: 'conflict',
                    })),
                ],
                blocked: plan.unresolved.length > 0,
                message: `移动 ${plan.moves.length} 个语言资源，更新 ${plan.updates.length} 个引用文件；动态拼接的键仍需项目自行核对。`,
            };
        },
        async applyLanguageRename(args) {
            return (await tools()).applyLanguageRename(root(), args, adapter);
        },
        async restoreLanguageRename(args) {
            return (await tools()).restoreLanguageRename(root(), args.id, adapter);
        },
        async languageRenameHistory() {
            return (await tools()).languageRenameHistory(root());
        },
    };
};
