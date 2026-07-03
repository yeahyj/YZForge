'use strict';

const fs = require('fs');
const path = require('path');
const { generatedText, kebabCase, readJsonc, writeJsonIfChanged, writeTextIfChanged } = require('./fs-utils');
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

function renderContract(descriptor) {
  const publicPath = path.join(descriptor.dir, descriptor.public || 'code/public.ts');
  if (!fs.existsSync(publicPath)) {
    return 'export {};';
  }
  return fs.readFileSync(publicPath, 'utf8').trim() || 'export {};';
}

function renderModuleRef(module, libraries) {
  const libraryImports = module.libraries
    .map((name) => `import { ${name}Ref } from '../libraries/${name}.ref.generated';`)
    .join('\n');
  const imports = [
    "import { defineModuleRef } from '../../../yzforge/runtime';",
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
    "import { defineLibraryRef } from '../../../yzforge/runtime';",
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
    "import { defineModuleEntry, registerModuleEntry } from '../../../yzforge/runtime';",
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
    "import { defineLibraryEntry, registerLibraryEntry } from '../../../yzforge/runtime';",
    "import { assets } from './assets.generated';",
    "import { config } from './config.generated';",
    libraryImports,
    '',
    'registerLibraryEntry(defineLibraryEntry({',
    `    name: '${library.name}',`,
    `    bundle: '${library.bundle}',`,
    '    assets,',
    '    config,',
    `    libraries: [${librariesExpr}],`,
    '    tokens: {},',
    '}));',
  ].filter(Boolean).join('\n');
}

function renderEmptyAssets() {
  return [
    "import { defineAssets } from '../../../yzforge/runtime';",
    '',
    'export const assets = defineAssets({',
    '    views: {},',
    '    parts: {},',
    '    runtime: {},',
    '});',
  ].join('\n');
}

function renderEmptyConfig() {
  return [
    "import { defineConfig } from '../../../yzforge/runtime';",
    '',
    'export const config = defineConfig({',
    '    tables: {},',
    '});',
  ].join('\n');
}

function renderInstallGenerated() {
  return [
    "import type { App } from '../../yzforge/runtime';",
    '',
    'export async function installGeneratedExtensions(_app: App): Promise<void> {}',
  ].join('\n');
}

function renderModuleContentPacks(module, packs) {
  const owned = packs.filter((pack) => pack.owner === module.name);
  if (owned.length === 0) {
    return 'export const contentPacks = {};';
  }
  const imports = owned
    .flatMap((pack) => pack.libraries || [])
    .filter((name, index, all) => all.indexOf(name) === index)
    .map((name) => `import { ${name}Ref } from '../../../app/registry/libraries/${name}.ref.generated';`);
  const entries = owned.map((pack) => {
    const libraries = (pack.libraries || []).map((name) => `${name}Ref`).join(', ');
    const exportName = `${pack.owner}${pack.name}ContentPack`;
    return [
      `export const ${exportName} = defineContentPack({`,
      `    id: '${pack.id}',`,
      `    owner: '${pack.owner}',`,
      `    name: '${pack.name}',`,
      `    bundle: '${pack.bundle}',`,
      `    libraries: [${libraries}],`,
      '    refs: {},',
      '});',
    ].join('\n');
  });
  return [
    "import { defineContentPack } from '../../../yzforge/runtime';",
    ...imports,
    '',
    ...entries,
    '',
    'export const contentPacks = {',
    ...owned.map((pack) => `    ${pack.name}: ${pack.owner}${pack.name}ContentPack,`),
    '};',
  ].join('\n');
}

function updateTsconfig(projectRoot) {
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
    'yzforge/*': ['assets/yzforge/runtime/*'],
    'yzforge/modules/*': ['assets/app/registry/modules/*.ref.generated.ts'],
    'yzforge/libraries/*': ['assets/app/registry/libraries/*.ref.generated.ts'],
    'yzforge/content-packs/*': ['assets/app/registry/content-packs/*.generated.ts'],
    'yzforge-contracts/modules/*': ['assets/app/contracts/modules/*.contract.generated.ts'],
    'yzforge-contracts/libraries/*': ['assets/app/contracts/libraries/*.contract.generated.ts'],
    'yzforge-contracts/content-packs/*': ['assets/app/contracts/content-packs/*.contract.generated.ts'],
    'yzforge-contracts/extensions/*': ['assets/app/contracts/extensions/*.contract.generated.ts'],
    'yzforge-shared/*': ['assets/shared/code/*'],
  };
  writeTextIfChanged(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
}

