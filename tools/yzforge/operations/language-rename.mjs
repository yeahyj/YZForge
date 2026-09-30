import { readFile, writeFile, mkdir, readdir, stat, rename } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { digest, files, json, modules, pascal, safePath, withProjectLock } from '../project/project.mjs';
import { decodeUuid } from '../project/catalog.mjs';
import { localizedNamespace } from '../validation/localized-bindings.mjs';
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

/** 只改可证明属于目标语言契约的表达式；同名局部变量不会被当成导入契约。 */
export function planScriptKeys(program, file, moduleDirectory, exportName, group, from, to) {
    const checker = program.getTypeChecker(),
        source = program.getSourceFile(file),
        aliases = new Set(),
        namespaces = new Set();
    if (!source) throw Error('脚本尚未解析：' + file);
    const targets = [
        resolve(moduleDirectory, 'public'),
        resolve(moduleDirectory, `contracts/generated/localization-${group}`),
    ];
    for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.importClause?.isTypeOnly)
            continue;
        if (!targets.includes(resolve(dirname(file), node.moduleSpecifier.text.replace(/\.ts$/, '')))) continue;
        const binding = node.importClause?.namedBindings;
        if (binding && ts.isNamespaceImport(binding)) namespaces.add(checker.getSymbolAtLocation(binding.name));
        if (binding && ts.isNamedImports(binding))
            for (const spec of binding.elements)
                if (!spec.isTypeOnly && (spec.propertyName ?? spec.name).text === exportName)
                    aliases.add(checker.getSymbolAtLocation(spec.name));
    }
    const selected = (node) =>
        ts.isIdentifier(node)
            ? aliases.has(checker.getSymbolAtLocation(node))
            : ts.isPropertyAccessExpression(node) &&
              node.name.text === exportName &&
              ts.isIdentifier(node.expression) &&
              namespaces.has(checker.getSymbolAtLocation(node.expression));
    const edits = [],
        unresolved = [];
    const location = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node) => {
        if (
            ts.isElementAccessExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'asset' &&
            selected(node.expression.expression)
        ) {
            const key = node.argumentExpression;
            if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
                if (matches(key.text, from))
                    edits.push({
                        start: key.getStart(source) + 1,
                        end: key.end - 1,
                        value: replaceKey(key.text, from, to),
                    });
            } else
                unresolved.push({
                    line: location(node),
                    reason: '目标语言契约使用动态计算的资源键，请先改为可检查的静态键',
                });
        }
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'assetKey'
        ) {
            const key = node.arguments[0];
            if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) && matches(key.text, from))
                unresolved.push({
                    line: location(node),
                    reason: 'assetKey 字符串的业务包无法静态确认，请使用生成的 I18n.asset 契约',
                });
        }
        if (
            ts.isPropertyAccessExpression(node) &&
            node.name.text === 'asset' &&
            selected(node.expression) &&
            !(ts.isElementAccessExpression(node.parent) && node.parent.expression === node)
        )
            unresolved.push({
                line: location(node),
                reason: '语言资源字典被整体引用，请先改为 I18n.asset[静态键]，以便跟踪改名',
            });
        ts.forEachChild(node, visit);
    };
    visit(source);
    let after = source.text;
    for (const edit of edits.sort((a, b) => b.start - a.start))
        after = after.slice(0, edit.start) + edit.value + after.slice(edit.end);
    return { after, count: edits.length, unresolved };
}

