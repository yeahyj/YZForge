import { readFile, writeFile, mkdir, readdir, stat, rename } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, json, modules, safePath, withProjectLock } from '../project/project.mjs';
import localizationLayout from '../project/localization-layout.cjs';

const forward = (value) => value.replaceAll('\\', '/');
const exists = async (file) =>
    stat(file).then(
        () => true,
        (error) => {
            if (error.code === 'ENOENT') return false;
            throw error;
        },
    );
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_-]*(\/[a-zA-Z][a-zA-Z0-9_-]*)*$/;
const matches = (key, prefix) => key === prefix || key.startsWith(prefix + '/');
const replaceKey = (key, from, to) => to + key.slice(from.length);

/** 只计划各语言资源文件的移动；代码和序列化 Key 由生成/类型检查报告，不自动改写。 */
export async function planLanguageRename(root, input) {
    const request = { module: input.module, bundle: input.bundle, from: input.from, to: input.to };
    if (
        typeof request.from !== 'string' ||
        typeof request.to !== 'string' ||
        !keyPattern.test(request.from) ||
        !keyPattern.test(request.to) ||
        request.from.toLowerCase() === request.to.toLowerCase()
    )
        throw Error('请填写不同的相对资源键，不带扩展名；仅大小写变更不受支持');
    if (matches(request.from, 'fonts/default') || matches(request.to, 'fonts/default'))
        throw Error('fonts/default 是保留字体入口，不能重命名');
    const projectModules = await modules(root),
        module = projectModules.find((item) => item.id === request.module);
    const declaration = module?.bundles[request.bundle]?.localization;
    if (!declaration) throw Error('请选择已启用多语言的业务资源包');
    const snapshots = {};
    const read = async (file) => {
        const text = await readFile(await safePath(root, file), 'utf8');
        snapshots[forward(relative(root, resolve(root, file)))] = digest(text);
        return text;
    };
    await read(forward(relative(root, module.manifestPath)));
    const settings = JSON.parse(await read('project-settings/framework.json'));
    const identities = JSON.parse(await read('project-settings/state/resource-identities.json'));
    const byId = new Map(
        Object.entries(identities.entries)
            .filter(([, value]) => value.active)
            .map(([uuid, value]) => [value.id, { uuid, ...value }]),
    );
    const moves = new Map(),
        keys = new Set();
    let defaultFound = false;
    for (const locale of Object.keys(declaration.locales).sort()) {
        const variant = localizationLayout.languageBundle(module, request.bundle, locale);
        const folder = resolve(module.directory, variant.root),
            catalog = JSON.parse(await read(resolve(folder, 'yz-locale.json')));
        for (const [key, value] of Object.entries(catalog.assets)) {
            if (!matches(key, request.from)) continue;
            if (locale === settings.localization.defaultLocale) defaultFound = true;
            const replacement = replaceKey(key, request.from, request.to);
            if (Object.keys(catalog.assets).some((other) => other.toLowerCase() === replacement.toLowerCase()))
                throw Error(`语言资源键已存在：${locale}/${replacement}`);
            const identity = byId.get(value.id);
            if (!identity) throw Error('语言资源身份已过期，请先生成：' + value.id);
            const source = await safePath(root, identity.source),
                local = forward(relative(resolve(folder, 'dynamic'), source)),
                extension = extname(local),
                stem = local.slice(0, -extension.length);
            if (local.startsWith('../') || local === '..' || resolve(folder, 'dynamic', local) !== source)
                throw Error('语言资源身份不属于所选语言包，请先生成：' + identity.source);
            if (!matches(stem, request.from)) throw Error('图集子图不能作为独立文件改名，请选择整个图集的路径');
            const target = await safePath(
                root,
                resolve(folder, 'dynamic', replaceKey(stem, request.from, request.to) + extension),
            );
            if ((await exists(target)) || (await exists(target + '.meta')))
                throw Error('目标文件已存在：' + forward(relative(root, target)));
            const uuid = identity.uuid.split('@')[0],
                meta = JSON.parse(await read(source + '.meta'));
            if (meta.uuid !== uuid) throw Error('资源 UUID 与索引不一致：' + identity.source);
            if (meta.importer === 'sprite-atlas' && dirname(source) !== dirname(target))
                throw Error('图集依赖同目录源纹理，此操作只允许同目录改名；请保持图集所在目录');
            moves.set(source, {
                from: forward(relative(root, source)),
                to: forward(relative(root, target)),
                uuid,
                hash: digest(await readFile(source)),
                metaHash: digest(await readFile(source + '.meta')),
            });
            keys.add(key);
        }
    }
    if (!defaultFound || !moves.size) throw Error('默认语言中没有这个资源键；请先生成并检查路径');
    const plan = {
        request,
        moves: [...moves.values()].sort((a, b) => a.from.localeCompare(b.from)),
        keys: [...keys].sort(),
        snapshots,
    };
    return { ...plan, signature: digest(plan) };
}

