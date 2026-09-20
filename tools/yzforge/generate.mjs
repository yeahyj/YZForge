import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileTables } from './config.mjs';
import { lifecycleCheck, validateModules } from './checks.mjs';
import settingsTools from './settings.cjs';
import { digest, files, identifier, json, modules, pascal, safePath, writeBatch, withProjectLock } from './project.mjs';
register('./test-loader.mjs', import.meta.url);
const runtime = { ...await import('../../assets/framework/assets/catalog.ts'), ...await import('../../assets/framework/config/schema.ts'), ...await import('../../assets/framework/config/config-table.ts') };
const forward = path => path.replaceAll('\\', '/');
async function metadata(root) {
  const lookup = new Map();
  for (const path of await files(resolve(root, 'assets'), '.meta')) {
    const meta = await json(path), source = path.slice(0, -5);
    if (meta.uuid) lookup.set(meta.uuid, { source, suffix: '', importer: meta.importer });
    const sub = (children, suffix) => {
      for (const value of Object.values(children ?? {})) {
        const name = value.name ?? value.displayName ?? (value.importer === 'sprite-frame' ? 'spriteFrame' : value.importer === 'texture' ? 'texture' : '');
        if (value.uuid) lookup.set(value.uuid, { source, suffix: suffix + '/' + name, importer: value.importer });
        sub(value.subMetas, suffix + '/' + name);
      }
    };
    sub(meta.subMetas, '');
  }
  return lookup;
}
export async function generate(root, input = {}) { return withProjectLock(root, () => generateLocked(root, input)); }
async function generateLocked(root, { check = false, preview = false, allowObsolete = false } = {}) {
  const settings = await json(resolve(root, 'project-settings/framework.json'));
  const appOptions = settingsTools.runtimeOptions(settings);
  const projectModules = await modules(root); validateModules(projectModules);
  const issues = await lifecycleCheck(root); if (issues.length) throw Error(issues.join('\n'));
  const meta = await metadata(root), registry = new Map(), output = {}, namespaces = {}, bundles = {}, definitions = [], viewDefinitions = [], imports = [];
  const paths = new Set();
  for (const module of projectModules) {
    const prefix = forward(relative(root, module.directory));
    const groups = new Map();
    for (const [group, definition] of Object.entries(module.bundles)) {
      const directory = await safePath(root, resolve(module.directory, definition.root));
      if ((await files(directory, '.ts')).length || (await files(directory, '.js')).length) throw Error(`Resource bundle contains executable code: ${directory}`);
      const folderMeta = meta.has([...meta].find(([, value]) => value.source === directory)?.[0]);
      const actual = await json(`${directory}.meta`);
      if (!folderMeta || actual.userData?.isBundle !== true || actual.userData?.bundleName !== definition.id) throw Error(`Use the Creator workbench to configure Bundle ${definition.id} at ${directory}`);
      bundles[definition.id] = { id: definition.id, namespace: `${module.id}/${group}`, ...(definition.location ? { location: definition.location } : {}), ...(definition.version ? { version: definition.version } : {}), dependencies: definition.dependencies ?? [] };
      namespaces[`${module.id}/${group}`] = { bundle: definition.id, path: 'yz-index' };
      groups.set(group, { formatVersion: 1, namespace: `${module.id}/${group}`, assets: {} });
    }
    const generatedKeys = new Map();
    for (const [id, registration] of Object.entries(module.assets ?? {})) {
      const key = runtime.logicalKey(id, registration.type), parts = key.id.split('/');
      if (parts[0] !== module.id || !groups.has(parts[1]) || registry.has(id)) throw Error(`Invalid resource ownership or duplicate id: ${id}`);
      const asset = meta.get(registration.uuid); if (!asset || !registration.uuid || registration.uuid.includes('由')) throw Error(`Missing imported UUID for ${id}`);
      const belongs = projectModules.flatMap(owner => Object.values(owner.bundles).map(bundle => ({ owner, bundle, root: resolve(owner.directory, bundle.root) })))
        .filter(item => { const local = relative(item.root, asset.source); return local && !local.startsWith('..') && !local.includes(':'); }).sort((a, b) => b.root.length - a.root.length);
      if (belongs.length === 0) throw Error(`Registered resource is outside a declared bundle: ${id}`);
      const target = belongs[0], local = forward(relative(target.root, asset.source));
      let path = local.slice(0, local.length - extname(local).length) + asset.suffix;
      // The actual source UUID must identify the requested subasset; selecting a PNG root is not a SpriteFrame registration.
      const importers = { Prefab: 'prefab', SpriteFrame: 'sprite-frame', Texture2D: 'texture', AudioClip: 'audio-clip', JsonAsset: 'json', SpriteAtlas: 'sprite-atlas' };
      if (registration.atlasFrame) {
        if (registration.type !== 'SpriteFrame' || asset.importer !== 'sprite-atlas' || typeof registration.atlasFrame !== 'string') throw Error(`${id}: atlas frames require SpriteFrame type and a SpriteAtlas UUID`);
      } else if (importers[registration.type] && asset.importer !== importers[registration.type]) throw Error(`${id}: UUID importer ${asset.importer} does not match ${registration.type}`);
      const address = { bundle: target.bundle.id, path, type: registration.type, ...(registration.atlasFrame ? { atlasFrame: registration.atlasFrame } : {}), ...(registration.type === 'Prefab' ? { codeModule: module.id } : {}) };
      groups.get(parts[1]).assets[id] = address; registry.set(id, { ...registration, address });
      const publicName = `${parts[1]}/${parts[2]}/${identifier(parts[3])}`;
      if (generatedKeys.has(publicName)) throw Error(`Generated identifier collision: ${id}`); generatedKeys.set(publicName, key);
    }
    for (const [group, index] of groups) {
      const target = `${prefix}/${module.bundles[group].root}/yz-index.json`;
      output[target] = JSON.stringify(index, null, 2) + '\n';
      const keys = {};
      for (const [path, key] of generatedKeys) {
        const [keyGroup, kind, name] = path.split('/'); if (keyGroup !== group) continue;
        (keys[kind] ??= {})[name] = key;
      }
      output[`${prefix}/generated/resources-${group}.ts`] = `// Generated from module.json UUID registrations.\nexport const ${pascal(module.id)}${group === 'default' ? '' : pascal(group)}Res = ${JSON.stringify(keys, null, 2)} as const;\n`;
    }
    const viewImports = [], viewKeys = [];
    const frameworkPath = forward(relative(resolve(module.directory, 'generated'), resolve(root, 'assets/framework')));
    for (const [name, view] of Object.entries(module.views ?? {})) {
      let types = 'unknown, unknown';
      if (view.binding && view.className) {
        const type = identifier(view.className.split('.').pop());
        const file = forward(view.binding).replace('/generated/', '/').replace(/Binding\.ts$/, '.types.ts');
        const source = forward(relative(resolve(module.directory, 'generated'), await safePath(root, resolve(module.directory, file)))).replace(/\.ts$/, '');
        viewImports.push(`import type { ${type}Params, ${type}Result } from ${JSON.stringify(source)};`);
        types = `${type}Params, ${type}Result`;
      }
      viewKeys.push(`  ${identifier(name)}: { id: ${JSON.stringify(`${module.id}.${name}`)} } as ViewKey<${types}>,`);
    }
    output[`${prefix}/generated/views.ts`] = `// Generated typed view references. No prefab, component or row data is imported.\nimport type { ViewKey } from '${frameworkPath}/ui/ui-manager';\n${viewImports.join('\n')}\nexport const ${pascal(module.id)}Views = {\n${viewKeys.join('\n')}\n} as const;\n`;
    output[`${prefix}/generated/bundles.ts`] = `// Generated bundle references.\nexport const ${pascal(module.id)}Bundles = ${JSON.stringify(Object.fromEntries(Object.entries(module.bundles).map(([name, bundle]) => [identifier(name), { id: bundle.id }])), null, 2)} as const;\n`;
    for (const [name, view] of Object.entries(module.views ?? {})) viewDefinitions.push({ id: `${module.id}.${name}`, module: module.id, prefab: { id: view.prefab, type: 'Prefab' }, kind: view.kind, cache: view.cache ?? 'none', duplicate: view.duplicate ?? 'reject', ...(view.modal !== undefined ? { modal: view.modal } : {}) });
    if (module.code?.mode === 'bundled') {
      if (!settings.platforms?.[settings.activePlatform]?.bundledVerified) throw Error(`bundled code is not validated for platform ${settings.activePlatform}`);
      definitions.push(`{ id: ${JSON.stringify(module.id)}, dependencies: ${JSON.stringify(module.dependencies)}, codeBundle: ${JSON.stringify(module.code.bundle)}, entryPath: ${JSON.stringify(module.code.entryPath)} }`);
    } else {
      const factory = module.factory ?? { file: `code/${pascal(module.id)}Module.ts`, export: `create${pascal(module.id)}Module` };
      const path = forward(relative(resolve(root, 'assets/game/app/generated'), resolve(module.directory, factory.file))).replace(/\.ts$/, '');
      const alias = `factory${pascal(module.id)}`;
      imports.push(`import { ${identifier(factory.export)} as ${alias} } from ${JSON.stringify(path)};`);
      definitions.push(`{ id: ${JSON.stringify(module.id)}, dependencies: ${JSON.stringify(module.dependencies)}, factory: ${alias} }`);
    }
  }
  const tables = await compileTables(root, projectModules, runtime, registry); Object.assign(output, tables.output);
  const release = { releaseId: settings.releaseId, bundles, namespaces, tables: tables.routes };
  if (typeof release.releaseId !== 'string' || !release.releaseId) throw Error('framework.json requires a releaseId');
  output['assets/game/app/generated/release.ts'] = `// Generated release snapshot. Restart the game runtime to select another release.\nimport type { ContentRelease } from '../../../framework/assets/asset-types';\nexport const release: ContentRelease = ${JSON.stringify(release, null, 2)};\n`;
  output['assets/game/app/generated/options.ts'] = `// Generated project settings. Framework defaults do not select a game, resolution or time zone.\nimport type { AppOptions } from '../../../framework/core/app';\nexport const runtimeOptions: Pick<AppOptions, 'appId' | 'cleanupTimeoutMs' | 'maxAudioVoices' | 'audioChannels' | 'time' | 'clockOptions'> = ${JSON.stringify(appOptions, null, 2)};\n`;
  output['assets/game/app/generated/assembly.ts'] = `// Generated from module.json.\nimport type { ModuleDefinition } from '../../../framework/modules/module-manager';\nimport type { ViewDefinition } from '../../../framework/ui/ui-manager';\n${imports.join('\n')}\nexport const modules: readonly ModuleDefinition[] = [\n${definitions.join(',\n')}\n];\nexport const views: readonly ViewDefinition[] = ${JSON.stringify(viewDefinitions, null, 2)};\n`;
  const differences = [];
  for (const [path, value] of Object.entries(output)) {
    if (paths.has(path.toLowerCase())) throw Error(`Output path collision ${path}`); paths.add(path.toLowerCase());
    let current = null; try { current = await readFile(resolve(root, path), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current !== value) differences.push(path);
  }
  let owned = {}; try { owned = await json(resolve(root, '.yzforge/generated-files.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const obsolete = [];
  for (const [path, hash] of Object.entries(owned)) {
    if (path in output) continue;
    let text; try { text = await readFile(await safePath(root, path), 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (digest(text) !== hash) throw Error(`Obsolete generated file was manually changed; review before removal: ${path}`);
    obsolete.push(path);
  }
  if (check && (differences.length || obsolete.length)) throw Error(`Generated output is stale; use the workbench or npm run generate:\n${differences.join('\n')}\nObsolete files: ${obsolete.join(', ')}`);
  if (!check && !preview && obsolete.length && !allowObsolete) throw Error(`Use the Creator workbench to inspect references and archive obsolete generated assets:\n${obsolete.join('\n')}`);
  const result = check || preview ? { paths: differences, transaction: null } : await writeBatch(root, {
    ...output,
    '.yzforge/generated-files.json': JSON.stringify({ ...Object.fromEntries(obsolete.map(path => [path, owned[path]])), ...Object.fromEntries(Object.entries(output).map(([path,text])=>[path,digest(text)])) }, null, 2),
  });
  return { ...result, obsolete, moduleCount: projectModules.length, resources: registry.size, tables: tables.reports, checkedOutputs: Object.keys(output).length };
}
