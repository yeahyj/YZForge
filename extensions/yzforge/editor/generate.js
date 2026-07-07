'use strict';

const fs = require('fs');
const path = require('path');
const { generatedJson, generatedText, isTextChanged, kebabCase, readJsonc, toPosix, walk, writeTextIfChanged } = require('./fs-utils');
const { scanProject } = require('./scanner');

function moduleBundleName(name) {
  return `yzforge-module-${kebabCase(name)}`;
}

function libraryBundleName(name) {
  return `yzforge-lib-${kebabCase(name)}`;
}

function contentPackBundleName(owner, name) {
  return `yzforge-content-pack-${kebabCase(owner)}-${kebabCase(name)}`;
}

function renderContract(descriptor, kind) {
  const publicPath = path.join(descriptor.dir, descriptor.public || 'code/public.ts');
  let body = 'export {};';
  if (!fs.existsSync(publicPath)) {
    return body;
  }
  body = fs.readFileSync(publicPath, 'utf8').trim() || 'export {};';
  if (kind === 'library') {
    return renderLibraryContract(descriptor, body);
  }
  return body;
}

function renderLibraryContract(library, body) {
  const tokenMapName = `${library.name}TokenMap`;
  const match = body.match(new RegExp(`export\\s+interface\\s+${tokenMapName}\\s*{([\\s\\S]*?)}`));
  if (!match) {
    return body;
  }

  const keys = [];
  const propertyPattern = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm;
  let property;
  while ((property = propertyPattern.exec(match[1])) !== null) {
    keys.push(property[1]);
  }

  const tokenEntries = keys.map((key) => `    ${key}: '${key}',`);
  return [
    "import { defineLibraryTokens } from 'yzforge';",
    '',
    body,
    '',
    `export const ${library.name}Tokens = defineLibraryTokens<${tokenMapName}>('${library.name}', {`,
    ...tokenEntries,
    '});',
  ].join('\n');
}

function renderModuleRef(module, libraries) {
  const libraryImports = module.libraries
    .map((name) => `import { ${name}Ref } from '../libraries/${name}.ref.generated';`)
    .join('\n');
  const imports = [
    "import { defineModuleRef } from 'yzforge';",
    module.enterParams ? `import type { ${module.enterParams} } from '../../contracts/modules/${module.name}.contract.generated';` : '',
    libraryImports,
  ].filter(Boolean).join('\n');
  const librariesExpr = module.libraries.map((name) => `${name}Ref`).join(', ');
  const params = module.enterParams || 'unknown';
  return [
    imports,
    '',
    `export const ${module.name}Ref = defineModuleRef<${params}>({`,
    `    name: '${module.name}',`,
    `    bundle: '${module.bundle}',`,
    `    libraries: [${librariesExpr}],`,
    '});',
  ].join('\n');
}

function renderLibraryRef(library) {
  const libraryImports = library.libraries
    .map((name) => `import { ${name}Ref } from './${name}.ref.generated';`)
    .join('\n');
  const librariesExpr = library.libraries.map((name) => `${name}Ref`).join(', ');
  return [
    "import { defineLibraryRef } from 'yzforge';",
    libraryImports,
    '',
    `export const ${library.name}Ref = defineLibraryRef({`,
    `    name: '${library.name}',`,
    `    bundle: '${library.bundle}',`,
    `    libraries: [${librariesExpr}],`,
    '});',
  ].filter(Boolean).join('\n');
}

function renderModuleEntry(module) {
  const libraryImports = module.libraries
    .map((name) => `import { ${name}Ref } from '../../../app/registry/libraries/${name}.ref.generated';`)
    .join('\n');
  const librariesExpr = module.libraries.map((name) => `${name}Ref`).join(', ');
  return [
    "import { defineModuleEntry, registerModuleEntry } from 'yzforge';",
    `import { ${module.name}Module } from './${module.name}Module';`,
    "import { assets } from './assets.generated';",
    "import { config } from './config.generated';",
    libraryImports,
    '',
    'registerModuleEntry(defineModuleEntry({',
    `    name: '${module.name}',`,
    `    bundle: '${module.bundle}',`,
    `    type: ${module.name}Module,`,
    '    assets,',
    '    config,',
    `    libraries: [${librariesExpr}],`,
    '}));',
  ].filter(Boolean).join('\n');
}

