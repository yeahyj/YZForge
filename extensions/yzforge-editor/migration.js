'use strict';
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHash } = require('crypto');
const hash = (value) => createHash('sha256').update(value).digest('hex');

exports.createMigration = function (ctx) {
    const {
        root,
        inside,
        rel,
        read,
        moduleInfo,
        listFiles,
        ensureFolder,
        saveJson,
        writeScript,
        bundleFolder,
        workbookTools,
        journal,
    } = ctx;
    const db = (method, ...args) => Editor.Message.request('asset-db', method, ...args);
    async function previewMigration(args) {
        const { directory, manifest } = await moduleInfo(args.module);
        if (manifest.layoutVersion === 2) throw Error('此模块已使用新版目录');
        const prefix = rel(directory),
            moves = [],
            remaps = [];
        const addMove = (from, to, original = from) => {
            moves.push({ from, to });
            remaps.push({ from: original, to });
        };
        for (const [group, bundle] of Object.entries(manifest.bundles)) {
            const from = `${prefix}/${bundle.root}`,
                to = `${prefix}/bundles/${group}`;
            if (from !== to) addMove(from, to);
            const dynamicFiles = [];
            for (const asset of Object.values(manifest.assets ?? {})) {
                const info = await db('query-asset-info', asset.uuid.split('@')[0]);
                if (!info) throw Error(`未导入资源 ${asset.uuid}`);
                dynamicFiles.push(rel(info.file));
            }
            for (const item of await fs.readdir(inside(from), { withFileTypes: true })) {
                if (item.name.endsWith('.meta') || item.name === 'yz-index.json') continue;
                if (['dynamic', 'static'].includes(item.name))
                    throw Error(`旧包已含 ${item.name}，请先人工确认迁移归属：${from}`);
                const old = `${from}/${item.name}`;
                const dynamic =
                    item.name === 'config' || dynamicFiles.some((file) => file === old || file.startsWith(old + '/'));
                addMove(`${to}/${item.name}`, `${to}/${dynamic ? 'dynamic' : 'static'}/${item.name}`, old);
            }
        }
        if (await db('query-asset-info', `db://${prefix}/generated`)) {
            for (const file of await listFiles(inside(`${prefix}/generated`))) {
                if (file.endsWith('.meta')) continue;
                const from = rel(file),
                    local = from.slice(`${prefix}/generated/`.length);
                addMove(from, `${prefix}/${local.startsWith('config/') ? 'code' : 'contracts'}/generated/${local}`);
            }
        }
        const mapPath = (file) => {
            const mapping = [...remaps]
                .sort((a, b) => b.from.length - a.from.length)
                .find((item) => file === item.from || file.startsWith(item.from + '/'));
            return mapping ? mapping.to + file.slice(mapping.from.length) : file;
        };
        const ts = require(path.join(root(), 'node_modules/typescript'));
        const config = ts.readConfigFile(inside('tsconfig.json'), ts.sys.readFile);
        const compiler = ts.parseJsonConfigFileContent(config.config, ts.sys, root());
        const edits = [];
        for (const file of (await listFiles(inside('assets/game'))).filter((file) => file.endsWith('.ts'))) {
            const before = await fs.readFile(file, 'utf8'),
                source = ts.createSourceFile(file, before, ts.ScriptTarget.Latest, true),
                changes = [];
            const visit = (node) => {
                if (
                    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                    node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                ) {
                    const target = ts.resolveModuleName(
                        node.moduleSpecifier.text,
                        file,
                        compiler.options,
                        ts.sys,
                    ).resolvedModule;
                    if (target) {
                        const afterFile = mapPath(rel(file)),
                            afterTarget = mapPath(rel(target.resolvedFileName));
                        if (afterFile !== rel(file) || afterTarget !== rel(target.resolvedFileName)) {
                            let relative = path
                                .relative(path.dirname(inside(afterFile)), inside(afterTarget))
                                .replaceAll('\\', '/')
                                .replace(/\.ts$/, '');
                            if (!relative.startsWith('.')) relative = './' + relative;
                            changes.push({
                                start: node.moduleSpecifier.getStart() + 1,
                                end: node.moduleSpecifier.getEnd() - 1,
                                value: relative,
                            });
                        }
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
            let after = before;
            for (const change of changes.sort((a, b) => b.start - a.start))
                after = after.slice(0, change.start) + change.value + after.slice(change.end);
            if (after !== before) edits.push({ from: rel(file), to: mapPath(rel(file)), before, after });
        }
        const legacy = await read(inside('config-source/tables.json')).catch((error) => {
            if (error.code === 'ENOENT') return { tables: [] };
            throw error;
        });
        const tables = legacy.tables.filter((table) => table.id.startsWith(manifest.id + '.'));
        for (const table of tables)
            if (!table.source.endsWith('.csv'))
                throw Error('旧 XLSX 需要先接入 __config 后迁移；当前自动迁移支持旧 CSV');
        const sources = [];
        for (const source of [...new Set(tables.map((table) => table.source))]) {
            const target = source.replace(/\.csv$/, '.xlsx');
            if (
                await fs.stat(inside(target)).then(
                    () => true,
                    (error) => {
                        if (error.code === 'ENOENT') return false;
                        throw error;
                    },
                )
            )
                throw Error(`迁移目标已存在：${target}`);
            sources.push({ source, target, bytes: await fs.readFile(inside(source), 'utf8') });
        }
        const files = await listFiles(directory),
            contents = await Promise.all(files.map(async (file) => [rel(file), hash(await fs.readFile(file))]));
        const plan = { module: manifest.id, prefix, manifest, moves, remaps, edits, sources, legacy, tables, contents };
        return { ...plan, signature: hash(JSON.stringify(plan)) };
    }
    async function migrateModule(args) {
        const plan = await previewMigration(args);
        if (args.signature !== plan.signature) throw Error('迁移内容已变化，请重新预览');
        if (await Editor.Message.request('scene', 'query-dirty')) throw Error('请先保存当前场景或预制体');
        const id = await journal('layout-migration', { module: args.module, plan });
        const archive = inside(`.yzforge/migrations/${id}`);
        for (const [source] of plan.contents) {
            const backup = path.join(archive, source);
            await fs.mkdir(path.dirname(backup), { recursive: true });
            await fs.copyFile(inside(source), backup);
        }
        // Seed existing logical IDs before moving resources. New layout no longer keeps a manual assets list.
        const identityPath = inside('project-settings/generated/resource-identities.json');
        const ledger = await read(identityPath).catch((error) => {
            if (error.code === 'ENOENT') return { formatVersion: 2, entries: {}, aliases: {} };
            throw error;
        });
        for (const [key, asset] of Object.entries(plan.manifest.assets ?? {}))
            ledger.entries[asset.uuid + (asset.atlasFrame ? '#' + asset.atlasFrame : '')] ??= {
                id: key,
                type: asset.type,
                active: true,
            };
        await saveJson(identityPath, ledger);
        const moved = [],
            createdSources = [];
        try {
            const tool = await workbookTools(),
                { parseCSV } = await import(pathToFileURL(inside('tools/yzforge/config.mjs')).href);
            for (const source of plan.sources) {
                const tables = plan.tables.filter((table) => table.source === source.source),
                    rows = parseCSV(source.bytes),
                    enums = [];
                for (let c = 0; c < (rows[1]?.length ?? 0); c++) {
                    const match = /^enum<([^>]+)>(\[\])?(\?)?$/.exec(rows[1][c]);
                    if (!match) continue;
                    const enumName = `${tables[0].id.split('.')[1]}${rows[0][c]}Enum`.replace(
                        /(^|-)([a-z])/g,
                        (_, _dash, ch) => ch.toUpperCase(),
                    );
                    match[1]
                        .split(',')
                        .forEach((value, index) =>
                            enums.push([enumName, `Value${index + 1}`, value.trim(), '', false]),
                        );
                    rows[1][c] = `enum<${enumName}>${match[2] ?? ''}${match[3] ?? ''}`;
                }
                const configuration = {
                    module: plan.module,
                    bundle: tables[0].bundle ?? 'default',
                    enabled: true,
                    tables: tables.map((table) => ({
                        ...table,
                        id: table.id.split('.')[1],
                        sheet: table.id.split('.')[1],
                        enabled: true,
                    })),
                };
                await tool.createWorkbook(
                    root(),
                    source.target,
                    configuration,
                    Object.fromEntries(configuration.tables.map((table) => [table.sheet, rows])),
                    enums,
                );
                createdSources.push(source.target);
            }
            for (const move of plan.moves) {
                await ensureFolder(path.dirname(inside(move.to)));
                const info = await db('query-asset-info', `db://${move.from}`);
                if (!info || (await db('query-asset-info', `db://${move.to}`)))
                    throw Error(`迁移源缺失或目标冲突：${move.from} → ${move.to}`);
                await db('move-asset', `db://${move.from}`, `db://${move.to}`, { overwrite: false, rename: false });
                const result = await db('query-asset-info', `db://${move.to}`);
                if (result?.uuid !== info.uuid) throw Error(`移动未保留 UUID：${move.from}`);
                moved.push({ ...move, uuid: info.uuid });
                await fs.writeFile(
                    path.join(archive, 'result.json'),
                    JSON.stringify({ stage: 'moving', moved, createdSources }, null, 2),
                );
            }
            const manifest = { ...JSON.parse(JSON.stringify(plan.manifest)), layoutVersion: 2 };
            delete manifest.assets;
            for (const [group, bundle] of Object.entries(manifest.bundles)) {
                bundle.root = `bundles/${group}`;
                await bundleFolder(inside(plan.prefix), bundle);
                await ensureFolder(inside(`${plan.prefix}/${bundle.root}/dynamic`));
                await ensureFolder(inside(`${plan.prefix}/${bundle.root}/static`));
            }
            await saveJson(inside(`${plan.prefix}/module.json`), manifest);
            await saveJson(inside('config-source/tables.json'), {
                ...plan.legacy,
                tables: plan.legacy.tables.filter((table) => !table.id.startsWith(plan.module + '.')),
            });
            for (const edit of plan.edits) await writeScript('save-asset', inside(edit.to), edit.after);
            await fs.writeFile(
                path.join(archive, 'result.json'),
                JSON.stringify({ stage: 'migrated', moved, createdSources }, null, 2),
            );
            return {
                module: plan.module,
                backup: rel(archive),
                moves: moved,
                sources: createdSources,
                changedImports: plan.edits.map((edit) => edit.to),
            };
        } catch (error) {
            await fs.mkdir(archive, { recursive: true });
            await fs.writeFile(
                path.join(archive, 'result.json'),
                JSON.stringify({ stage: 'interrupted', moved, createdSources, error: error.message }, null, 2),
            );
            throw Error(`迁移中断，完整备份和已执行步骤位于 ${rel(archive)}：${error.message}`, { cause: error });
        }
    }
    return { previewMigration, migrateModule };
};