function generate(projectRoot) {
  const project = scanProject(projectRoot);
  const changed = [];
  const writeGenerated = (relativePath, source, body) => {
    const filePath = path.join(projectRoot, relativePath);
    if (writeTextIfChanged(filePath, generatedText(source, body))) {
      changed.push(relativePath);
    }
  };

  for (const library of project.libraries) {
    library.bundle = library.bundle || libraryBundleName(library.name);
    library.libraries = library.libraries || [];
    writeGenerated(`assets/app/contracts/libraries/${library.name}.contract.generated.ts`, library.projectPath, renderContract(library));
    writeGenerated(`assets/app/registry/libraries/${library.name}.ref.generated.ts`, library.projectPath, renderLibraryRef(library));
    writeGenerated(`assets/libraries/${library.name}/code/entry.generated.ts`, library.projectPath, renderLibraryEntry(library));
    writeGenerated(`assets/libraries/${library.name}/code/assets.generated.ts`, `assets/libraries/${library.name}/res`, renderEmptyAssets());
    writeGenerated(`assets/libraries/${library.name}/code/config.generated.ts`, `assets/libraries/${library.name}/res/content/config`, renderEmptyConfig());
  }

  for (const module of project.modules) {
    module.bundle = module.bundle || moduleBundleName(module.name);
    module.libraries = module.libraries || [];
    writeGenerated(`assets/app/contracts/modules/${module.name}.contract.generated.ts`, module.projectPath, renderContract(module));
    writeGenerated(`assets/app/registry/modules/${module.name}.ref.generated.ts`, module.projectPath, renderModuleRef(module, project.libraries));
    writeGenerated(`assets/modules/${module.name}/code/entry.generated.ts`, module.projectPath, renderModuleEntry(module));
    writeGenerated(`assets/modules/${module.name}/code/assets.generated.ts`, `assets/modules/${module.name}/res`, renderEmptyAssets());
    writeGenerated(`assets/modules/${module.name}/code/config.generated.ts`, `assets/modules/${module.name}/res/content/config`, renderEmptyConfig());
    writeGenerated(`assets/modules/${module.name}/code/content-packs.generated.ts`, `assets/content-packs/${module.name}`, renderModuleContentPacks(module, project.contentPacks));
  }

  const entryExports = project.modules
    .map((module) => `export { ${module.name}Ref } from './modules/${module.name}.ref.generated';`)
    .concat(project.libraries.map((library) => `export { ${library.name}Ref } from './libraries/${library.name}.ref.generated';`))
    .join('\n') || 'export {};';
  writeGenerated('assets/app/registry/entries.generated.ts', 'assets/app/registry', entryExports);

  writeJsonIfChanged(path.join(projectRoot, 'import-map.json'), {
    imports: {
      yzforge: './assets/yzforge/runtime/index',
      'yzforge/': './assets/yzforge/runtime/',
      'yzforge/modules/': './assets/app/registry/modules/',
      'yzforge/libraries/': './assets/app/registry/libraries/',
      'yzforge/content-packs/': './assets/app/registry/content-packs/',
      'yzforge-contracts/': './assets/app/contracts/',
      'yzforge-shared/': './assets/shared/code/',
    },
  });
  updateTsconfig(projectRoot);
  writeGenerated('assets/app/bootstrap/install.generated.ts', 'assets/app/bootstrap', renderInstallGenerated());

  for (const pack of project.contentPacks) {
    pack.bundle = pack.bundle || contentPackBundleName(pack.owner, pack.name);
    writeJsonIfChanged(path.join(pack.dir, 'manifest.generated.json'), {
      schemaVersion: 1,
      id: pack.id,
      owner: pack.owner,
      bundle: pack.bundle,
      refs: {},
    });
  }

  return {
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
};