function renderLibraryEntry(library) {
  const libraryImports = library.libraries
    .map((name) => `import { ${name}Ref } from '../../../app/registry/libraries/${name}.ref.generated';`)
    .join('\n');
  const librariesExpr = library.libraries.map((name) => `${name}Ref`).join(', ');
  return [
    "import { defineLibraryEntry, registerLibraryEntry } from 'yzforge';",
    "import { assets } from './assets.generated';",
    "import { config } from './config.generated';",
    "import { providers } from './providers';",
    libraryImports,
    '',
    'registerLibraryEntry(defineLibraryEntry({',
    `    name: '${library.name}',`,
    `    bundle: '${library.bundle}',`,
    '    assets,',
    '    config,',
    `    libraries: [${librariesExpr}],`,
    '    tokens: providers,',
    '}));',
  ].filter(Boolean).join('\n');
}

function lowerCamelCase(name) {
  return String(name || '').replace(/^[A-Z]/, (value) => value.toLowerCase());
}

function withoutExt(filePath) {
  return filePath.replace(/\.[^.\\/]+$/, '');
}

function scanFiles(root, extension) {
  return walk(root, (filePath) => filePath.endsWith(extension) && !filePath.endsWith(`${extension}.meta`))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function assetPath(descriptor, filePath) {
  return toPosix(withoutExt(path.relative(descriptor.dir, filePath)));
}

function codeImportPath(codeDir, filePath) {
  let relative = toPosix(withoutExt(path.relative(codeDir, filePath)));
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative;
}

function inferViewKind(className) {
  for (const kind of ['Page', 'Paper', 'Popup', 'Toast', 'Top', 'System']) {
    if (className.startsWith(kind)) {
      return `ViewKind.${kind}`;
    }
  }
  return 'ViewKind.Page';
}

function inferRuntimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.prefab') return 'Prefab';
  if (ext === '.json') return 'JsonAsset';
  if (ext === '.scene') return 'SceneAsset';
  return 'Asset';
}

function scanRuntimeFiles(root) {
  return walk(root, (filePath) => {
    return !filePath.endsWith('.meta') && !filePath.endsWith('.DS_Store');
  }).sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

const AUTO_REF_COMPONENTS = new Set([
  'Animation',
  'Button',
  'Camera',
  'Canvas',
  'Component',
  'EditBox',
  'Graphics',
  'Label',
  'Layout',
  'Mask',
  'PageView',
  'ProgressBar',
  'RichText',
  'ScrollView',
  'Slider',
  'Sprite',
  'Toggle',
  'ToggleContainer',
  'UIOpacity',
  'UITransform',
  'VideoPlayer',
  'Widget',
]);

function parseAutoRefMarker(name, prefabPath) {
  const match = /^@([A-Za-z_$][\w$]*)(?::([A-Za-z_$][\w$.]*))?$/.exec(String(name || ''));
  if (!match) {
    return undefined;
  }
  let component = match[2] ? match[2].replace(/^cc\./, '') : undefined;
  if (component === 'Node') {
    component = undefined;
  }
  if (component && !AUTO_REF_COMPONENTS.has(component)) {
    throw new Error(`${toPosix(prefabPath)} has unsupported AutoRef component marker: ${name}`);
  }
  return {
    key: match[1],
    component,
  };
}

function scanAutoRefs(prefabPath) {
  let records;
  try {
    const data = JSON.parse(fs.readFileSync(prefabPath, 'utf8'));
    records = Array.isArray(data) ? data : [data];
  } catch (error) {
    throw new Error(`${toPosix(prefabPath)} prefab JSON cannot be parsed: ${error.message}`);
  }

  const refs = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record._name !== 'string') {
      continue;
    }
    const marker = parseAutoRefMarker(record._name, prefabPath);
    if (marker) {
      refs.push(marker);
    }
  }

  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref.key)) {
      throw new Error(`${toPosix(prefabPath)} has duplicate AutoRef marker: @${ref.key}`);
    }
    seen.add(ref.key);
  }

  return refs.sort((a, b) => a.key.localeCompare(b.key));
}

