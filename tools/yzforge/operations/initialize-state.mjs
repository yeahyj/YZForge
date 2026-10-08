import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { files, writeBatch, withProjectLock } from '../project/project.mjs';

/** 新项目显式初始化。已有编目结果表示身份曾经建立，必须恢复原状态而非重置。 */
export async function initializeState(root) {
    return withProjectLock(root, async () => {
        const targets = [
            'project-settings/state/resource-identities.json',
            'project-settings/state/generated-files.json',
        ];
        for (const file of targets) {
            const exists = await access(resolve(root, file)).then(
                () => true,
                (error) => {
                    if (error.code === 'ENOENT') return false;
                    throw error;
                },
            );
            if (exists) throw Error('项目状态已存在，请保留或从版本控制完整恢复：' + file);
        }
        if (
            (await files(resolve(root, 'assets'), 'yz-index.json')).length ||
            (await files(resolve(root, 'assets/game/app/generated'), '.ts')).length
        )
            throw Error('已有生成结果，禁止重新分配资源身份；请从版本控制恢复 project-settings/state');
        return writeBatch(
            root,
            {
                [targets[0]]: JSON.stringify({ formatVersion: 2, entries: {} }, null, 2) + '\n',
                [targets[1]]: '{}\n',
            },
            'initialize-state',
        );
    });
}
