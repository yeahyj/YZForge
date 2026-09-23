import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { register } from 'node:module';
import { compileTables } from './config.mjs';
import { lifecycleCheck, validateModules, codeBoundaryCheck } from './checks.mjs';
import settingsTools from './settings.cjs';
import gameConfigTools from './game-config.cjs';
import formatting from './format.cjs';
import { workbookSources } from './workbooks.mjs';
import { identityFile, scanCatalog, scriptDependencies } from './catalog.mjs';
import {
    digest,
    files,
    identifier,
    json,
    modules,
    pascal,
    safePath,
    writeBatch,
    withProjectLock,
    pendingTransactions,
} from './project.mjs';
register('./test-loader.mjs', import.meta.url);
const runtime = {
    ...(await import('../../assets/framework/assets/catalog.ts')),
    ...(await import('../../assets/framework/config/schema.ts')),
    ...(await import('../../assets/framework/config/config-table.ts')),
};
const forward = (path) => path.replaceAll('\\', '/');
// 生成键仍保持相同的对象结构，只为编辑器悬停增加说明。
const commentText = (value) =>
    String(value)
        .replace(/\*\//g, '* /')
        .replace(/[\r\n\u2028\u2029]+/g, ' ');
function resourceKeysSource(keys) {
    return (
        '{\n' +
        Object.entries(keys)
            .map(
                ([kind, entries]) =>
                    `  /** ${commentText(kind)} 资源键集合；动态目录自动编目，按需 load 时才加载内容。 */\n  ${JSON.stringify(kind)}: {\n` +
                    Object.entries(entries)
                        .map(
                            ([name, key]) =>
                                `    /** ${commentText(key.type)}：${commentText(key.id)}。传给 assets.load，预制体用 instantiate，图片可用 setSprite。 */\n    ${JSON.stringify(name)}: ${JSON.stringify(key)},`,
                        )
                        .join('\n') +
                    '\n  },',
            )
            .join('\n') +
        '\n}'
    );
}
async function metadata(root) {
    const lookup = new Map();
    for (const path of await files(resolve(root, 'assets'), '.meta')) {
        const meta = await json(path),
            source = path.slice(0, -5);
        if (meta.uuid) lookup.set(meta.uuid, { source, suffix: '', importer: meta.importer });
        const sub = (children, suffix) => {
            for (const value of Object.values(children ?? {})) {
                const name =
                    value.name ??
                    value.displayName ??
                    (value.importer === 'sprite-frame' ? 'spriteFrame' : value.importer === 'texture' ? 'texture' : '');
                if (value.uuid)
                    lookup.set(value.uuid, { source, suffix: suffix + '/' + name, importer: value.importer });
                sub(value.subMetas, suffix + '/' + name);
            }
        };
        sub(meta.subMetas, '');
    }
    return lookup;
}
export async function generate(root, input = {}) {
    return withProjectLock(root, async () => {
        if (!input.check && !input.preview) await gameConfigTools.assertUnlocked(root);
        const pending = await pendingTransactions(root);
        if (pending.length)
            throw Error('存在未完成生成，请在工作台预览并恢复：' + pending.map((item) => item.id).join(', '));
        return generateLocked(root, input);
    });
}
async function generateLocked(
    root,
    { check = false, preview = false, allowObsolete = false, platform, previewFormulas = false } = {},
) {
    const settings = await json(resolve(root, 'project-settings/framework.json'));
    const appOptions = settingsTools.runtimeOptions(settings);
    const projectModules = await modules(root);
    const issues = await lifecycleCheck(root);
    if (issues.length) throw Error(issues.join('\n'));
    const meta = await metadata(root),
        registry = new Map(),
        output = {},
        namespaces = {},
        bundles = {},
        definitions = [],
        viewDefinitions = [],
        imports = [];
    const sources = await workbookSources(root);
    const identities = await scanCatalog(root, projectModules, meta, sources);
    validateModules(projectModules);
    await codeBoundaryCheck(root, projectModules);
    const requiredScripts = await scriptDependencies(projectModules, meta);
    output[identityFile] = JSON.stringify(identities, null, 2) + '\n';
    const paths = new Set();
    for (const module of projectModules) {
        const prefix = forward(relative(root, module.directory));
        const generatedRoot = `${prefix}/${module.layoutVersion === 2 ? 'contracts/' : ''}generated`;
        const groups = new Map();
        for (const [group, definition] of Object.entries(module.bundles)) {
            const directory = await safePath(root, resolve(module.directory, definition.root));
            if ((await files(directory, '.ts')).length || (await files(directory, '.js')).length)
                throw Error(`Resource bundle contains executable code: ${directory}`);
            const folderMeta = meta.has([...meta].find(([, value]) => value.source === directory)?.[0]);
            const actual = await json(`${directory}.meta`);
            if (!folderMeta || actual.userData?.isBundle !== true || actual.userData?.bundleName !== definition.id)
                throw Error(`Use the Creator workbench to configure Bundle ${definition.id} at ${directory}`);
            bundles[definition.id] = {
                id: definition.id,
                namespace: `${module.id}/${group}`,
                ...(definition.location ? { location: definition.location } : {}),
                ...(definition.version ? { version: definition.version } : {}),
                dependencies: definition.dependencies ?? [],
            };
            namespaces[`${module.id}/${group}`] = { bundle: definition.id, path: 'yz-index' };
            groups.set(group, { formatVersion: 2, namespace: `${module.id}/${group}`, assets: {} });
        }
        const generatedKeys = new Map();
        for (const [id, registration] of Object.entries(module.assets ?? {})) {
            const key = runtime.logicalKey(id, registration.type),
                parts = key.id.split('/');
            if (parts[0] !== module.id || !groups.has(parts[1]) || registry.has(id))
                throw Error(`Invalid resource ownership or duplicate id: ${id}`);
            const asset = meta.get(registration.uuid);
            if (!asset || !registration.uuid || registration.uuid.includes('由'))
                throw Error(`Missing imported UUID for ${id}`);
            const belongs = projectModules
                .flatMap((owner) =>
                    Object.values(owner.bundles).map((bundle) => ({
                        owner,
                        bundle,
                        root: resolve(owner.directory, bundle.root),
                    })),
                )
                .filter((item) => {
                    const local = relative(item.root, asset.source);
                    return local && !local.startsWith('..') && !local.includes(':');
                })
                .sort((a, b) => b.root.length - a.root.length);
            if (belongs.length === 0) throw Error(`Registered resource is outside a declared bundle: ${id}`);
            const target = belongs[0],
                local = forward(relative(target.root, asset.source));
            const path = local.slice(0, local.length - extname(local).length) + asset.suffix;
            // The actual source UUID must identify the requested subasset; selecting a PNG root is not a SpriteFrame registration.
            const importers = {
                Prefab: 'prefab',
                SpriteFrame: 'sprite-frame',
                Texture2D: 'texture',
                AudioClip: 'audio-clip',
                JsonAsset: 'json',
                SpriteAtlas: 'sprite-atlas',
            };
            if (registration.atlasFrame) {
                if (
                    registration.type !== 'SpriteFrame' ||
                    asset.importer !== 'sprite-atlas' ||
                    typeof registration.atlasFrame !== 'string'
                )
                    throw Error(`${id}: atlas frames require SpriteFrame type and a SpriteAtlas UUID`);
            } else if (importers[registration.type] && asset.importer !== importers[registration.type])
                throw Error(`${id}: UUID importer ${asset.importer} does not match ${registration.type}`);
            const address = {
                bundle: target.bundle.id,
                path,
                type: registration.type,
                ...(registration.atlasFrame ? { atlasFrame: registration.atlasFrame } : {}),
                ...(['Prefab', 'SceneAsset'].includes(registration.type)
                    ? { requiredCodeModules: await requiredScripts(registration.uuid) }
                    : {}),
            };
            groups.get(parts[1]).assets[id] = address;
            registry.set(id, { ...registration, address });
            const publicName = `${parts[1]}/${parts[2]}/${identifier(parts.slice(3).join('-'))}`;
            if (generatedKeys.has(publicName)) throw Error(`Generated identifier collision: ${id}`);
            generatedKeys.set(publicName, key);
        }
        for (const [group, index] of groups) {
            const target = `${prefix}/${module.bundles[group].root}/yz-index.json`;
            output[target] = JSON.stringify(index, null, 2) + '\n';
            const keys = {};
            for (const [path, key] of generatedKeys) {
                const [keyGroup, kind, name] = path.split('/');
                if (keyGroup !== group) continue;
                (keys[kind] ??= {})[name] = key;
            }
            output[`${generatedRoot}/resources-${group}.ts`] =
                `// 根据 Creator 资源和稳定逻辑身份自动生成，请勿手动修改。\n/** ${module.id}/${group} 的类型化资源键；import 不加载资源，实际内容由 assets API 按 Scope 持有。 */\nexport const ${pascal(module.id)}${group === 'default' ? '' : pascal(group)}Res = ${resourceKeysSource(keys)} as const;\n`;
        }
        const viewTargets = [{ directory: generatedRoot, publicOnly: true }];
        if (module.code?.mode !== 'none')
            viewTargets.push({ directory: `${prefix}/${module.code?.root ?? 'code'}/generated`, publicOnly: false });
        for (const target of viewTargets) {
            const viewImports = [],
                viewKeys = [];
            const frameworkPath = forward(relative(resolve(root, target.directory), resolve(root, 'assets/framework')));
            for (const [name, view] of Object.entries(module.views ?? {})) {
                if (target.publicOnly && view.visibility !== 'public') continue;
                let types = 'unknown, unknown';
                if (view.binding && view.className) {
                    const type = identifier(view.className.split('.').pop());
                    const file = forward(view.binding)
                        .replace('/generated/', '/')
                        .replace(/Binding\.ts$/, '.types.ts');
                    const source = forward(
                        relative(
                            resolve(root, target.directory),
                            await safePath(root, resolve(module.directory, file)),
                        ),
                    ).replace(/\.ts$/, '');
                    viewImports.push(`import type { ${type}Params, ${type}Result } from ${JSON.stringify(source)};`);
                    types = `${type}Params, ${type}Result`;
                }
                const usage =
                    view.kind === 'page'
                        ? 'show.ui.pushPage 只等待切换完成；跨页面等待结果由外部会话使用 app.ui.pushPage。'
                        : 'show.ui.open 等待打开，handle.result 等待最终结果。';
                viewKeys.push(
                    `  /** ${commentText(`${module.id}.${name}`)}；${usage} */\n  ${identifier(name)}: { id: ${JSON.stringify(`${module.id}.${name}`)}, kind: ${JSON.stringify(view.kind)} } as ViewKey<${types}, ${JSON.stringify(view.kind)}>,`,
                );
            }
            output[`${target.directory}/views.ts`] =
                `// 自动生成的${target.publicOnly ? '公开' : '模块内部'}界面合同；import 不加载实现或资源。\nimport type { ViewKey } from '${frameworkPath}/ui/ui-manager';\n${viewImports.join('\n')}\n/** ${module.id} 的${target.publicOnly ? '明确公开' : '模块内全部'}界面引用。 */\nexport const ${pascal(module.id)}Views = {\n${viewKeys.join('\n')}\n} as const;\n`;
        }
        output[`${generatedRoot}/bundles.ts`] =
            `// 自动生成的 Bundle 引用。\n/** ${module.id} 的资源包引用；openBundle 只准备包，内部资源和配置仍按需加载。 */\nexport const ${pascal(module.id)}Bundles = {\n${Object.entries(
                module.bundles,
            )
                .map(
                    ([name, bundle]) =>
                        `  /** ${commentText(name)} 资源包，Bundle ID 为 ${commentText(bundle.id)}；可作为 config.load 的 bundle 选项。 */\n  ${JSON.stringify(identifier(name))}: { id: ${JSON.stringify(bundle.id)} },`,
                )
                .join('\n')}\n} as const;\n`;
        for (const [name, view] of Object.entries(module.views ?? {}))
            viewDefinitions.push({
                id: `${module.id}.${name}`,
                module: module.id,
                prefab: { id: view.prefab, type: 'Prefab' },
                kind: view.kind,
                cache: view.cache ?? 'none',
                duplicate: view.duplicate ?? 'reject',
                ...(view.modal !== undefined ? { modal: view.modal } : {}),
            });
        if (module.code?.mode !== 'none') {
            const dependencies = Object.entries(module.dependencies);
            const imports = dependencies.map(
                ([_alias, id], index) =>
                    `import { ${pascal(id)}Module as dependency${index} } from '../../../${id}/public';\n`,
            );
            output[`${prefix}/code/generated/dependencies.ts`] =
                `// 自动生成：依赖 ID 和别名只在 module.json 中维护。\n${imports.join('')}\n/** 本模块声明的业务依赖，工厂从中推导完整 API 类型。 */\nexport const dependencies = { ${dependencies.map(([alias], index) => `${JSON.stringify(alias)}: dependency${index}`).join(', ')} } as const;\n`;
        }
        if (module.code?.mode === 'none') {
            // 只有配置或资源归属，不装配业务工厂，也不引入空代码包。
        } else if (module.code?.mode === 'bundled') {
            const directory = await safePath(root, resolve(module.directory, module.code.root ?? 'code'));
            const actual = await json(`${directory}.meta`);
            if (!actual.userData?.isBundle || actual.userData.bundleName !== module.code.bundle)
                throw Error(`Code Bundle is not configured in Creator: ${module.id}`);
            if (bundles[module.code.bundle]) throw Error(`Duplicate code/resource Bundle: ${module.code.bundle}`);
            if (
                !meta.has(
                    [...meta].find(
                        ([, value]) => value.source === resolve(directory, `${module.code.entryPath}.prefab`),
                    )?.[0],
                )
            )
                throw Error(`Code entry Prefab missing: ${module.id}`);
            bundles[module.code.bundle] = { id: module.code.bundle, dependencies: [] };
            definitions.push(
                `{ id: ${JSON.stringify(module.id)}, dependencies: ${JSON.stringify(Object.values(module.dependencies))}, codeBundle: ${JSON.stringify(module.code.bundle)}, entryPath: ${JSON.stringify(module.code.entryPath)} }`,
            );
        } else {
            const factory = module.factory ?? {
                file: `code/${pascal(module.id)}Module.ts`,
                export: `create${pascal(module.id)}Module`,
            };
            const path = forward(
                relative(resolve(root, 'assets/game/app/generated'), resolve(module.directory, factory.file)),
            ).replace(/\.ts$/, '');
            const alias = `factory${pascal(module.id)}`;
            imports.push(`import { ${identifier(factory.export)} as ${alias} } from ${JSON.stringify(path)};`);
            definitions.push(
                `{ id: ${JSON.stringify(module.id)}, dependencies: ${JSON.stringify(Object.values(module.dependencies))}, factory: ${alias} }`,
            );
        }
    }
    for (const mapping of sources.tables) {
        const module = projectModules.find((item) => item.id === mapping.id.split('.')[0]);
        if (!module) continue;
        for (const group of mapping.shards
            ? Object.values(mapping.shards.targets).filter(Boolean)
            : [mapping.bundle ?? 'default']) {
            if (!module.bundles[group]) continue;
            const id = `${module.id}/${group}/json/config/${mapping.id.split('.')[1]}`;
            registry.set(id, {
                type: 'JsonAsset',
                address: {
                    bundle: module.bundles[group].id,
                    path: `${module.layoutVersion === 2 ? 'dynamic/' : ''}config/${mapping.id.split('.')[1]}`,
                    type: 'JsonAsset',
                },
            });
        }
    }
    const tables = await compileTables(root, projectModules, runtime, registry, {
        sources,
        preview: preview && previewFormulas,
    });
    Object.assign(output, tables.output);
    for (const module of projectModules)
        for (const [group, definition] of Object.entries(module.bundles)) {
            const target = `${forward(relative(root, module.directory))}/${definition.root}/yz-index.json`;
            const index = JSON.parse(output[target]);
            for (const [id, entry] of registry)
                if (id.startsWith(`${module.id}/${group}/`) && entry.address) index.assets[id] = entry.address;
            const keys = {};
            for (const [id, address] of Object.entries(index.assets)) {
                const parts = id.split('/'),
                    name = identifier(parts.slice(3).join('-'));
                if (keys[parts[2]]?.[name]) throw Error(`Generated resource identifier collision: ${id}`);
                (keys[parts[2]] ??= {})[name] = { id, type: address.type };
            }
            const generatedRoot = `${forward(relative(root, module.directory))}/${module.layoutVersion === 2 ? 'contracts/' : ''}generated`;
            output[`${generatedRoot}/resources-${group}.ts`] =
                `// 根据 dynamic 目录及稳定资源身份自动生成，请勿逐项手动添加或修改。\n/** ${module.id}/${group} 的类型化动态资源键；只描述资源身份，import 不会加载对应内容。 */\nexport const ${pascal(module.id)}${group === 'default' ? '' : pascal(group)}Res = ${resourceKeysSource(keys)} as const;\n`;
            const aliases = Object.fromEntries(
                Object.entries(identities.aliases).filter(([id]) => id.startsWith(`${module.id}/${group}/`)),
            );
            if (Object.keys(aliases).length) index.aliases = aliases;
            runtime.validateIndex(index, `${module.id}/${group}`);
            output[target] = JSON.stringify(index, null, 2) + '\n';
        }
    const release = { releaseId: settings.releaseId, bundles, namespaces, tables: tables.routes };
    if (typeof release.releaseId !== 'string' || !release.releaseId) throw Error('framework.json requires a releaseId');
    output['assets/game/app/generated/release.ts'] =
        `// 自动生成的发布快照；切换发布版本需要重启游戏运行时。\nimport type { ContentRelease } from '../../../framework/assets/asset-types';\n/** 当前发布的 Bundle、动态索引及配置路由；由 App 装配使用，运行中不修改。 */\nexport const release: ContentRelease = ${JSON.stringify(release, null, 2)};\n`;
    output['assets/game/app/generated/options.ts'] =
        `// 自动生成的项目设置，请通过工作台或源设置文件修改。\nimport type { AppOptions } from '../../../framework/core/app';\n/** App 的音频、日历及清理参数；日历 offsetMinutes 为固定时区分钟偏移，480 表示 UTC+8。 */\nexport const runtimeOptions: Pick<AppOptions, 'appId' | 'cleanupTimeoutMs' | 'maxAudioVoices' | 'audioChannels' | 'time' | 'clockOptions'> = ${JSON.stringify(appOptions, null, 2)};\n`;
    const gameConfig = await gameConfigTools.readConfig(root);
    output[gameConfigTools.outputPath] =
        `// 自动生成：GameSettings 已保存的选择 + project-settings/game-config.json 渠道参数。\nimport { freezeGameConfig } from '../../../framework/platform/game-config';\n/** 当前运行配置；地址与 SDK 参数在运行期间保持不变。 */\nexport const gameConfig = freezeGameConfig(${JSON.stringify(gameConfig, null, 2)});\n`;
    output[gameConfigTools.snapshotPath] = JSON.stringify(gameConfig, null, 2) + '\n';
    output[gameConfigTools.channelOptionsPath] = gameConfigTools.channelOptionsSource(
        await gameConfigTools.readSource(root),
    );
    output['assets/game/app/generated/assembly.ts'] =
        `// 根据 module.json 自动生成应用装配。\nimport type { ModuleDefinition } from '../../../framework/modules/module-manager';\nimport type { ViewDefinition } from '../../../framework/ui/ui-manager';\n${imports.join('\n')}\n/** 模块装配列表；登记或加载工厂代码不等于执行业务初始化，首次 use 才初始化。 */\nexport const modules: readonly ModuleDefinition[] = [\n${definitions.join(',\n')}\n];\n/** UI 装配列表，供 App 创建 UIManager；业务通过生成的 ViewKey 打开界面。 */\nexport const views: readonly ViewDefinition[] = ${JSON.stringify(viewDefinitions, null, 2)};\n`;
    const differences = [];
    for (const [path, source] of Object.entries(output)) {
        if (path.endsWith('.ts')) output[path] = await formatting.formatScript(resolve(root, path), source);
    }
    for (const [path, value] of Object.entries(output)) {
        if (paths.has(path.toLowerCase())) throw Error(`Output path collision ${path}`);
        paths.add(path.toLowerCase());
        let current = null;
        try {
            current = await readFile(resolve(root, path), 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (current !== value) differences.push(path);
    }
    let owned = {};
    try {
        owned = await json(resolve(root, 'project-settings/generated/generated-files.json'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        owned = await json(resolve(root, '.yzforge/generated-files.json')).catch((error) => {
            if (error.code === 'ENOENT') return {};
            throw error;
        });
    }
    const obsolete = [];
    for (const [path, hash] of Object.entries(owned)) {
        if (path in output) continue;
        let text;
        try {
            text = await readFile(await safePath(root, path), 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
        }
        if (digest(text) !== hash)
            throw Error(`Obsolete generated file was manually changed; review before removal: ${path}`);
        obsolete.push(path);
    }
    if (check && (differences.length || obsolete.length))
        throw Error(
            `Generated output is stale; use the workbench or npm run generate:\n${differences.join('\n')}\nObsolete files: ${obsolete.join(', ')}`,
        );
    if (!check && !preview && obsolete.length && !allowObsolete)
        throw Error(
            `Use the Creator workbench to inspect references and archive obsolete generated assets:\n${obsolete.join('\n')}`,
        );
    const result =
        check || preview
            ? { paths: differences, transaction: null }
            : await writeBatch(root, {
                  ...output,
                  'project-settings/generated/generated-files.json': JSON.stringify(
                      {
                          ...Object.fromEntries(obsolete.map((path) => [path, owned[path]])),
                          ...Object.fromEntries(Object.entries(output).map(([path, text]) => [path, digest(text)])),
                      },
                      null,
                      2,
                  ),
              });
    return {
        ...result,
        obsolete,
        moduleCount: projectModules.length,
        resources: registry.size,
        tables: tables.reports,
        checkedOutputs: Object.keys(output).length,
        platform: platform ?? 'preview',
        previewOnly: tables.previewOnly,
    };
}