function renderAutoRefsBase(baseType, className, refs) {
  const ccImports = new Set();
  const runtimeImports = [baseType];
  if (refs.length > 0) {
    runtimeImports.push('bindAutoRefComponent', 'bindAutoRefNode');
  }
  for (const ref of refs) {
    ccImports.add(ref.component || 'Node');
  }

  const imports = [];
  if (ccImports.size > 0) {
    imports.push(`import { ${Array.from(ccImports).sort().join(', ')} } from 'cc';`);
  }
  imports.push(`import { ${runtimeImports.join(', ')} } from 'yzforge';`);

  const typeParams = baseType === 'View'
    ? '<TData = unknown, TResult = unknown>'
    : '<TData = unknown>';
  const extendsType = baseType === 'View'
    ? 'View<TData, TResult>'
    : 'Part<TData>';

  const lines = [
    ...imports,
    '',
    `export abstract class ${className}${typeParams} extends ${extendsType} {`,
  ];
  for (const ref of refs) {
    lines.push(`    protected ${ref.key}!: ${ref.component || 'Node'};`);
  }
  if (refs.length > 0) {
    lines.push('', '    protected override onBindRefs(): void {');
    for (const ref of refs) {
      if (ref.component) {
        lines.push(`        this.${ref.key} = bindAutoRefComponent(this.node, '${ref.key}', ${ref.component});`);
      } else {
        lines.push(`        this.${ref.key} = bindAutoRefNode(this.node, '${ref.key}');`);
      }
    }
    lines.push('    }');
  }
  lines.push('}');
  return lines.join('\n');
}

function writeAutoRefs(projectRoot, descriptor, writeGenerated) {
  const codeDir = path.join(descriptor.dir, 'code');
  for (const filePath of scanFiles(path.join(descriptor.dir, 'res', 'view'), '.prefab')) {
    const className = path.basename(filePath, '.prefab');
    const output = path.join(codeDir, 'view', 'refs', `${className}.refs.generated.ts`);
    writeGenerated(
      toPosix(path.relative(projectRoot, output)),
      toPosix(path.relative(projectRoot, filePath)),
      renderAutoRefsBase('View', `${className}Refs`, scanAutoRefs(filePath)),
    );
  }
  for (const filePath of scanFiles(path.join(descriptor.dir, 'res', 'part'), '.prefab')) {
    const className = path.basename(filePath, '.prefab');
    const output = path.join(codeDir, 'part', 'refs', `${className}.refs.generated.ts`);
    writeGenerated(
      toPosix(path.relative(projectRoot, output)),
      toPosix(path.relative(projectRoot, filePath)),
      renderAutoRefsBase('Part', `${className}Refs`, scanAutoRefs(filePath)),
    );
  }
}

function renderAssets(descriptor) {
  const codeDir = path.join(descriptor.dir, 'code');
  const viewFiles = scanFiles(path.join(descriptor.dir, 'res', 'view'), '.prefab');
  const partFiles = scanFiles(path.join(descriptor.dir, 'res', 'part'), '.prefab');
  const runtimeFiles = scanRuntimeFiles(path.join(descriptor.dir, 'res', 'runtime'));

  const runtimeTypes = Array.from(new Set(runtimeFiles.map(inferRuntimeType))).sort();
  const yzforgeImports = ['defineAssets'];
  if (runtimeFiles.length) yzforgeImports.push('assetRef');
  if (partFiles.length) yzforgeImports.push('partRef');
  if (viewFiles.length) yzforgeImports.push('viewRef', 'ViewKind');

  const imports = [];
  if (runtimeTypes.length) {
    imports.push(`import { ${runtimeTypes.join(', ')} } from 'cc';`);
  }
  imports.push(`import { ${yzforgeImports.join(', ')} } from 'yzforge';`);

  for (const filePath of viewFiles) {
    const className = path.basename(filePath, '.prefab');
    const scriptPath = path.join(codeDir, 'view', `${className}.ts`);
    imports.push(`import { ${className} } from '${codeImportPath(codeDir, scriptPath)}';`);
  }
  for (const filePath of partFiles) {
    const className = path.basename(filePath, '.prefab');
    const scriptPath = path.join(codeDir, 'part', `${className}.ts`);
    imports.push(`import { ${className} } from '${codeImportPath(codeDir, scriptPath)}';`);
  }

  const viewEntries = viewFiles.map((filePath) => {
    const className = path.basename(filePath, '.prefab');
    return `        ${lowerCamelCase(className)}: viewRef('${descriptor.name}', ${className}, '${assetPath(descriptor, filePath)}', { kind: ${inferViewKind(className)} }),`;
  });
  const partEntries = partFiles.map((filePath) => {
    const className = path.basename(filePath, '.prefab');
    return `        ${lowerCamelCase(className)}: partRef(${className}, '${assetPath(descriptor, filePath)}'),`;
  });
  const runtimeEntries = runtimeFiles.map((filePath) => {
    const name = path.basename(filePath, path.extname(filePath));
    return `        ${lowerCamelCase(name)}: assetRef(${inferRuntimeType(filePath)}, '${assetPath(descriptor, filePath)}'),`;
  });

  return [
    imports.join('\n'),
    '',
    'export const assets = defineAssets({',
    '    views: {',
    ...viewEntries,
    '    },',
    '    parts: {',
    ...partEntries,
    '    },',
    '    runtime: {',
    ...runtimeEntries,
    '    },',
    '});',
  ].join('\n');
}