const recordPath = (root, id) => {
    if (!/^\d+-[a-f0-9-]+$/.test(id)) throw Error('无效改名记录');
    return safePath(root, `.yzforge/language-renames/${id}.json`);
};
async function saveRecord(root, record) {
    const file = await recordPath(root, record.id);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file + '.tmp', JSON.stringify(record, null, 2));
    await rename(file + '.tmp', file);
}
async function verifyMove(root, move, atTarget) {
    const file = await safePath(root, atTarget ? move.to : move.from);
    if (digest(await readFile(file)) !== move.hash || (await json(file + '.meta')).uuid !== move.uuid)
        throw Error('资源已变化，不能移动：' + forward(relative(root, file)));
}
/** adapter.move 必须经 Creator；调用返回后核对文件及 UUID。 */
export async function applyLanguageRename(root, input, adapter) {
    return withProjectLock(root, async () => {
        await adapter.assertClean();
        const plan = await planLanguageRename(root, input);
        if (plan.signature !== input.signature) throw Error('项目已变化，请重新预览语言资源改名');
        const record = { id: Date.now() + '-' + randomUUID(), stage: 'applying', plan, moved: [] };
        await saveRecord(root, record);
        try {
            for (const move of plan.moves) {
                await verifyMove(root, move, false);
                await adapter.move(move.from, move.to, move.uuid);
                await verifyMove(root, move, true);
                record.moved.push(move.from);
                await saveRecord(root, record);
            }
            record.stage = 'applied';
            await saveRecord(root, record);
            return { id: record.id, stage: record.stage, moved: plan.moves.length, keys: plan.keys };
        } catch (error) {
            record.stage = 'interrupted';
            record.error = error.message;
            await saveRecord(root, record);
            throw Error(`${error.message}；改名记录 ${record.id} 已保存，可恢复`, { cause: error });
        }
    });
}
/** 先检查全部文件再恢复；中断后按实际位置识别已完成步骤，保留后续人工修改。 */
export async function restoreLanguageRename(root, id, adapter) {
    return withProjectLock(root, async () => {
        await adapter.assertClean();
        const record = await json(await recordPath(root, id));
        if (!['applying', 'applied', 'interrupted', 'restoring'].includes(record.stage))
            throw Error('此记录不需要恢复');
        const moves = [];
        for (const move of record.plan.moves) {
            const old = await exists(await safePath(root, move.from)),
                next = await exists(await safePath(root, move.to));
            if (old === next) throw Error('资源位置存在冲突：' + move.from);
            await verifyMove(root, move, next);
            if (next) moves.push(move);
        }
        record.stage = 'restoring';
        await saveRecord(root, record);
        for (const move of moves.reverse()) {
            await adapter.move(move.to, move.from, move.uuid);
            await verifyMove(root, move, false);
        }
        record.stage = 'restored';
        await saveRecord(root, record);
        return { id, stage: record.stage, moved: moves.length };
    });
}
export async function languageRenameHistory(root) {
    const directory = await safePath(root, '.yzforge/language-renames');
    if (!(await exists(directory))) return [];
    const records = [];
    for (const file of await readdir(directory)) {
        if (!/^\d+-[a-f0-9-]+\.json$/.test(file)) continue;
        const record = await json(resolve(directory, file));
        if (record.stage !== 'restored')
            records.push({ id: record.id, stage: record.stage, request: record.plan.request });
    }
    return records.sort((a, b) => b.id.localeCompare(a.id));
}
