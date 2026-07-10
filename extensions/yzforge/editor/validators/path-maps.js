'use strict';

const path = require('path');
const { readJsonc, toPosix } = require('../fs-utils');

function validatePathMaps(projectRoot, issues) {
  const expectedTsPaths = {
    yzforge: ['./packages/yzforge-runtime/src/index.ts'],
    'yzforge/authoring': ['./packages/yzforge-runtime/src/authoring.ts'],
    'yzforge/modules/*': ['./assets/app/registry/modules/*.ref.generated.ts'],
    'yzforge/libraries/*': ['./assets/app/registry/libraries/*.ref.generated.ts'],
    'yzforge/content-packs/*': ['./assets/app/registry/content-packs/*.generated.ts'],
    'yzforge/contracts/modules/*': ['./assets/app/contracts/modules/*.contract.generated.ts'],
    'yzforge/contracts/libraries/*': ['./assets/app/contracts/libraries/*.contract.generated.ts'],
    'yzforge/contracts/content-packs/*': ['./assets/app/contracts/content-packs/*.contract.generated.ts'],
    'yzforge/contracts/extensions/*': ['./assets/app/contracts/extensions/*.contract.generated.ts'],
    'yzforge/shared/*': ['./assets/shared/code/*'],
  };
  const expectedImports = {
    yzforge: './assets/yzforge/runtime/index.ts',
    'yzforge/authoring': './assets/yzforge/runtime/authoring.ts',
    'yzforge/modules/': './assets/app/registry/modules/',
    'yzforge/libraries/': './assets/app/registry/libraries/',
    'yzforge/content-packs/': './assets/app/registry/content-packs/',
    'yzforge/contracts/': './assets/app/contracts/',
    'yzforge/shared/': './assets/shared/code/',
  };
  const legacyTsAliases = [
    'yzforge-contracts/modules/*',
    'yzforge-contracts/libraries/*',
    'yzforge-contracts/content-packs/*',
    'yzforge-contracts/extensions/*',
    'yzforge-shared/*',
  ];
  const legacyImportAliases = ['yzforge-contracts/', 'yzforge-shared/'];

  let rootTsconfig;
  let tsconfig;
  try {
    rootTsconfig = readJsonc(path.join(projectRoot, 'tsconfig.json'));
    tsconfig = readJsonc(path.join(projectRoot, 'tsconfig.yzforge.json'));
  } catch (error) {
    issues.push(`tsconfig.json or tsconfig.yzforge.json cannot be read: ${error.message}.`, {
      path: 'tsconfig.yzforge.json',
      code: 'path_map.invalid',
    });
  }
  if (rootTsconfig?.extends !== './tsconfig.yzforge.json') {
    issues.push("tsconfig.json must extend './tsconfig.yzforge.json'; YZForge only owns the derived config.", {
      path: 'tsconfig.json',
      code: 'path_map.tsconfig',
      target: 'extends',
    });
  }
  const actualPaths = tsconfig?.compilerOptions?.paths || {};
  const normalizedExtends = typeof rootTsconfig?.extends === 'string' ? toPosix(rootTsconfig.extends) : undefined;
  if (normalizedExtends && normalizedExtends.includes('temp/tsconfig.cocos.json')) {
    issues.push(`tsconfig.json must not extend Cocos temp config '${rootTsconfig.extends}'; YZForge typecheck generates its local Cocos config at runtime.`, {
      path: 'tsconfig.json',
      code: 'path_map.tsconfig_portability',
      target: 'extends',
    });
  }

  const actualTypes = rootTsconfig?.compilerOptions?.types;
  if (Array.isArray(actualTypes) && actualTypes.some((entry) => toPosix(entry).includes('temp/declarations/'))) {
    issues.push('tsconfig.json compilerOptions.types must not depend on temp/declarations; ToolchainResolver provides Cocos declarations for typecheck.', {
      path: 'tsconfig.json',
      code: 'path_map.tsconfig_portability',
      target: 'compilerOptions.types',
    });
  }
  if (rootTsconfig?.compilerOptions?.baseUrl !== undefined || tsconfig?.compilerOptions?.baseUrl !== undefined) {
    issues.push('tsconfig.json compilerOptions.baseUrl must not be set; TypeScript 6 deprecates baseUrl and YZForge path aliases resolve relative to tsconfig.json without it.', {
      path: 'tsconfig.json',
      code: 'path_map.tsconfig_baseurl_deprecated',
      target: 'compilerOptions.baseUrl',
    });
  }
  if (tsconfig?.compilerOptions?.moduleResolution !== 'bundler') {
    issues.push(`tsconfig.yzforge.json compilerOptions.moduleResolution must be 'bundler', got '${tsconfig?.compilerOptions?.moduleResolution}'.`, {
      path: 'tsconfig.yzforge.json',
      code: 'path_map.tsconfig_module_resolution',
      target: 'compilerOptions.moduleResolution',
    });
  }

  const projectRootPosix = toPosix(path.resolve(projectRoot)).toLowerCase();
  for (const [alias, targets] of Object.entries(actualPaths)) {
    const values = Array.isArray(targets) ? targets : [targets];
    for (const target of values) {
      if (typeof target !== 'string') {
        continue;
      }
      const normalizedTarget = toPosix(target);
      if (path.isAbsolute(target) && normalizedTarget.toLowerCase().startsWith(projectRootPosix)) {
        issues.push(`tsconfig.yzforge.json paths.${alias} must not contain project-root absolute path '${normalizedTarget}'; use project-relative paths.`, {
          path: 'tsconfig.yzforge.json',
          code: 'path_map.tsconfig_portability',
          target: alias,
        });
      }
    }
  }

  const expectedDbAssetsPath = ['./assets/*'];
  const actualDbAssetsPath = actualPaths['db://assets/*'];
  if (JSON.stringify(actualDbAssetsPath) !== JSON.stringify(expectedDbAssetsPath)) {
    issues.push(`tsconfig.yzforge.json paths.db://assets/* must be ${JSON.stringify(expectedDbAssetsPath)}, got ${JSON.stringify(actualDbAssetsPath)}.`, {
      path: 'tsconfig.yzforge.json',
      code: 'path_map.tsconfig',
      target: 'db://assets/*',
    });
  }
  const actualCocosInternalPath = actualPaths['db://internal/*'];
  if (actualCocosInternalPath !== undefined) {
    issues.push(`tsconfig.yzforge.json must not commit paths.db://internal/* (${JSON.stringify(actualCocosInternalPath)}); ToolchainResolver injects Cocos internal paths into the generated typecheck config.`, {
      path: 'tsconfig.yzforge.json',
      code: 'path_map.tsconfig_portability',
      target: 'db://internal/*',
    });
  }
  const forbiddenTsRuntimePath = actualPaths['yzforge/*'];
  if (forbiddenTsRuntimePath !== undefined) {
    issues.push('tsconfig.yzforge.json must not expose runtime deep path alias yzforge/*; import runtime API through yzforge.', {
      path: 'tsconfig.yzforge.json',
      code: 'path_map.runtime_deep_alias',
      target: 'yzforge/*',
    });
  }
  for (const alias of legacyTsAliases) {
    if (actualPaths[alias] !== undefined) {
      issues.push(`tsconfig.yzforge.json must not expose legacy alias ${alias}; use yzforge/contracts/* or yzforge/shared/* under the yzforge package namespace.`, {
        path: 'tsconfig.yzforge.json',
        code: 'path_map.legacy_alias',
        target: alias,
      });
    }
  }
  for (const [alias, expected] of Object.entries(expectedTsPaths)) {
    const actual = actualPaths[alias];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      issues.push(`tsconfig.yzforge.json paths.${alias} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`, {
        path: 'tsconfig.yzforge.json',
        code: 'path_map.tsconfig',
        target: alias,
      });
    }
  }

  let importMap;
  try {
    importMap = readJsonc(path.join(projectRoot, 'import-map.json'));
  } catch (error) {
    issues.push(`import-map.json cannot be read: ${error.message}.`, {
      path: 'import-map.json',
      code: 'path_map.invalid',
    });
  }
  const actualImports = importMap?.imports || {};
  if (actualImports['yzforge/'] !== undefined) {
    issues.push('import-map.json must not expose runtime deep path prefix yzforge/; import runtime API through yzforge.', {
      path: 'import-map.json',
      code: 'path_map.runtime_deep_alias',
      target: 'yzforge/',
    });
  }
  for (const alias of legacyImportAliases) {
    if (actualImports[alias] !== undefined) {
      issues.push(`import-map.json must not expose legacy alias ${alias}; use the yzforge package namespace.`, {
        path: 'import-map.json',
        code: 'path_map.legacy_alias',
        target: alias,
      });
    }
  }
  for (const [alias, expected] of Object.entries(expectedImports)) {
    const actual = actualImports[alias];
    if (actual !== expected) {
      issues.push(`import-map.json imports.${alias} must be '${expected}', got '${actual}'.`, {
        path: 'import-map.json',
        code: 'path_map.import_map',
        target: alias,
      });
    }
  }

  let packageJson;
  try {
    packageJson = readJsonc(path.join(projectRoot, 'package.json'));
  } catch (error) {
    issues.push(`package.json cannot be read: ${error.message}.`, {
      path: 'package.json',
      code: 'path_map.package_json',
    });
  }
  if (packageJson?.name === 'yzforge') {
    issues.push("package.json name must not be 'yzforge'; packages/yzforge-runtime owns the framework package identity.", {
      path: 'package.json',
      code: 'path_map.package_json',
      target: 'name',
    });
  }
  if (packageJson?.private !== true) {
    issues.push('package.json private must be true for the project-local yzforge package boundary.', {
      path: 'package.json',
      code: 'path_map.package_json',
      target: 'private',
    });
  }
  const actualExports = packageJson?.exports;
  if (containsRuntimePackageExport(actualExports)) {
    issues.push('package.json must not export YZForge runtime paths; packages/yzforge-runtime owns runtime exports.', {
      path: 'package.json',
      code: 'path_map.package_json',
      target: 'exports',
    });
  }

  let runtimePackageJson;
  try {
    runtimePackageJson = readJsonc(path.join(projectRoot, 'packages/yzforge-runtime/package.json'));
  } catch (error) {
    issues.push(`packages/yzforge-runtime/package.json cannot be read: ${error.message}.`, {
      path: 'packages/yzforge-runtime/package.json',
      code: 'path_map.package_json',
    });
  }
  if (runtimePackageJson?.name !== 'yzforge') {
    issues.push(`packages/yzforge-runtime/package.json name must be 'yzforge', got '${runtimePackageJson?.name}'.`, {
      path: 'packages/yzforge-runtime/package.json',
      code: 'path_map.package_json',
      target: 'name',
    });
  }
  if (runtimePackageJson?.exports?.['.'] !== './src/index.ts') {
    issues.push(`packages/yzforge-runtime/package.json exports. must be './src/index.ts', got '${runtimePackageJson?.exports?.['.']}'.`, {
      path: 'packages/yzforge-runtime/package.json',
      code: 'path_map.package_json',
      target: 'exports.',
    });
  }
  if (runtimePackageJson?.exports?.['./authoring'] !== './src/authoring.ts') {
    issues.push("packages/yzforge-runtime/package.json exports./authoring must be './src/authoring.ts'.", {
      path: 'packages/yzforge-runtime/package.json',
      code: 'path_map.package_json',
      target: 'exports./authoring',
    });
  }

  let projectSettings;
  try {
    projectSettings = readJsonc(path.join(projectRoot, 'settings/v2/packages/project.json'));
  } catch (error) {
    issues.push(`settings/v2/packages/project.json cannot be read: ${error.message}.`, {
      path: 'settings/v2/packages/project.json',
      code: 'path_map.project_settings',
    });
  }
  const actualImportMapSetting = projectSettings?.script?.importMap;
  if (actualImportMapSetting !== 'project://import-map.json') {
    issues.push(`settings/v2/packages/project.json script.importMap must be 'project://import-map.json', got '${actualImportMapSetting}'.`, {
      path: 'settings/v2/packages/project.json',
      code: 'path_map.project_settings',
      target: 'script.importMap',
    });
  }

  const runtimeTsPath = actualPaths.yzforge?.[0];
  const runtimeImportPath = actualImports.yzforge;
  if (runtimeTsPath !== './packages/yzforge-runtime/src/index.ts' || runtimeImportPath !== './assets/yzforge/runtime/index.ts') {
    issues.push('tsconfig.yzforge.json must point yzforge to the runtime source package, while import-map.json points Cocos to the synced runtime copy.', {
      path: 'import-map.json',
      code: 'path_map.runtime_mismatch',
      target: 'yzforge',
    });
  }
}

function containsRuntimePackageExport(value) {
  if (typeof value === 'string') {
    const normalized = toPosix(value);
    return normalized.includes('assets/yzforge/runtime') || normalized.includes('packages/yzforge-runtime');
  }
  if (Array.isArray(value)) {
    return value.some(containsRuntimePackageExport);
  }
  return Boolean(value && typeof value === 'object' && Object.values(value).some(containsRuntimePackageExport));
}

module.exports = {
  validatePathMaps,
};