function configTableRows(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value.rows)) {
      return value.rows;
    }
    if (Array.isArray(value.data)) {
      return value.data;
    }
  }
  return undefined;
}

function readConfigTableSpec(filePath) {
  const payload = readJsonc(filePath);
  const primaryKey = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.primaryKey === 'string'
    ? payload.primaryKey
    : 'id';
  return {
    primaryKey,
    rows: configTableRows(payload),
  };
}

function scanConfigTables(descriptor) {
  const root = path.join(descriptor.dir, 'res', 'content', 'config');
  const files = scanFiles(root, '.json');
  const tables = files.map((filePath) => {
    const spec = readConfigTableSpec(filePath);
    return {
      key: lowerCamelCase(path.basename(filePath, path.extname(filePath))),
      path: assetPath(descriptor, filePath),
      primaryKey: spec.primaryKey,
    };
  });
  const seen = new Set();
  for (const table of tables) {
    if (seen.has(table.key)) {
      throw new Error(`${descriptor.projectPath} has duplicate config table key: ${table.key}`);
    }
    seen.add(table.key);
  }
  return tables;
}

function renderConfig(descriptor) {
  const tableLines = scanConfigTables(descriptor).map((table) => {
    return `        ${table.key}: tableRef({ name: '${table.path}', primaryKey: '${table.primaryKey}' }),`;
  });
  return [
    "import { defineConfig, tableRef } from 'yzforge';",
    '',
    'export const config = defineConfig({',
    '    tables: {',
    ...tableLines,
    '    },',
    '});',
  ].join('\n');
}

function writeText(projectRoot, relativePath, content, options, changed) {
  const filePath = path.join(projectRoot, relativePath);
  const didChange = options.check
    ? isTextChanged(filePath, content)
    : writeTextIfChanged(filePath, content);
  if (didChange) {
    changed.push(relativePath);
  }
}