/** 原生组件保存的键按源预制体/显式跨包来源解析；无法确认的实例覆盖阻止执行。 */
export function planSavedKeys(records, classes, namespace, sources, selectedNamespace, from, to) {
    let count = 0;
    const unresolved = [];
    for (const component of records) {
        if (!component || typeof component !== 'object') continue;
        if (classes.has(component.__type__) || classes.has(decodeUuid(component.__type__))) {
            if (
                typeof component.key === 'string' &&
                matches(component.key, from) &&
                localizedNamespace(records, component, namespace, sources) === selectedNamespace
            ) {
                component.key = replaceKey(component.key, from, to);
                count++;
            }
        }
        if (
            Array.isArray(component.propertyPath) &&
            component.propertyPath.includes('key') &&
            typeof component.value === 'string' &&
            matches(component.value, from)
        )
            unresolved.push({ reason: '预制体实例包含语言键覆盖；请先在 Creator 中明确该覆盖的来源' });
    }
    return { count, unresolved };
}

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
    const sources = {},
        serialized = [];
    for (const file of await files(resolve(root, 'assets'))) {
        if (!/\.(prefab|scene)$/.test(file)) continue;
        const meta = JSON.parse(await read(file + '.meta'));
        sources[meta.uuid] = localizationLayout.sourceNamespace(file, projectModules);
        serialized.push({ file, uuid: meta.uuid });
    }
    const spriteMeta = JSON.parse(await read('assets/framework/ui/localization/localized-sprite.ts.meta'));
    const classes = new Set(['yzforge.LocalizedSprite', spriteMeta.uuid]),
        updates = [],
        unresolved = [];
    for (const { file, uuid } of serialized) {
        const before = await read(file),
            records = JSON.parse(before);
        if (!Array.isArray(records)) continue;
        const changes = planSavedKeys(
            records,
            classes,
            sources[uuid] ?? '',
            sources,
            `${request.module}/${request.bundle}`,
            request.from,
            request.to,
        );
        const target = forward(relative(root, file));
        unresolved.push(...changes.unresolved.map((item) => ({ path: target, ...item })));
        if (changes.count)
            updates.push({
                path: target,
                before,
                after: JSON.stringify(records, null, 2) + '\n',
                count: changes.count,
            });
    }
    const scripts = (await files(resolve(root, 'assets/game'), '.ts')).filter(
        (file) => !forward(file).includes('/generated/') && !file.endsWith('public.ts'),
    );
    const program = ts.createProgram(scripts, {
        noLib: true,
        noResolve: true,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
    });
    const exportName = pascal(module.id) + (request.bundle === 'default' ? '' : pascal(request.bundle)) + 'I18n';
    for (const file of scripts) {
        const before = await read(file),
            changes = planScriptKeys(
                program,
                file,
                module.directory,
                exportName,
                request.bundle,
                request.from,
                request.to,
            );
        const target = forward(relative(root, file));
        unresolved.push(...changes.unresolved.map((item) => ({ path: target, ...item })));
        if (changes.count) updates.push({ path: target, before, after: changes.after, count: changes.count });
    }
    const plan = {
        request,
        moves: [...moves.values()].sort((a, b) => a.from.localeCompare(b.from)),
        updates,
        unresolved,
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
/** adapter 的 move/save 必须经 Creator；调用返回后核对文件及 UUID。 */
export async function applyLanguageRename(root, input, adapter) {
    return withProjectLock(root, async () => {
        await adapter.assertClean();
        const plan = await planLanguageRename(root, input);
        if (plan.signature !== input.signature) throw Error('项目已变化，请重新预览语言资源改名');
        if (plan.unresolved.length) throw Error('存在不能自动处理的语言引用，请先处理预览中的引用');
        const record = { id: Date.now() + '-' + randomUUID(), stage: 'applying', plan, moved: [], updated: [] };
        await saveRecord(root, record);
        try {
            for (const move of plan.moves) {
                await verifyMove(root, move, false);
                await adapter.move(move.from, move.to, move.uuid);
                await verifyMove(root, move, true);
                record.moved.push(move.from);
                await saveRecord(root, record);
            }
            for (const file of plan.updates) {
                if ((await readFile(await safePath(root, file.path), 'utf8')) !== file.before)
                    throw Error('引用文件已变化：' + file.path);
                await adapter.save(file.path, file.after);
                if ((await readFile(await safePath(root, file.path), 'utf8')) !== file.after)
                    throw Error('引用更新读回失败：' + file.path);
                record.updated.push(file.path);
                await saveRecord(root, record);
            }
            record.stage = 'applied';
            await saveRecord(root, record);
            return { id: record.id, stage: record.stage, moved: plan.moves.length, updated: plan.updates.length };
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
        const moves = [],
            updates = [];
        for (const move of record.plan.moves) {
            const old = await exists(await safePath(root, move.from)),
                next = await exists(await safePath(root, move.to));
            if (old === next) throw Error('资源位置存在冲突：' + move.from);
            await verifyMove(root, move, next);
            if (next) moves.push(move);
        }
        for (const file of record.plan.updates) {
            const current = await readFile(await safePath(root, file.path), 'utf8');
            if (current === file.after) updates.push(file);
            else if (current !== file.before) throw Error('引用存在后续编辑，保留冲突：' + file.path);
        }
        record.stage = 'restoring';
        await saveRecord(root, record);
        for (const move of moves.reverse()) {
            await adapter.move(move.to, move.from, move.uuid);
            await verifyMove(root, move, false);
        }
        for (const file of updates) {
            await adapter.save(file.path, file.before);
            if ((await readFile(await safePath(root, file.path), 'utf8')) !== file.before)
                throw Error('引用恢复读回失败：' + file.path);
        }
        record.stage = 'restored';
        await saveRecord(root, record);
        return { id, stage: record.stage, moved: moves.length, updated: updates.length };
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