function writeJson(projectRoot, relativePath, value, options, changed) {
  writeText(projectRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`, options, changed);
}

function yzforgePackageExports() {
  return {
    '.': './assets/yzforge/runtime/index.ts',
    './modules/*': './assets/app/registry/modules/*.ref.generated.ts',
    './libraries/*': './assets/app/registry/libraries/*.ref.generated.ts',
    './content-packs/*': './assets/app/registry/content-packs/*.generated.ts',
    './contracts/modules/*': './assets/app/contracts/modules/*.contract.generated.ts',
    './contracts/libraries/*': './assets/app/contracts/libraries/*.contract.generated.ts',
    './contracts/content-packs/*': './assets/app/contracts/content-packs/*.contract.generated.ts',
    './contracts/extensions/*': './assets/app/contracts/extensions/*.contract.generated.ts',
    './shared/*': './assets/shared/code/*.ts',
  };
}

function updatePackageJson(projectRoot, options, changed) {
  const packagePath = path.join(projectRoot, 'package.json');
  const packageJson = fs.existsSync(packagePath) ? readJsonc(packagePath) : {};
  packageJson.name = 'yzforge';
  packageJson.private = true;
  packageJson.exports = yzforgePackageExports();
  writeText(projectRoot, 'package.json', `${JSON.stringify(packageJson, null, 2)}\n`, options, changed);
}

function scanExtensionFiles(projectRoot) {
  const root = path.join(projectRoot, 'assets', 'app', 'extensions');
  return scanFiles(root, '.ts')
    .filter((filePath) => !filePath.endsWith('.generated.ts'))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function extensionExportName(filePath) {
  return `${path.basename(filePath, '.ts')}Extension`;
}

function renderInstallGenerated(projectRoot) {
  const extensionFiles = scanExtensionFiles(projectRoot);
  if (extensionFiles.length === 0) {
    return [
      "import type { App } from 'yzforge';",
      '',
      'export async function installGeneratedExtensions(_app: App): Promise<void> {}',
    ].join('\n');
  }

  const imports = extensionFiles.map((filePath) => {
    const importPath = toPosix(withoutExt(path.relative(path.join(projectRoot, 'assets', 'app', 'bootstrap'), filePath)));
    return `import { ${extensionExportName(filePath)} } from '${importPath.startsWith('.') ? importPath : `./${importPath}`}';`;
  });
  const installLines = extensionFiles.map((filePath) => {
    return `    await app.installExtension(${extensionExportName(filePath)});`;
  });
  return [
    "import type { App } from 'yzforge';",
    ...imports,
    '',
    'export async function installGeneratedExtensions(app: App): Promise<void> {',
    ...installLines,
    '}',
  ].join('\n');
}

function renderModuleContentPacks(module, packs) {
  const owned = packs.filter((pack) => pack.owner === module.name);
  if (owned.length === 0) {
    return 'export const contentPacks = {};';
  }
  const packRefs = new Map(owned.map((pack) => [pack.id, scanContentPackRefs(pack)]));
  const allRefs = Array.from(packRefs.values()).flat();
  const assetRefs = allRefs.filter((ref) => ref.kind === 'asset');
  const configRefs = allRefs.filter((ref) => ref.kind === 'config');
  const contentPackTypes = Array.from(new Set(assetRefs.map((ref) => ref.type))).sort();
  const yzforgeImports = ['defineContentPack'];
  if (contentPackTypes.length > 0) {
    yzforgeImports.push('contentPackAssetRef');
  }
  if (configRefs.length > 0) {
    yzforgeImports.push('contentPackConfigRef');
  }
  const imports = owned
    .flatMap((pack) => pack.libraries || [])
    .filter((name, index, all) => all.indexOf(name) === index)
    .map((name) => `import { ${name}Ref } from '../../../app/registry/libraries/${name}.ref.generated';`);
  const entries = owned.map((pack) => {
    const libraries = (pack.libraries || []).map((name) => `${name}Ref`).join(', ');
    const exportName = `${pack.owner}${pack.name}ContentPack`;
    const refs = packRefs.get(pack.id) || [];
    const refsLines = refs.length === 0
      ? ['    refs: {},']
      : [
        '    refs: {',
        ...refs.map((ref) => {
          if (ref.kind === 'config') {
            return `        ${ref.key}: contentPackConfigRef('${ref.table}', { primaryKey: '${ref.primaryKey}' }),`;
          }
          return `        ${ref.key}: contentPackAssetRef(${ref.type}, '${ref.path}'),`;
        }),
        '    },',
      ];
    return [
      `export const ${exportName} = defineContentPack({`,
      `    id: '${pack.id}',`,
      `    owner: '${pack.owner}',`,
      `    name: '${pack.name}',`,
      `    bundle: '${pack.bundle}',`,
      `    libraries: [${libraries}],`,
      ...refsLines,
      '});',
    ].join('\n');
  });
  return [
    contentPackTypes.length > 0 ? `import { ${contentPackTypes.join(', ')} } from 'cc';` : '',
    `import { ${yzforgeImports.join(', ')} } from 'yzforge';`,
    ...imports,
    '',
    ...entries,
    '',
    'export const contentPacks = {',
    ...owned.map((pack) => `    ${pack.name}: ${pack.owner}${pack.name}ContentPack,`),
    '};',
  ].join('\n');
}

function scanContentPackRefs(pack) {
  const assetFiles = [
    ...scanFiles(path.join(pack.dir, 'res', 'prefab'), '.prefab'),
    ...scanFiles(path.join(pack.dir, 'res', 'scene'), '.scene'),
    ...scanRuntimeFiles(path.join(pack.dir, 'res', 'runtime')),
  ].sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
  const configFiles = scanFiles(path.join(pack.dir, 'res', 'content', 'config'), '.json');

  const refs = assetFiles.map((filePath) => ({
    kind: 'asset',
    key: lowerCamelCase(path.basename(filePath, path.extname(filePath))),
    path: assetPath(pack, filePath),
    type: inferRuntimeType(filePath),
  })).concat(configFiles.map((filePath) => {
    const spec = readConfigTableSpec(filePath);
    return {
      kind: 'config',
      key: lowerCamelCase(path.basename(filePath, path.extname(filePath))),
      table: assetPath(pack, filePath),
      primaryKey: spec.primaryKey,
    };
  }));
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref.key)) {
      throw new Error(`${pack.projectPath} has duplicate ContentPack ref key: ${ref.key}`);
    }
    seen.add(ref.key);
  }
  return refs;
}

function renderContentPackManifest(pack) {
  const refs = {};
  for (const ref of scanContentPackRefs(pack)) {
    if (ref.kind === 'config') {
      refs[ref.key] = {
        kind: 'config',
        table: ref.table,
        primaryKey: ref.primaryKey,
        codec: 'yzforge-json',
      };
    } else {
      refs[ref.key] = {
        kind: 'asset',
        type: ref.type,
        path: ref.path,
      };
    }
  }
  return {
    schemaVersion: 1,
    id: pack.id,
    owner: pack.owner,
    bundle: pack.bundle,
    refs,
  };
}

function updateTsconfig(projectRoot, options, changed) {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  const tsconfig = readJsonc(tsconfigPath);
  tsconfig.compilerOptions = tsconfig.compilerOptions || {};
  tsconfig.compilerOptions.strict = true;
  tsconfig.compilerOptions.skipLibCheck = true;
  tsconfig.compilerOptions.baseUrl = '.';
  tsconfig.compilerOptions.paths = {
    'db://internal/*': ['D:/Applications/Cocos/Editor/Creator/3.8.8/resources/resources/3d/engine/editor/assets/*'],
    'db://assets/*': [`${projectRoot.replace(/\\/g, '/')}/assets/*`],
    yzforge: ['assets/yzforge/runtime/index.ts'],
    'yzforge/modules/*': ['assets/app/registry/modules/*.ref.generated.ts'],
    'yzforge/libraries/*': ['assets/app/registry/libraries/*.ref.generated.ts'],
    'yzforge/content-packs/*': ['assets/app/registry/content-packs/*.generated.ts'],
    'yzforge/contracts/modules/*': ['assets/app/contracts/modules/*.contract.generated.ts'],
    'yzforge/contracts/libraries/*': ['assets/app/contracts/libraries/*.contract.generated.ts'],
    'yzforge/contracts/content-packs/*': ['assets/app/contracts/content-packs/*.contract.generated.ts'],
    'yzforge/contracts/extensions/*': ['assets/app/contracts/extensions/*.contract.generated.ts'],
    'yzforge/shared/*': ['assets/shared/code/*'],
  };
  writeText(projectRoot, 'tsconfig.json', `${JSON.stringify(tsconfig, null, 2)}\n`, options, changed);
}

function updateCocosProjectSettings(projectRoot, options, changed) {
  const settingsPath = path.join(projectRoot, 'settings', 'v2', 'packages', 'project.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = readJsonc(settingsPath);
  }
  settings.__version__ = settings.__version__ || '1.0.6';
  settings.script = settings.script || {};
  settings.script.importMap = 'project://import-map.json';
  writeText(projectRoot, 'settings/v2/packages/project.json', `${JSON.stringify(settings, null, 2)}\n`, options, changed);
}

function generate(projectRoot, options = {}) {
  const project = scanProject(projectRoot);
  const changed = [];
  const writeGenerated = (relativePath, source, body) => {
    writeText(projectRoot, relativePath, generatedText(source, body), options, changed);
  };

  for (const pack of project.contentPacks) {
    pack.bundle = pack.bundle || contentPackBundleName(pack.owner, pack.name);
    pack.libraries = pack.libraries || [];
  }

  for (const library of project.libraries) {
    library.bundle = library.bundle || libraryBundleName(library.name);
    library.libraries = library.libraries || [];
    writeGenerated(`assets/app/contracts/libraries/${library.name}.contract.generated.ts`, library.projectPath, renderContract(library, 'library'));
    writeGenerated(`assets/app/registry/libraries/${library.name}.ref.generated.ts`, library.projectPath, renderLibraryRef(library));
    writeGenerated(`assets/libraries/${library.name}/code/entry.generated.ts`, library.projectPath, renderLibraryEntry(library));
    writeGenerated(`assets/libraries/${library.name}/code/assets.generated.ts`, `assets/libraries/${library.name}/res`, renderAssets(library));
    writeGenerated(`assets/libraries/${library.name}/code/config.generated.ts`, `assets/libraries/${library.name}/res/content/config`, renderConfig(library));
  }

  for (const module of project.modules) {
    module.bundle = module.bundle || moduleBundleName(module.name);
    module.libraries = module.libraries || [];
    writeGenerated(`assets/app/contracts/modules/${module.name}.contract.generated.ts`, module.projectPath, renderContract(module, 'module'));
    writeGenerated(`assets/app/registry/modules/${module.name}.ref.generated.ts`, module.projectPath, renderModuleRef(module, project.libraries));
    writeAutoRefs(projectRoot, module, writeGenerated);
    writeGenerated(`assets/modules/${module.name}/code/entry.generated.ts`, module.projectPath, renderModuleEntry(module));
    writeGenerated(`assets/modules/${module.name}/code/assets.generated.ts`, `assets/modules/${module.name}/res`, renderAssets(module));
    writeGenerated(`assets/modules/${module.name}/code/config.generated.ts`, `assets/modules/${module.name}/res/content/config`, renderConfig(module));
    writeGenerated(`assets/modules/${module.name}/code/content-packs.generated.ts`, `assets/content-packs/${module.name}`, renderModuleContentPacks(module, project.contentPacks));
  }

  if (project.global) {
    writeAutoRefs(projectRoot, project.global, writeGenerated);
    writeGenerated('assets/app/global/code/assets.generated.ts', 'assets/app/global/res', renderAssets(project.global));
    writeGenerated('assets/app/global/code/config.generated.ts', 'assets/app/global/res/content/config', renderConfig(project.global));
  }

  const entryExports = project.modules
    .map((module) => `export { ${module.name}Ref } from './modules/${module.name}.ref.generated';`)
    .concat(project.libraries.map((library) => `export { ${library.name}Ref } from './libraries/${library.name}.ref.generated';`))
    .join('\n') || 'export {};';
  writeGenerated('assets/app/registry/entries.generated.ts', 'assets/app/registry', entryExports);

  writeJson(projectRoot, 'import-map.json', {
    imports: {
      yzforge: './assets/yzforge/runtime/index.ts',
      'yzforge/modules/': './assets/app/registry/modules/',
      'yzforge/libraries/': './assets/app/registry/libraries/',
      'yzforge/content-packs/': './assets/app/registry/content-packs/',
      'yzforge/contracts/': './assets/app/contracts/',
      'yzforge/shared/': './assets/shared/code/',
    },
  }, options, changed);
  updatePackageJson(projectRoot, options, changed);
  updateCocosProjectSettings(projectRoot, options, changed);
  updateTsconfig(projectRoot, options, changed);
  writeGenerated('assets/app/bootstrap/install.generated.ts', 'assets/app/bootstrap', renderInstallGenerated(projectRoot));

  for (const pack of project.contentPacks) {
    writeJson(
      projectRoot,
      toPosix(path.relative(projectRoot, path.join(pack.dir, 'manifest.generated.json'))),
      generatedJson(pack.projectPath, renderContentPackManifest(pack)),
      options,
      changed,
    );
  }

  return {
    global: Boolean(project.global),
    modules: project.modules.length,
    libraries: project.libraries.length,
    contentPacks: project.contentPacks.length,
    changed,
  };
}

module.exports = {
  contentPackBundleName,
  generate,
  libraryBundleName,
  moduleBundleName,
  renderAutoRefsBase,
  scanAutoRefs,
};
