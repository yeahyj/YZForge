'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { generatedJson, generatedText, isTextChanged, readJsonc, toPosix, verifyGeneratedJsonHash, walk } = require('./fs-utils');
const { renderAutoRefsBase, scanAutoRefs, toolchainExample, toolchainGitignore, toolchainSchema } = require('./generate');
const { scanProject } = require('./scanner');
const { loadTypeScript: loadToolchainTypeScript, yzforgePackageScripts } = require('./toolchain');
const { expectedBundle, validateDescriptor } = require('./validators/descriptors');
const { validatePathMaps } = require('./validators/path-maps');
const { runValidatorRules } = require('./validators/rule-runner');

let activeProjectRoot = process.cwd();

function loadTypeScript() {
  return loadToolchainTypeScript(activeProjectRoot, { required: false });
}

function assetUrlForPath(rel) {
  return rel && rel.startsWith('assets/') ? `db://${rel}` : undefined;
}

function extractIssuePath(projectRoot, message) {
  const normalized = toPosix(message);
  const root = toPosix(projectRoot);
  const rootIndex = normalized.indexOf(`${root}/`);
  if (rootIndex >= 0) {
    const rel = normalized.slice(rootIndex + root.length + 1).match(/^[^\s:'")]+/)?.[0];
    return rel ? rel.replace(/[.,]+$/, '') : undefined;
  }
  const match = normalized.match(/\b((?:assets|extensions|docs)\/[^\s:'")]+|(?:import-map|tsconfig|package)\.json)\b/);
  return match ? match[1].replace(/[.,]+$/, '') : undefined;
}

function issueCode(message) {
  if (/generated hash mismatch/.test(message)) return 'generated.hash_mismatch';
  if (/imports? .*internal path|registry\/contract must not import|unsupported .* entry dependency/.test(message)) return 'import.boundary';
  if (/missing generated AutoRefs|AutoRef/.test(message)) return 'ui.autoref';
  if (/ViewPolicy|ViewKind|ViewLayer|ViewStackMode|UIManager View/.test(message)) return 'ui.policy';
  if (/must mount .* script|references script outside allowed scope|references unknown script uuid/.test(message)) return 'prefab.script_source';
  if (/Cocos bundle meta/.test(message)) return 'bundle.meta';
  if (/public contract/.test(message)) return 'contract.public';
  if (/Main scene|Main component/.test(message)) return 'main.scene';
  return 'validator.issue';
}

function createIssueCollector(projectRoot) {
  const issues = [];
  issues.details = [];
  const pushMessage = Array.prototype.push.bind(issues);
  issues.push = (message, detail = {}) => {
    const text = String(message);
    const rel = detail.path || extractIssuePath(projectRoot, text);
    pushMessage(text);
    issues.details.push({
      severity: detail.severity || 'error',
      code: detail.code || issueCode(text),
      message: text,
      ...(rel ? { path: toPosix(rel), url: assetUrlForPath(toPosix(rel)) } : {}),
      ...(detail.line !== undefined ? { line: detail.line } : {}),
      ...(detail.column !== undefined ? { column: detail.column } : {}),
      ...(detail.specifier ? { specifier: detail.specifier } : {}),
      ...(detail.target ? { target: detail.target } : {}),
      ...(detail.field ? { field: detail.field } : {}),
    });
    return issues.length;
  };
  return issues;
}


function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function relativeFiles(root, predicate) {
  if (!fs.existsSync(root)) {
    return [];
  }
  return walk(root, predicate)
    .map((filePath) => toPosix(path.relative(root, filePath)))
    .sort((a, b) => a.localeCompare(b));
}

function validateRuntimeTemplate(projectRoot, issues) {
  const legacyRuntime = path.join(projectRoot, 'extensions', 'yzforge', 'runtime');
  const sourceRoot = path.join(projectRoot, 'packages', 'yzforge-runtime', 'src');
  const templateRoot = path.join(projectRoot, 'extensions', 'yzforge', 'runtime-template');
  const projectRuntime = path.join(projectRoot, 'assets', 'yzforge', 'runtime');

  if (fs.existsSync(legacyRuntime)) {
    issues.push('extensions/yzforge/runtime is deprecated. Rename it to extensions/yzforge/runtime-template.', {
      path: 'extensions/yzforge/runtime',
      code: 'runtime.legacy_path',
    });
  }
  if (!fs.existsSync(sourceRoot)) {
    issues.push('Runtime source package is missing: packages/yzforge-runtime/src.', {
      path: 'packages/yzforge-runtime/src',
      code: 'runtime.source_missing',
    });
    return;
  }
  if (!fs.existsSync(templateRoot)) {
    issues.push('Runtime template is missing: extensions/yzforge/runtime-template.', {
      path: 'extensions/yzforge/runtime-template',
      code: 'runtime.template_missing',
    });
    return;
  }
  if (!fs.existsSync(projectRuntime)) {
    issues.push('Project runtime is missing: assets/yzforge/runtime.', {
      path: 'assets/yzforge/runtime',
      code: 'runtime.project_missing',
    });
    return;
  }

  const sourceFiles = relativeFiles(sourceRoot, (filePath) => filePath.endsWith('.ts'));
  const compareTargets = [
    ['Runtime template', 'extensions/yzforge/runtime-template', templateRoot],
    ['Project runtime', 'assets/yzforge/runtime', projectRuntime],
  ];
  for (const [label, targetRel, targetRoot] of compareTargets) {
    const targetFiles = relativeFiles(targetRoot, (filePath) => filePath.endsWith('.ts'));
    const allFiles = Array.from(new Set(sourceFiles.concat(targetFiles))).sort((a, b) => a.localeCompare(b));
    for (const rel of allFiles) {
      const sourcePath = path.join(sourceRoot, rel);
      const targetPath = path.join(targetRoot, rel);
      const sourceExists = fs.existsSync(sourcePath);
      const targetExists = fs.existsSync(targetPath);
      if (!sourceExists) {
        issues.push(`${label} has file missing from runtime source package: ${targetRel}/${rel}.`, {
          path: `${targetRel}/${rel}`,
          code: 'runtime.package_drift',
          target: `packages/yzforge-runtime/src/${rel}`,
        });
        continue;
      }
      if (!targetExists) {
        issues.push(`${label} is missing runtime source package file: ${targetRel}/${rel}.`, {
          path: `${targetRel}/${rel}`,
          code: 'runtime.package_drift',
          target: `packages/yzforge-runtime/src/${rel}`,
        });
        continue;
      }
      if (hashFile(sourcePath) !== hashFile(targetPath)) {
        issues.push(`${label} file differs from runtime source package: ${targetRel}/${rel}.`, {
          path: `${targetRel}/${rel}`,
          code: 'runtime.package_drift',
          target: `packages/yzforge-runtime/src/${rel}`,
        });
      }
    }
  }
}

function validateRuntimeBundleBoundary(projectRoot, issues) {
  const runtimeRoots = [
    path.join(projectRoot, 'packages', 'yzforge-runtime', 'src'),
    path.join(projectRoot, 'assets', 'yzforge', 'runtime'),
  ];
  for (const runtimeRoot of runtimeRoots) {
    if (!fs.existsSync(runtimeRoot)) {
      continue;
    }
    for (const filePath of scanFiles(runtimeRoot, '.ts')) {
      if (path.basename(filePath) === 'bundle-manager.ts') {
        continue;
      }
      const rel = toPosix(path.relative(projectRoot, filePath));
      const source = stripCodeComments(fs.readFileSync(filePath, 'utf8'));
      const pattern = /\bassetManager\s*\.\s*(loadBundle|removeBundle)\s*\(/g;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        issues.push(`${rel} Only BundleManager may call assetManager.${match[1]} directly.`, {
          path: rel,
          code: 'runtime.bundle_boundary',
          ...offsetLocation(source, match.index),
        });
      }
      const bundleTypePattern = /\bAssetManager\s*\.\s*Bundle\b/g;
      while ((match = bundleTypePattern.exec(source)) !== null) {
        issues.push(`${rel} Only BundleManager may reference AssetManager.Bundle directly.`, {
          path: rel,
          code: 'runtime.bundle_boundary',
          ...offsetLocation(source, match.index),
        });
      }
    }
  }
}

function validateOrphanScopes(project, issues) {
  for (const orphan of project.orphanScopes || []) {
    const label = orphan.kind === 'content-pack'
      ? `content-pack:${orphan.owner}/${orphan.name}`
      : `${orphan.kind}:${orphan.name}`;
    issues.push(`${label} scope directory is missing ${orphan.expectedDescriptor}: ${orphan.projectPath}.`, {
      path: orphan.projectPath,
      code: 'scope.descriptor_missing',
    });
  }
}

function validateBundleMeta(projectRoot, kind, descriptor, issues) {
  const label = `${kind}:${descriptor.name || descriptor.id}`;
  const metaPath = `${descriptor.dir}.meta`;
  if (!fs.existsSync(metaPath)) {
    issues.push(`${label} Cocos bundle meta is missing: ${path.relative(projectRoot, metaPath).replace(/\\/g, '/')}.`);
    return;
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    issues.push(`${label} Cocos bundle meta is invalid JSON: ${error.message}.`);
    return;
  }

  const userData = meta.userData || {};
  const expected = expectedBundle(kind, descriptor);
  if (userData.isBundle !== true) {
    issues.push(`${label} Cocos bundle meta must set userData.isBundle = true.`);
  }
  if (userData.bundleName !== expected) {
    issues.push(`${label} Cocos bundle meta bundleName must be '${expected}', got '${userData.bundleName}'.`);
  }
}

function validatePublicContract(projectRoot, descriptor, issues) {
  const publicFile = path.join(descriptor.dir, descriptor.public || 'code/public.ts');
  if (!fs.existsSync(publicFile)) {
    issues.push(`${descriptor.projectPath} public contract file is missing: ${descriptor.public || 'code/public.ts'}`);
    return;
  }
  const rel = path.relative(projectRoot, publicFile).replace(/\\/g, '/');
  const content = fs.readFileSync(publicFile, 'utf8');
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  if (/from\s+['"]cc['"]/.test(withoutComments) || /import\s*\([^)]*['"]cc['"]/.test(withoutComments)) {
    issues.push(`${rel} must not import cc in public contract.`);
  }
  const runtimeExport = /^\s*export\s+(?:abstract\s+)?(?:class|const|let|var|function|enum)\b/m;
  if (runtimeExport.test(withoutComments)) {
    issues.push(`${rel} must only export interface/type declarations.`);
  }
  const nonTypeImport = /^\s*import\s+(?!type\b)(?!\{[^}]*\btype\b)/m;
  if (nonTypeImport.test(withoutComments)) {
    issues.push(`${rel} must use type-only imports.`);
  }
}

function extractLibraryTokenKeys(content, libraryName) {
  const tokenMapName = `${libraryName}TokenMap`;
  const match = content.match(new RegExp(`export\\s+interface\\s+${tokenMapName}\\s*{([\\s\\S]*?)}`));
  if (!match) {
    return [];
  }
  const keys = [];
  const propertyPattern = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm;
  let property;
  while ((property = propertyPattern.exec(match[1])) !== null) {
    keys.push(property[1]);
  }
  return keys.sort();
}

function findCallObjectBody(content, callee) {
  const callPattern = new RegExp(`\\b${callee}\\s*(?:<[^>]*>)?\\s*\\(`, 'g');
  const call = callPattern.exec(content);
  if (!call) {
    return undefined;
  }
  const open = content.indexOf('{', call.index + call[0].length);
  if (open < 0) {
    return undefined;
  }
  let depth = 0;
  let quote;
  let escaped = false;
  for (let index = open; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(open + 1, index);
      }
    }
  }
  return undefined;
}

function extractProviderKeys(content) {
  const body = findCallObjectBody(content, 'defineLibraryProviders');
  if (body === undefined) {
    return undefined;
  }
  const keys = [];
  const pattern = /^\s*([A-Za-z_$][\w$]*)\s*:/gm;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    keys.push(match[1]);
  }
  return keys.sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateLibraryProviders(projectRoot, descriptor, issues) {
  const publicFile = path.join(descriptor.dir, descriptor.public || 'code/public.ts');
  const providerFile = path.join(descriptor.dir, 'code', 'providers.ts');
  const providerRel = toPosix(path.relative(projectRoot, providerFile));
  if (!fs.existsSync(providerFile)) {
    issues.push(`library:${descriptor.name} providers file is missing: ${providerRel}.`, {
      path: providerRel,
      code: 'library.providers_missing',
    });
    return;
  }
  const publicContent = fs.existsSync(publicFile) ? fs.readFileSync(publicFile, 'utf8') : '';
  const publicKeys = extractLibraryTokenKeys(publicContent, descriptor.name);
  const providerKeys = extractProviderKeys(fs.readFileSync(providerFile, 'utf8'));
  if (!providerKeys) {
    issues.push(`${providerRel} must export providers via defineLibraryProviders.`, {
      path: providerRel,
      code: 'library.providers_invalid',
    });
    return;
  }
  if (!sameList(providerKeys, publicKeys)) {
    issues.push(`${providerRel} provider keys must match ${descriptor.name}TokenMap keys. expected [${publicKeys.join(', ')}], got [${providerKeys.join(', ')}].`, {
      path: providerRel,
      code: 'library.providers_mismatch',
    });
  }

  const entryPath = path.join(descriptor.dir, descriptor.entry || 'code/generated/entry.ts');
  if (fs.existsSync(entryPath)) {
    const entryRel = toPosix(path.relative(projectRoot, entryPath));
    const entry = fs.readFileSync(entryPath, 'utf8');
    if (!/from\s+['"]\.\.\/providers['"]/.test(entry) || !/\btokens\s*:\s*providers\b/.test(entry)) {
      issues.push(`${entryRel} must register library token providers from ../providers.`, {
        path: entryRel,
        code: 'library.providers_entry',
      });
    }
  }
}

function validateGenerated(projectRoot, issues) {
  const generatedFiles = walk(projectRoot, (filePath) => {
    return /\.generated\.json$/.test(filePath);
  });
  for (const filePath of generatedFiles) {
    const rel = toPosix(path.relative(projectRoot, filePath));
    let result;
    try {
      result = verifyGeneratedJsonHash(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      issues.push(`${rel} generated hash mismatch (invalid JSON: ${error.message}).`);
      continue;
    }
    if (!result.ok) {
      issues.push(`${rel} generated hash mismatch (${result.reason || `${result.actual} != ${result.expected}`}).`);
    }
  }
}

function validateForbiddenImports(projectRoot, issues) {
  const files = walk(path.join(projectRoot, 'assets'), (filePath) => filePath.endsWith('.ts'));
  for (const filePath of files) {
    const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    if (rel.startsWith('assets/yzforge/runtime/')) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const importRecords = extractImportRecords(content, rel);
    const moduleMatch = rel.match(/^assets\/modules\/([^/]+)\//);
    const libraryMatch = rel.match(/^assets\/libraries\/([^/]+)\//);
    if (/assetManager\.loadBundle|resources\.load/.test(content)) {
      issues.push(`${rel} uses forbidden dynamic resource loading API.`);
    }
    for (const record of importRecords) {
      const target = record.specifier;
      const targetRel = resolveImportTarget(projectRoot, filePath, record.specifier);
      const generatedAuthoringImport = record.specifier === 'yzforge/authoring'
        && (rel.includes('/code/generated/') || rel.endsWith('.generated.ts'));
      if ((targetRel?.startsWith('assets/yzforge/runtime/') || targetRel?.startsWith('packages/yzforge-runtime/src/'))
        && !(['assets/yzforge/runtime/index.ts', 'packages/yzforge-runtime/src/index.ts'].includes(targetRel) && record.specifier === 'yzforge')
        && !generatedAuthoringImport) {
        pushImportIssue(issues, rel, `must import YZForge runtime through 'yzforge', not runtime internal path: ${record.specifier}.`, record, targetRel);
      }
      if (moduleMatch && target.includes('/modules/') && !target.includes(`/modules/${moduleMatch[1]}/`)) {
        pushImportIssue(issues, rel, `imports another module internal path: ${target}`, record);
      }
      if (moduleMatch && target.includes('/libraries/') && !target.includes('/registry/libraries/') && !target.startsWith('yzforge/libraries/')) {
        pushImportIssue(issues, rel, `imports library internal path: ${target}`, record);
      }
      if (libraryMatch && target.includes('/modules/')) {
        pushImportIssue(issues, rel, `imports module internal path: ${target}`, record);
      }
    }
  }
}

function validateRuntimeTemplateImports(projectRoot, issues) {
  const files = walk(path.join(projectRoot, 'assets'), (filePath) => filePath.endsWith('.ts'));
  for (const filePath of files) {
    const rel = toPosix(path.relative(projectRoot, filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    if (/extensions[\\/]+yzforge[\\/]+runtime-template|runtime-template|packages[\\/]+yzforge-runtime[\\/]+src/.test(content)) {
      issues.push(`${rel} must not import or reference runtime source copies directly. Use the yzforge alias.`, {
        path: rel,
        code: 'runtime.template_import',
      });
    }
  }
}

const APP_INTERNAL_FIELDS = [
  'bundles',
  'configs',
  'entries',
  'extensions',
  'global',
  'libraries',
  'main',
  'navigator',
  'ownership',
  'releaseScope',
  'shared',
  'ui',
];

function validateAppFacadeAccess(projectRoot, issues) {
  const files = walk(path.join(projectRoot, 'assets'), (filePath) => filePath.endsWith('.ts'));
  const fields = APP_INTERNAL_FIELDS.join('|');
  const pattern = new RegExp(`\\b(?:(?:this|context)\\.app|app)\\s*\\.\\s*(${fields})\\b`, 'g');
  for (const filePath of files) {
    const rel = toPosix(path.relative(projectRoot, filePath));
    if (rel.startsWith('assets/yzforge/runtime/')) {
      continue;
    }
    const source = stripCodeComments(fs.readFileSync(filePath, 'utf8'));
    let match;
    while ((match = pattern.exec(source)) !== null) {
      issues.push(`${rel} must not access App internal field '${match[1]}'; use the public App facade or ExtensionContext tokens.`, {
        path: rel,
        code: 'app.internal_access',
        field: match[1],
        ...offsetLocation(source, match.index),
      });
    }
  }
}


function containsHardcodedCocosToolchainPath(content) {
  const absoluteCocosPath = /[A-Za-z]:[\\/][^\r\n"']*Cocos[\\/]/i;
  if (absoluteCocosPath.test(content)) {
    return true;
  }
  const cocosTypeScriptMarker = ['app.asar', 'unpacked'].join('.');
  const typeScriptMarker = ['node_modules', 'typescript'].join('/');
  if (content.includes(cocosTypeScriptMarker) && content.replace(/\\/g, '/').includes(typeScriptMarker)) {
    return true;
  }
  const engineAssetsMarker = ['resources', 'resources', '3d', 'engine', 'editor', 'assets'].join('/');
  return content.replace(/\\/g, '/').includes(engineAssetsMarker);
}

function validateToolchainResolver(projectRoot, issues) {
  const toolchainPath = path.join(projectRoot, 'extensions/yzforge/editor/toolchain.js');
  if (!fs.existsSync(toolchainPath)) {
    issues.push('ToolchainResolver is missing at extensions/yzforge/editor/toolchain.js.', {
      path: 'extensions/yzforge/editor/toolchain.js',
      code: 'toolchain.resolver',
    });
    return;
  }

  const toolchainSource = fs.readFileSync(toolchainPath, 'utf8');
  const requiredSymbols = [
    'resolveCocosEditorRoot',
    'resolveCocosExecutable',
    'resolveCocosBuildOutputPath',
    'resolveCocosTypeScript',
    'resolveCocosEngineRoot',
    'resolveCocosEngineAssets',
    'resolveCocosProjectSettings',
    'resolveCocosTempAssembly',
    'prepareTypecheckTsconfig',
    'readCocosDashboardProfiles',
    'dashboardEditorRootCandidates',
    'runCocosBuild',
    'runTypecheck',
  ];
  for (const symbol of requiredSymbols) {
    if (!toolchainSource.includes(symbol)) {
      issues.push(`ToolchainResolver must expose ${symbol}.`, {
        path: 'extensions/yzforge/editor/toolchain.js',
        code: 'toolchain.resolver',
        target: symbol,
      });
    }
  }

  let packageJson;
  try {
    packageJson = readJsonc(path.join(projectRoot, 'package.json'));
  } catch (error) {
    issues.push(`package.json cannot be read for ToolchainResolver validation: ${error.message}.`, {
      path: 'package.json',
      code: 'toolchain.resolver',
    });
  }
  const expectedScripts = yzforgePackageScripts();
  for (const [name, expected] of Object.entries(expectedScripts)) {
    const actual = packageJson?.scripts?.[name];
    if (actual !== expected) {
      issues.push(`package.json scripts.${name} must be '${expected}', got '${actual}'.`, {
        path: 'package.json',
        code: 'toolchain.script',
        target: `scripts.${name}`,
      });
    }
  }

  const expectedToolchainFiles = [
    {
      path: '.yzforge/.gitignore',
      kind: 'text',
      value: toolchainGitignore(),
      message: '.yzforge/.gitignore must ignore local toolchain.json while keeping schema/template tracked.',
    },
    {
      path: '.yzforge/toolchain.schema.json',
      kind: 'json',
      value: toolchainSchema(),
      message: '.yzforge/toolchain.schema.json must be generated from ToolchainResolver config schema.',
    },
    {
      path: '.yzforge/toolchain.example.json',
      kind: 'json',
      value: toolchainExample(projectRoot),
      message: '.yzforge/toolchain.example.json must be generated from project Cocos version.',
    },
  ];
  for (const expected of expectedToolchainFiles) {
    const filePath = path.join(projectRoot, expected.path);
    if (!fs.existsSync(filePath)) {
      issues.push(`${expected.path} is missing; run yzforge:generate to create the ToolchainResolver config template.`, {
        path: expected.path,
        code: 'toolchain.template',
      });
      continue;
    }
    if (expected.kind === 'json') {
      let actual;
      try {
        actual = readJsonc(filePath);
      } catch (error) {
        issues.push(`${expected.path} cannot be read: ${error.message}.`, {
          path: expected.path,
          code: 'toolchain.template',
        });
        continue;
      }
      if (JSON.stringify(actual) !== JSON.stringify(expected.value)) {
        issues.push(expected.message, {
          path: expected.path,
          code: 'toolchain.template',
        });
      }
    } else {
      const actual = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
      const expectedText = expected.value.endsWith('\n') ? expected.value : `${expected.value}\n`;
      if (actual !== expectedText) {
        issues.push(expected.message, {
          path: expected.path,
          code: 'toolchain.template',
        });
      }
    }
  }

  const scannedFiles = [
    'package.json',
    ...walk(path.join(projectRoot, 'extensions/yzforge/editor'), (filePath) => filePath.endsWith('.js'))
      .map((filePath) => toPosix(path.relative(projectRoot, filePath))),
  ];
  for (const rel of scannedFiles) {
    if (rel === 'extensions/yzforge/editor/toolchain.js') {
      continue;
    }
    const filePath = path.join(projectRoot, rel);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (containsHardcodedCocosToolchainPath(content)) {
      issues.push(`${rel} must not hardcode Cocos toolchain paths; use ToolchainResolver.`, {
        path: rel,
        code: 'toolchain.hardcoded_path',
      });
    }
  }
}

function validateCocosAssemblyResolution(projectRoot, issues) {
  const targets = ['editor', 'preview'];
  for (const target of targets) {
    const rel = `temp/programming/packer-driver/targets/${target}/assembly-record.json`;
    const filePath = path.join(projectRoot, rel);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      issues.push(`${rel} cannot be read: ${error.message}.`, {
        path: rel,
        code: 'cocos.import_resolution',
      });
      continue;
    }

    let record;
    try {
      record = JSON.parse(raw);
    } catch (_error) {
      const sanitized = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      try {
        record = JSON.parse(sanitized);
      } catch (_sanitizedError) {
        if (/"type"\s*:\s*"error"/.test(raw) && /\byzforge\b/.test(raw)) {
          issues.push(`Cocos ${target} assembly contains an unresolved YZForge import.`, {
            path: rel,
            code: 'cocos.import_resolution',
          });
        }
        continue;
      }
    }

    const chunks = record?.chunks || {};
    for (const [chunkId, chunk] of Object.entries(chunks)) {
      const imports = chunk?.imports || {};
      for (const [specifier, importRecord] of Object.entries(imports)) {
        const resolved = importRecord?.resolved;
        if (resolved?.type !== 'error') {
          continue;
        }
        const messages = Array.isArray(importRecord?.messages)
          ? importRecord.messages.map((message) => String(message))
          : [];
        const diagnostic = [
          specifier,
          resolved?.id,
          resolved?.specifier,
          resolved?.text,
          resolved?.message,
          ...messages,
        ].filter(Boolean).join(' ');
        if (!/\byzforge\b/.test(diagnostic)) {
          continue;
        }
        issues.push(`Cocos ${target} assembly cannot resolve YZForge import '${specifier}' in chunk ${chunkId}: ${diagnostic}.`, {
          path: rel,
          code: 'cocos.import_resolution',
          specifier,
          target: chunkId,
        });
      }
    }
  }
}

function validateAppStateMachine(projectRoot, issues) {
  const rel = 'packages/yzforge-runtime/src/app.ts';
  const filePath = path.join(projectRoot, rel);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const rawSource = fs.readFileSync(filePath, 'utf8');
  const source = stripCodeComments(rawSource);
  const requirePattern = (pattern, message, target) => {
    if (!pattern.test(source)) {
      issues.push(message, {
        path: rel,
        code: 'app.state_machine',
        ...(target ? { target } : {}),
      });
    }
  };
  requirePattern(/\bexport\s+enum\s+AppState\b/, 'App runtime must expose AppState enum.', 'AppState');
  for (const state of ['Created', 'Starting', 'Started', 'Disposing', 'Disposed', 'Failed']) {
    requirePattern(new RegExp(`\\b${state}\\s*=`), `AppState must include ${state}.`, `AppState.${state}`);
  }
  requirePattern(/\bprivate\s+appState\s*=\s*AppState\.Created\b/, 'App must store explicit appState initialized to AppState.Created.', 'appState');
  requirePattern(/\bpublic\s+get\s+state\s*\(\)\s*:\s*AppState\b/, 'App must expose current AppState through a state getter.', 'state');
  requirePattern(/\breadonly\s+state\s*:\s*AppState\b/, 'AppRuntimeSnapshot must expose current AppState.', 'AppRuntimeSnapshot.state');
  requirePattern(/\bstate\s*:\s*this\.appState\b/, 'App.snapshot must include current AppState.', 'snapshot.state');
  requirePattern(/\bpublic\s+get\s+boot\s*\(\)\s*:\s*AppBootProfile\b/, 'App must expose boot profile through a boot getter.', 'boot');
  requirePattern(/\breadonly\s+boot\s*:\s*AppBootProfile\b/, 'AppRuntimeSnapshot must expose AppBootProfile.', 'AppRuntimeSnapshot.boot');
  requirePattern(/\bboot\s*:\s*kernel\.boot\b/, 'App.snapshot must include AppBootProfile.', 'snapshot.boot');
  requirePattern(/\bpublic\s+get\s+clock\s*\(\)\s*:\s*AppClock\b/, 'App must expose AppClock through a clock getter.', 'clock');
  requirePattern(/\breadonly\s+clock\s*:\s*AppClockSnapshot\b/, 'AppRuntimeSnapshot must expose AppClockSnapshot.', 'AppRuntimeSnapshot.clock');
  requirePattern(/\bclock\s*:\s*kernel\.clock\.snapshot\s*\(\s*\)/, 'App.snapshot must include AppClock snapshot.', 'snapshot.clock');
  requirePattern(/\bpublic\s+get\s+storage\s*\(\)\s*:\s*AppStorage\b/, 'App must expose AppStorage through a storage getter.', 'storage');
  requirePattern(/\breadonly\s+storage\s*:\s*AppStorageSnapshot\b/, 'AppRuntimeSnapshot must expose AppStorageSnapshot.', 'AppRuntimeSnapshot.storage');
  requirePattern(/\bstorage\s*:\s*kernel\.storage\.snapshot\s*\(\s*\)/, 'App.snapshot must include AppStorage snapshot.', 'snapshot.storage');
  requirePattern(/['"]app\.invalid_state['"]/, 'App state guard must report app.invalid_state.', 'app.invalid_state');
  requirePattern(/\bArray\.from\s*\(\s*this\.moduleTasks\.values\s*\(\s*\)\s*\)/, 'App.dispose must wait for pending module load tasks before unloading modules.', 'moduleTasks');

  validateAppPublicStateGuards(rel, rawSource, issues);
}

function validateAppPublicStateGuards(rel, source, issues) {
  const parsed = parseTypeScriptFile(source, rel);
  if (!parsed) {
    issues.push(`${rel} App public API state guards cannot be validated because TypeScript cannot be resolved.`, {
      path: rel,
      code: 'app.state_machine_ast_unavailable',
    });
    return;
  }

  const { ts, sourceFile } = parsed;
  const requiredGuards = new Map([
    ['start', ['AppState.Created']],
    ['back', ['AppState.Started']],
    ['preloadModule', ['AppState.Started']],
    ['loadModule', ['AppState.Started']],
    ['enterModule', ['AppState.Started']],
    ['unloadModule', ['AppState.Started', 'AppState.Disposing']],
    ['installExtension', ['AppState.Created', 'AppState.Starting', 'AppState.Started']],
    ['use', ['AppState.Starting', 'AppState.Started', 'AppState.Disposing']],
    ['useModuleToken', ['AppState.Started', 'AppState.Disposing']],
    ['purgeResourceCache', ['AppState.Started', 'AppState.Disposing']],
    ['dispose', ['AppState.Created', 'AppState.Starting', 'AppState.Started', 'AppState.Failed']],
  ]);
  const allowedUnguardedPublicMembers = new Set(['logger', 'lifecycle', 'viewport', 'state', 'boot', 'clock', 'storage', 'snapshot']);
  const appClass = sourceFile.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'App');
  if (!appClass) {
    issues.push(`${rel} must declare class App.`, {
      path: rel,
      code: 'app.state_machine',
      target: 'App',
    });
    return;
  }

  for (const member of appClass.members) {
    const name = propertyNameText(ts, member.name);
    if (!name || isPrivateOrProtectedMember(ts, member)) {
      continue;
    }
    if (ts.isPropertyDeclaration(member)) {
      issues.push(`App.${name} must not expose a public field; expose a method with an AppState guard or a deliberate getter.`, {
        path: rel,
        code: 'app.state_machine',
        target: name,
        ...sourceLocation(sourceFile, member),
      });
      continue;
    }
    if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      if (!allowedUnguardedPublicMembers.has(name)) {
        issues.push(`App.${name} public accessor must be listed as an unguarded App API or converted to a guarded method.`, {
          path: rel,
          code: 'app.state_machine',
          target: name,
          ...sourceLocation(sourceFile, member),
        });
      }
      continue;
    }
    if (!ts.isMethodDeclaration(member)) {
      continue;
    }
    const expectedStates = requiredGuards.get(name);
    if (!expectedStates) {
      if (!allowedUnguardedPublicMembers.has(name)) {
        issues.push(`App.${name} must declare an AppState guard or be listed as an unguarded public App API.`, {
          path: rel,
          code: 'app.state_machine',
          target: name,
          ...sourceLocation(sourceFile, member),
        });
      }
      continue;
    }
    const actualStates = collectAssertStateGuard(ts, sourceFile, member, name);
    if (!actualStates || !expectedStates.every((state) => actualStates.has(state))) {
      issues.push(`App.${name} must declare AppState guard ${expectedStates.join(', ')}.`, {
        path: rel,
        code: 'app.state_machine',
        target: name,
        ...sourceLocation(sourceFile, member),
      });
    }
  }
}

function isPrivateOrProtectedMember(ts, node) {
  return Boolean(node.modifiers?.some((modifier) => [
    ts.SyntaxKind.PrivateKeyword,
    ts.SyntaxKind.ProtectedKeyword,
    ts.SyntaxKind.StaticKeyword,
  ].includes(modifier.kind)));
}

function collectAssertStateGuard(ts, sourceFile, method, api) {
  if (!method.body) {
    return undefined;
  }
  let states;
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'assertState'
      && node.expression.expression.getText(sourceFile) === 'this'
    ) {
      const [apiArgument, statesArgument] = node.arguments;
      if (
        apiArgument
        && ts.isStringLiteral(apiArgument)
        && apiArgument.text === api
        && statesArgument
        && ts.isArrayLiteralExpression(statesArgument)
      ) {
        states = new Set(statesArgument.elements.map((element) => element.getText(sourceFile)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(method.body);
  return states;
}

function validateExtensionTransactions(projectRoot, issues) {
  const rel = 'packages/yzforge-runtime/src/extension-registry.ts';
  const filePath = path.join(projectRoot, rel);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const rawSource = fs.readFileSync(filePath, 'utf8');
  const source = stripCodeComments(rawSource);
  const requirements = [
    [/\binterface\s+ExtensionTransaction\b/, 'ExtensionRegistry must define ExtensionTransaction.', 'ExtensionTransaction'],
    [/\bcreateTransaction\s*\(/, 'ExtensionRegistry must create phase transactions.', 'createTransaction'],
    [/\bprovideInTransaction\s*\(/, 'ExtensionContext.provide must be transaction-aware.', 'provideInTransaction'],
    [/\bprovideModuleInTransaction\s*\(/, 'ExtensionContext.provideModule must be transaction-aware.', 'provideModuleInTransaction'],
    [/\bregisterConfigCodecInTransaction\s*\(/, 'ExtensionContext.registerConfigCodec must be transaction-aware.', 'registerConfigCodecInTransaction'],
    [/\bregisterAppServiceInTransaction\s*\(/, 'ExtensionContext.registerAppService must be transaction-aware.', 'registerAppServiceInTransaction'],
    [/\bregisterSystemUIProviderInTransaction\s*\(/, 'ExtensionContext.registerSystemUIProvider must be transaction-aware.', 'registerSystemUIProviderInTransaction'],
    [/\brollbackTransaction\s*\(/, 'ExtensionRegistry must rollback transaction token side effects.', 'rollbackTransaction'],
    [/\bdisposeCompletedPhaseExtensions\s*\(/, 'ExtensionRegistry must dispose completed phase extensions during rollback.', 'disposeCompletedPhaseExtensions'],
    [/\brollbackFailures\b/, 'Extension phase errors must include rollback failure details.', 'rollbackFailures'],
    [/\bthis\.installed\.delete\s*\(\s*extension\.name\s*\)/, 'Late Extension install failure must remove the failed extension from registry.', 'installed.delete'],
  ];
  for (const [pattern, message, target] of requirements) {
    if (!pattern.test(source)) {
      issues.push(message, {
        path: rel,
        code: 'extension.transaction',
        target,
      });
    }
  }
  validateExtensionTransactionAst(rel, rawSource, issues);
}

function validateExtensionTransactionAst(rel, source, issues) {
  const parsed = parseTypeScriptFile(source, rel);
  if (!parsed) {
    issues.push(`${rel} Extension transaction AST rules cannot be validated because TypeScript cannot be resolved.`, {
      path: rel,
      code: 'extension.transaction_ast_unavailable',
    });
    return;
  }

  const { ts, sourceFile } = parsed;
  const extensionContext = sourceFile.statements.find(
    (node) => ts.isInterfaceDeclaration(node) && node.name?.text === 'ExtensionContext',
  );
  const registryClass = sourceFile.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'ExtensionRegistry',
  );
  if (!extensionContext) {
    issues.push(`${rel} must declare ExtensionContext.`, {
      path: rel,
      code: 'extension.transaction',
      target: 'ExtensionContext',
    });
    return;
  }
  if (!registryClass) {
    issues.push(`${rel} must declare ExtensionRegistry.`, {
      path: rel,
      code: 'extension.transaction',
      target: 'ExtensionRegistry',
    });
    return;
  }

  const transactionalMethods = new Map([
    ['provide', 'provideInTransaction'],
    ['provideModule', 'provideModuleInTransaction'],
    ['onLifecycle', 'onLifecycleInTransaction'],
    ['registerConfigCodec', 'registerConfigCodecInTransaction'],
    ['registerAppService', 'registerAppServiceInTransaction'],
    ['registerSystemUIProvider', 'registerSystemUIProviderInTransaction'],
  ]);
  for (const member of extensionContext.members) {
    if (ts.isPropertySignature(member) && propertyNameText(ts, member.name) === 'lifecycle') {
      issues.push(`${rel} ExtensionContext.lifecycle must not expose raw AppLifecycle; use ExtensionContext.onLifecycle.`, {
        path: rel,
        code: 'extension.transaction',
        target: 'ExtensionContext.lifecycle',
        ...sourceLocation(sourceFile, member),
      });
      continue;
    }
    if (!ts.isMethodSignature(member)) {
      continue;
    }
    const name = propertyNameText(ts, member.name);
    if (!name || transactionalMethods.has(name)) {
      continue;
    }
    issues.push(`${rel} ExtensionContext.${name} must be classified by the transaction validator before it can be exposed.`, {
      path: rel,
      code: 'extension.transaction',
      target: `ExtensionContext.${name}`,
      ...sourceLocation(sourceFile, member),
    });
  }

  const methods = classMethodMap(ts, registryClass);
  const createContext = methods.get('createContext');
  if (!createContext?.body) {
    issues.push(`${rel} ExtensionRegistry.createContext must build the ExtensionContext facade.`, {
      path: rel,
      code: 'extension.transaction',
      target: 'createContext',
      ...(createContext ? sourceLocation(sourceFile, createContext) : {}),
    });
    return;
  }

  const contextObject = returnedObjectLiteral(ts, createContext.body);
  if (!contextObject) {
    issues.push(`${rel} ExtensionRegistry.createContext must return an object-literal ExtensionContext facade.`, {
      path: rel,
      code: 'extension.transaction',
      target: 'createContext',
      ...sourceLocation(sourceFile, createContext),
    });
    return;
  }

  for (const [contextMethod, transactionHelper] of transactionalMethods) {
    const initializer = objectLiteralPropertyInitializer(ts, contextObject, contextMethod);
    if (!initializer) {
      issues.push(`${rel} ExtensionRegistry.createContext must expose ExtensionContext.${contextMethod}.`, {
        path: rel,
        code: 'extension.transaction',
        target: `ExtensionContext.${contextMethod}`,
        ...sourceLocation(sourceFile, contextObject),
      });
      continue;
    }
    if (!nodeContainsIdentifierOrPropertyCall(ts, initializer, transactionHelper)) {
      issues.push(`${rel} ExtensionContext.${contextMethod} must route through ${transactionHelper}.`, {
        path: rel,
        code: 'extension.transaction',
        target: transactionHelper,
        ...sourceLocation(sourceFile, initializer),
      });
    }
    if (!nodeContainsIdentifier(ts, initializer, 'transaction')) {
      issues.push(`${rel} ExtensionContext.${contextMethod} must be transaction-gated.`, {
        path: rel,
        code: 'extension.transaction',
        target: `ExtensionContext.${contextMethod}`,
        ...sourceLocation(sourceFile, initializer),
      });
    }
  }

  for (const property of contextObject.properties) {
    const name = objectLiteralPropertyName(ts, property);
    if (!name || transactionalMethods.has(name)) {
      continue;
    }
    const initializer = objectLiteralElementInitializer(ts, property);
    if (initializer && isFunctionLikeExpression(ts, initializer)) {
      issues.push(`${rel} ExtensionContext.${name} is a callable facade entry and must be added to the transaction policy.`, {
        path: rel,
        code: 'extension.transaction',
        target: `ExtensionContext.${name}`,
        ...sourceLocation(sourceFile, property),
      });
    }
  }
}

function returnedObjectLiteral(ts, node) {
  let found;
  const visit = (current) => {
    if (found) {
      return;
    }
    if (ts.isReturnStatement(current) && current.expression && ts.isObjectLiteralExpression(current.expression)) {
      found = current.expression;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function objectLiteralPropertyName(ts, property) {
  if (
    ts.isPropertyAssignment(property)
    || ts.isMethodDeclaration(property)
    || ts.isShorthandPropertyAssignment(property)
  ) {
    return propertyNameText(ts, property.name);
  }
  return undefined;
}

function objectLiteralElementInitializer(ts, property) {
  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  if (ts.isMethodDeclaration(property)) {
    return property;
  }
  return undefined;
}

function objectLiteralPropertyInitializer(ts, objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (objectLiteralPropertyName(ts, property) === name) {
      return objectLiteralElementInitializer(ts, property);
    }
  }
  return undefined;
}

function isFunctionLikeExpression(ts, node) {
  return Boolean(
    ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node),
  );
}

function nodeContainsIdentifier(ts, node, identifier) {
  let found = false;
  const visit = (current) => {
    if (found) {
      return;
    }
    if (ts.isIdentifier(current) && current.text === identifier) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function nodeContainsIdentifierOrPropertyCall(ts, node, targetName) {
  let found = false;
  const visit = (current) => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(current)) {
      const expression = current.expression;
      if (ts.isIdentifier(expression) && expression.text === targetName) {
        found = true;
        return;
      }
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === targetName) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function validateCaseConflicts(projectRoot, issues) {
  const seen = new Map();
  for (const filePath of walk(path.join(projectRoot, 'assets'))) {
    const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const key = rel.toLowerCase();
    const existing = seen.get(key);
    if (existing && existing !== rel) {
      issues.push(`Case conflict: ${existing} conflicts with ${rel}.`);
    } else {
      seen.set(key, rel);
    }
  }
}

function classMethodMap(ts, classNode) {
  const methods = new Map();
  for (const member of classNode.members || []) {
    if (!ts.isMethodDeclaration(member)) {
      continue;
    }
    const name = propertyNameText(ts, member.name);
    if (name) {
      methods.set(name, member);
    }
  }
  return methods;
}

function isThisClassMethodCall(ts, sourceFile, node, methods) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  if (node.expression.expression.getText(sourceFile) !== 'this') {
    return undefined;
  }
  const name = node.expression.name.text;
  return methods.has(name) ? name : undefined;
}

function isMainRootThisNodeProperty(ts, sourceFile, property) {
  const name = propertyNameText(ts, property.name);
  if (name !== 'mainRoot' || !ts.isPropertyAssignment(property)) {
    return false;
  }
  return property.initializer.getText(sourceFile) === 'this.node';
}

function isAppStartWithMainRoot(ts, sourceFile, node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  if (node.expression.name.text !== 'start') {
    return false;
  }
  const target = node.expression.expression.getText(sourceFile);
  if (!/(?:^|\.)app$/.test(target)) {
    return false;
  }
  const [options] = node.arguments;
  return Boolean(
    options
    && ts.isObjectLiteralExpression(options)
    && options.properties.some((property) => isMainRootThisNodeProperty(ts, sourceFile, property)),
  );
}

function methodReachableFacts(ts, sourceFile, methods, methodName, visited = new Set()) {
  if (visited.has(methodName)) {
    return { dispose: false, clear: false };
  }
  visited.add(methodName);
  const method = methods.get(methodName);
  if (!method?.body) {
    return { dispose: false, clear: false };
  }

  const facts = { dispose: false, clear: false };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(sourceFile).replace(/\?\./g, '.');
      if (expression === 'clearYZForgeApp') {
        facts.clear = true;
      }
      if (expression.endsWith('.dispose')) {
        facts.dispose = true;
      }
      const nextMethod = isThisClassMethodCall(ts, sourceFile, node, methods);
      if (nextMethod) {
        const childFacts = methodReachableFacts(ts, sourceFile, methods, nextMethod, visited);
        facts.dispose = facts.dispose || childFacts.dispose;
        facts.clear = facts.clear || childFacts.clear;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(method.body);
  return facts;
}

function validateMainComponentLifecycle(projectRoot, rel, content, issues) {
  const parsed = parseTypeScriptFile(content, path.join(projectRoot, rel));
  if (!parsed) {
    return false;
  }
  const { ts, sourceFile } = parsed;
  const mainClass = sourceFile.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'Main');
  if (!mainClass) {
    issues.push('Main component must define class Main.', {
      path: rel,
      code: 'main.lifecycle',
    });
    return true;
  }

  const methods = classMethodMap(ts, mainClass);
  let hasStartWithMainRoot = false;
  for (const method of methods.values()) {
    if (!method.body) {
      continue;
    }
    const visit = (node) => {
      if (isAppStartWithMainRoot(ts, sourceFile, node)) {
        hasStartWithMainRoot = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(method.body);
  }
  if (!hasStartWithMainRoot) {
    issues.push('Main component must start App with mainRoot: this.node.', {
      path: rel,
      code: 'main.lifecycle',
      ...sourceLocation(sourceFile, mainClass),
    });
  }

  if (!methods.has('onDestroy')) {
    issues.push('Main component must dispose App in onDestroy.', {
      path: rel,
      code: 'main.lifecycle',
      ...sourceLocation(sourceFile, mainClass),
    });
  } else {
    const facts = methodReachableFacts(ts, sourceFile, methods, 'onDestroy');
    if (!facts.dispose) {
      issues.push('Main component must dispose App in onDestroy.', {
        path: rel,
        code: 'main.lifecycle',
        ...sourceLocation(sourceFile, methods.get('onDestroy')),
      });
    }
    if (!facts.clear) {
      issues.push('Main component must clear the exposed App reference on destroy/dispose.', {
        path: rel,
        code: 'main.lifecycle',
        ...sourceLocation(sourceFile, methods.get('onDestroy')),
      });
    }
  }

  return true;
}

function validateMainScene(projectRoot, issues) {
  const scenePath = path.join(projectRoot, 'assets', 'app', 'main', 'Main.scene');
  const scriptPath = path.join(projectRoot, 'assets', 'app', 'main', 'Main.ts');
  const bootSettingsPath = path.join(projectRoot, 'assets', 'app', 'main', 'AppBootSettings.ts');
  const sceneRel = 'assets/app/main/Main.scene';
  if (!fs.existsSync(scenePath)) {
    issues.push('Main scene is missing: assets/app/main/Main.scene.', {
      path: sceneRel,
      code: 'main.scene',
    });
    return;
  }
  if (!fs.existsSync(scriptPath)) {
    issues.push('Main component is missing: assets/app/main/Main.ts.', {
      path: 'assets/app/main/Main.ts',
      code: 'main.scene',
    });
  } else {
    const rawScriptSource = fs.readFileSync(scriptPath, 'utf8');
    const scriptSource = stripCodeComments(rawScriptSource);
    if (!/\bcreateYZForgeApp\s*\(\s*{[\s\S]*\bboot\s*:/.test(scriptSource)) {
      issues.push('Main component must pass AppBootSettings profile to createYZForgeApp.', {
        path: 'assets/app/main/Main.ts',
        code: 'main.lifecycle',
        target: 'assets/app/main/AppBootSettings.ts',
      });
    }
    if (!validateMainComponentLifecycle(projectRoot, 'assets/app/main/Main.ts', rawScriptSource, issues)) {
      if (!/\.start\s*\(\s*{[^}]*\bmainRoot\s*:\s*this\.node\b/.test(scriptSource)) {
        issues.push('Main component must start App with mainRoot: this.node.', {
          path: 'assets/app/main/Main.ts',
          code: 'main.lifecycle',
        });
      }
      if (!/\bonDestroy\s*\(/.test(scriptSource) || !/\.dispose\s*\(/.test(scriptSource)) {
        issues.push('Main component must dispose App in onDestroy.', {
          path: 'assets/app/main/Main.ts',
          code: 'main.lifecycle',
        });
      }
      if (!/\bclearYZForgeApp\s*\(/.test(scriptSource)) {
        issues.push('Main component must clear the exposed App reference on destroy/dispose.', {
          path: 'assets/app/main/Main.ts',
          code: 'main.lifecycle',
        });
      }
    }
  }
  if (!fs.existsSync(bootSettingsPath)) {
    issues.push('Main boot settings component is missing: assets/app/main/AppBootSettings.ts.', {
      path: 'assets/app/main/AppBootSettings.ts',
      code: 'main.scene',
    });
  }

  let records;
  try {
    records = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  } catch (error) {
    issues.push(`Main scene is invalid JSON: ${error.message}.`, {
      path: sceneRel,
      code: 'main.scene',
    });
    return;
  }
  if (!Array.isArray(records)) {
    issues.push('Main scene must be a Cocos serialized array.', {
      path: sceneRel,
      code: 'main.scene',
    });
    return;
  }

  const nodeIdsByName = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || typeof record._name !== 'string') {
      continue;
    }
    if (!nodeIdsByName.has(record._name)) {
      nodeIdsByName.set(record._name, []);
    }
    nodeIdsByName.get(record._name).push(index);
  }
  const idsFor = (name) => nodeIdsByName.get(name) || [];
  const requiredNodes = [
    'MainRoot',
    'WorldRoot',
    'SceneHost',
    'Canvas',
    'UIRoot',
    'UnderlayLayer',
    'PageLayer',
    'PaperLayer',
    'PopupLayer',
    'ToastLayer',
    'TopLayer',
    'SystemOverlayLayer',
  ];
  for (const name of requiredNodes) {
    if (idsFor(name).length === 0) {
      issues.push(`Main scene missing node: ${name}.`, {
        path: sceneRel,
        code: 'main.scene',
      });
    }
  }

  const isDirectChild = (parentId, childId) => {
    const parent = records[parentId];
    const child = records[childId];
    if (!parent || !child) {
      return false;
    }
    const children = Array.isArray(parent._children) ? parent._children : [];
    return children.some((ref) => ref && ref.__id__ === childId) && child._parent && child._parent.__id__ === parentId;
  };
  const hasDirectChild = (parentName, childName) => {
    return idsFor(parentName).some((parentId) => idsFor(childName).some((childId) => isDirectChild(parentId, childId)));
  };
  const requiredEdges = [
    ['MainRoot', 'WorldRoot'],
    ['WorldRoot', 'SceneHost'],
    ['MainRoot', 'Canvas'],
    ['Canvas', 'UIRoot'],
    ['UIRoot', 'UnderlayLayer'],
    ['UIRoot', 'PageLayer'],
    ['UIRoot', 'PaperLayer'],
    ['UIRoot', 'PopupLayer'],
    ['UIRoot', 'ToastLayer'],
    ['UIRoot', 'TopLayer'],
    ['UIRoot', 'SystemOverlayLayer'],
  ];
  for (const [parentName, childName] of requiredEdges) {
    if (idsFor(parentName).length === 0 || idsFor(childName).length === 0) {
      continue;
    }
    if (!hasDirectChild(parentName, childName)) {
      issues.push(`Main scene node ${childName} must be a direct child of ${parentName}.`, {
        path: sceneRel,
        code: 'main.scene',
      });
    }
  }

  const nodeHasComponent = (name, type) => {
    return idsFor(name).some((nodeId) => {
      const node = records[nodeId];
      const components = Array.isArray(node?._components) ? node._components : [];
      return components.some((ref) => records[ref?.__id__]?.__type__ === type);
    });
  };
  const nodeHasScript = (name, scriptPath) => {
    const keys = new Set(scriptSerializedKeys(projectRoot, scriptPath, issues));
    if (keys.size === 0) {
      return false;
    }
    return idsFor(name).some((nodeId) => {
      const node = records[nodeId];
      const components = Array.isArray(node?._components) ? node._components : [];
      return components.some((ref) => keys.has(records[ref?.__id__]?.__type__));
    });
  };
  if (idsFor('Canvas').length > 0 && !nodeHasComponent('Canvas', 'cc.Canvas')) {
    issues.push('Main scene Canvas node must contain cc.Canvas component.', {
      path: sceneRel,
      code: 'main.scene',
    });
  }

  if (fs.existsSync(scriptPath) && idsFor('MainRoot').length > 0) {
    const mainScriptKeys = new Set(scriptSerializedKeys(projectRoot, scriptPath, issues));
    const mainRootHasScript = idsFor('MainRoot').some((nodeId) => {
      const node = records[nodeId];
      const components = Array.isArray(node?._components) ? node._components : [];
      return components.some((ref) => mainScriptKeys.has(records[ref?.__id__]?.__type__));
    });
    if (mainScriptKeys.size > 0 && !mainRootHasScript) {
      issues.push('Main scene MainRoot must mount Main script: assets/app/main/Main.ts.', {
        path: sceneRel,
        code: 'main.scene',
        target: 'assets/app/main/Main.ts',
      });
    }
  }

  if (fs.existsSync(bootSettingsPath) && idsFor('MainRoot').length > 0 && !nodeHasScript('MainRoot', bootSettingsPath)) {
    issues.push('Main scene MainRoot must mount AppBootSettings script: assets/app/main/AppBootSettings.ts.', {
      path: sceneRel,
      code: 'main.scene',
      target: 'assets/app/main/AppBootSettings.ts',
    });
  }

  const fullScreenScript = path.join(projectRoot, 'assets', 'yzforge', 'runtime', 'full-screen-root.ts');
  for (const name of ['UnderlayLayer', 'PageLayer', 'PaperLayer', 'PopupLayer', 'ToastLayer', 'TopLayer', 'SystemOverlayLayer']) {
    if (idsFor(name).length > 0 && !nodeHasScript(name, fullScreenScript)) {
      issues.push(`Main scene ${name} must mount YZFullScreenRoot component.`, {
        path: sceneRel,
        code: 'main.scene',
        target: 'assets/yzforge/runtime/full-screen-root.ts',
      });
    }
  }

  for (const [legacyName, replacement] of [
    ['FullscreenLayer', 'UnderlayLayer'],
    ['SystemLayer', 'SystemOverlayLayer'],
  ]) {
    if (idsFor(legacyName).length > 0) {
      issues.push(`Main scene must not use legacy node ${legacyName}; use ${replacement}.`, {
        path: sceneRel,
        code: 'main.scene',
      });
    }
  }

  if (idsFor('SafeAreaRoot').length > 0) {
    issues.push('Main scene must not use global SafeAreaRoot; put YZSafeAreaRoot inside View prefabs when a view needs safe-area content.', {
      path: sceneRel,
      code: 'main.scene',
      target: 'assets/yzforge/runtime/safe-area-root.ts',
    });
  }
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
  'Node',
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

const VIEW_POLICY_KINDS = ['Page', 'Paper', 'Popup', 'Toast', 'Top', 'System'];
const VIEW_POLICY_LAYERS = ['Page', 'Paper', 'Popup', 'Toast', 'Top', 'System'];
const VIEW_POLICY_STACKS = ['Single', 'Stack', 'Queue', 'Free'];
const VIEW_POLICY_DEFAULT_STACK = {
  Page: 'Single',
  Paper: 'Stack',
  Popup: 'Stack',
  Toast: 'Queue',
  Top: 'Free',
  System: 'Single',
};

function inferViewKindName(className) {
  for (const kind of VIEW_POLICY_KINDS) {
    if (className.startsWith(kind)) {
      return kind;
    }
  }
  return 'Page';
}

function enumValueName(value, enumName, allowed) {
  const normalized = String(value || '').trim().replace(/,$/, '');
  const enumPattern = new RegExp(`^${enumName}\\.([A-Za-z_$][\\w$]*)$`);
  const enumMatch = normalized.match(enumPattern);
  if (enumMatch) {
    return enumMatch[1];
  }
  const stringMatch = normalized.match(/^['"]([^'"]+)['"]$/);
  if (stringMatch) {
    const text = stringMatch[1];
    return allowed.find((item) => item === text || item.toLowerCase() === text);
  }
  return undefined;
}

function extractObjectProperty(source, property) {
  const match = new RegExp(`\\b${property}\\s*:\\s*([^,}\\n]+)`).exec(source);
  return match ? match[1].trim() : undefined;
}

function parseAutoRefMarker(name) {
  const match = /^@([A-Za-z_$][\w$]*)(?::([A-Za-z_$][\w$.]*))?$/.exec(String(name || ''));
  if (!match) {
    return undefined;
  }
  let component = match[2] ? match[2].replace(/^cc\./, '') : undefined;
  if (component === 'Node') {
    component = undefined;
  }
  return {
    key: match[1],
    component,
  };
}

function serializedRefId(value) {
  return value && typeof value === 'object' && Number.isInteger(value.__id__)
    ? value.__id__
    : undefined;
}

function serializedComponentName(record) {
  const type = String(record?.__type__ || '').split('@')[0];
  return type.replace(/^cc\./, '');
}

function nodeComponentIds(nodeRecord) {
  if (!Array.isArray(nodeRecord?._components)) {
    return [];
  }
  return nodeRecord._components
    .map(serializedRefId)
    .filter((id) => id !== undefined);
}

function componentBelongsToNode(record, nodeIndex) {
  return serializedRefId(record?.node) === nodeIndex || serializedRefId(record?._node) === nodeIndex;
}

function nodeHasComponent(records, nodeIndex, component) {
  const componentIds = new Set(nodeComponentIds(records[nodeIndex]));
  for (const id of componentIds) {
    if (serializedComponentName(records[id]) === component) {
      return true;
    }
  }
  return records.some((record) => {
    return serializedComponentName(record) === component && componentBelongsToNode(record, nodeIndex);
  });
}

function readSerializedRecords(projectRoot, assetPath, issues) {
  const rel = toPosix(path.relative(projectRoot, assetPath));
  try {
    const data = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
    return Array.isArray(data) ? data : [data];
  } catch (error) {
    issues.push(`${rel} serialized asset JSON cannot be parsed: ${error.message}.`, {
      path: rel,
      code: 'prefab.json_invalid',
    });
    return undefined;
  }
}

function findNodeComponent(records, nodeIndex, component) {
  const componentIds = new Set(nodeComponentIds(records[nodeIndex]));
  for (const id of componentIds) {
    if (serializedComponentName(records[id]) === component) {
      return records[id];
    }
  }
  return records.find((record) => {
    return serializedComponentName(record) === component && componentBelongsToNode(record, nodeIndex);
  });
}

function uiTransformSize(record) {
  const size = record && record._contentSize;
  return {
    width: Number(size && size.width),
    height: Number(size && size.height),
  };
}

function hasUsableSize(size, minWidth, minHeight) {
  return Number.isFinite(size.width)
    && Number.isFinite(size.height)
    && size.width >= minWidth
    && size.height >= minHeight;
}

function validatePrefabOpenableStructure(projectRoot, prefabPath, role, issues) {
  const rel = toPosix(path.relative(projectRoot, prefabPath));
  const records = readSerializedRecords(projectRoot, prefabPath, issues);
  if (!records) {
    return;
  }

  const prefabRecord = records[0];
  const rootIndex = serializedRefId(prefabRecord && prefabRecord.data);
  if (serializedComponentName(prefabRecord) !== 'Prefab' || rootIndex === undefined) {
    issues.push(`${rel} must be a serialized cc.Prefab with a root data node.`, {
      path: rel,
      code: 'prefab.root_missing',
    });
    return;
  }

  const root = records[rootIndex];
  if (serializedComponentName(root) !== 'Node') {
    issues.push(`${rel} prefab root data must reference a cc.Node.`, {
      path: rel,
      code: 'prefab.root_invalid',
    });
    return;
  }

  const prefabInfoIndex = serializedRefId(root._prefab);
  const prefabInfo = prefabInfoIndex !== undefined ? records[prefabInfoIndex] : undefined;
  if (serializedComponentName(prefabInfo) !== 'PrefabInfo') {
    issues.push(`${rel} prefab root must contain cc.PrefabInfo. Recreate this prefab through Cocos/YZForge.`, {
      path: rel,
      code: 'prefab.info_missing',
    });
  } else if (serializedRefId(prefabInfo.root) !== rootIndex || serializedRefId(prefabInfo.asset) !== 0) {
    issues.push(`${rel} cc.PrefabInfo root/asset reference is invalid.`, {
      path: rel,
      code: 'prefab.info_invalid',
    });
  }

  const rootTransform = findNodeComponent(records, rootIndex, 'UITransform');
  if (!rootTransform) {
    issues.push(`${rel} ${role} prefab root must have UITransform.`, {
      path: rel,
      code: 'ui.root_transform_missing',
    });
  } else {
    const rootMin = role === 'Part' ? 16 : 32;
    const size = uiTransformSize(rootTransform);
    if (!hasUsableSize(size, rootMin, rootMin)) {
      issues.push(`${rel} ${role} prefab root UITransform size is too small: ${size.width}x${size.height}.`, {
        path: rel,
        code: 'ui.root_transform_too_small',
      });
    }
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (serializedComponentName(record) !== 'Node') {
      continue;
    }
    const hasRenderable = nodeHasComponent(records, index, 'Sprite')
      || nodeHasComponent(records, index, 'Button')
      || nodeHasComponent(records, index, 'Label');
    if (!hasRenderable) {
      continue;
    }

    const transform = findNodeComponent(records, index, 'UITransform');
    if (!transform) {
      issues.push(`${rel} renderable UI node '${record._name || index}' must have UITransform.`, {
        path: rel,
        code: 'ui.render_transform_missing',
      });
      continue;
    }

    const size = uiTransformSize(transform);
    const min = nodeHasComponent(records, index, 'Label') && !nodeHasComponent(records, index, 'Button') ? 8 : 16;
    if (!hasUsableSize(size, min, min)) {
      issues.push(`${rel} renderable UI node '${record._name || index}' has invalid UITransform size: ${size.width}x${size.height}.`, {
        path: rel,
        code: 'ui.render_transform_too_small',
      });
    }
  }
}

function validateAutoRefMarkers(projectRoot, prefabPath, issues) {
  const rel = toPosix(path.relative(projectRoot, prefabPath));
  let records;
  try {
    const data = JSON.parse(fs.readFileSync(prefabPath, 'utf8'));
    records = Array.isArray(data) ? data : [data];
  } catch (error) {
    issues.push(`${rel} prefab JSON cannot be parsed: ${error.message}.`);
    return false;
  }

  const seen = new Set();
  let ok = true;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || typeof record !== 'object' || typeof record._name !== 'string') {
      continue;
    }
    const marker = parseAutoRefMarker(record._name);
    if (!marker) {
      continue;
    }
    if (seen.has(marker.key)) {
      ok = false;
      issues.push(`${rel} has duplicate AutoRef marker: @${marker.key}.`, {
        path: rel,
        code: 'ui.autoref_duplicate',
      });
    }
    seen.add(marker.key);
    if (marker.component && !AUTO_REF_COMPONENTS.has(marker.component)) {
      ok = false;
      issues.push(`${rel} has unsupported AutoRef component marker: ${record._name}.`, {
        path: rel,
        code: 'ui.autoref_component_unsupported',
      });
      continue;
    }
    if (marker.component && !nodeHasComponent(records, index, marker.component)) {
      ok = false;
      issues.push(`${rel} AutoRef marker ${record._name} requires ${marker.component} component on the same node.`, {
        path: rel,
        code: 'ui.autoref_component_missing',
      });
    }
  }
  return ok;
}

function scanPrefabs(root) {
  return walk(root, (filePath) => filePath.endsWith('.prefab') && !filePath.endsWith('.prefab.meta'))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function validateAutoRefsGeneratedFresh(projectRoot, prefabPath, refsPath, baseType, issues) {
  const prefabRel = toPosix(path.relative(projectRoot, prefabPath));
  const refsRel = toPosix(path.relative(projectRoot, refsPath));
  const className = path.basename(prefabPath, '.prefab');
  let expected;
  try {
    expected = generatedText(
      prefabRel,
      renderAutoRefsBase(baseType, `${className}Refs`, scanAutoRefs(prefabPath)),
    );
  } catch (error) {
    issues.push(`${prefabRel} AutoRefs cannot be generated: ${error.message}.`, {
      path: prefabRel,
      code: 'ui.autoref_generate_failed',
    });
    return;
  }

  if (isTextChanged(refsPath, expected)) {
    issues.push(`${refsRel} is stale for ${prefabRel}. Run YZForge Generate All.`, {
      path: refsRel,
      code: 'ui.autoref_stale',
      target: prefabRel,
    });
  }
}

function generatedViewPolicy(content, className) {
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`viewRef\\(\\s*['"]([^'"]+)['"]\\s*,\\s*${escapedClass}\\s*,\\s*['"]([^'"]+)['"]\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, 'm');
  const match = content.match(pattern);
  if (!match) {
    return undefined;
  }
  return {
    owner: match[1],
    path: match[2],
    body: match[3],
  };
}

function validateGeneratedViewPolicy(projectRoot, descriptor, prefabPath, assetsPath, issues) {
  const prefabRel = toPosix(path.relative(projectRoot, prefabPath));
  const assetsRel = toPosix(path.relative(projectRoot, assetsPath));
  if (!fs.existsSync(assetsPath)) {
    issues.push(`${prefabRel} missing generated assets manifest: ${assetsRel}.`, {
      path: prefabRel,
      code: 'ui.policy_manifest_missing',
      target: assetsRel,
    });
    return;
  }

  const className = path.basename(prefabPath, '.prefab');
  const expectedAssetPath = contentPackAssetPath(descriptor, prefabPath);
  const policy = generatedViewPolicy(fs.readFileSync(assetsPath, 'utf8'), className);
  if (!policy) {
    issues.push(`${assetsRel} missing ViewRef for ${className}.`, {
      path: assetsRel,
      code: 'ui.policy_ref_missing',
      target: prefabRel,
    });
    return;
  }
  if (policy.owner !== descriptor.name) {
    issues.push(`${assetsRel} ViewRef owner for ${className} must be '${descriptor.name}', got '${policy.owner}'.`, {
      path: assetsRel,
      code: 'ui.policy_owner_mismatch',
      target: prefabRel,
    });
  }
  if (policy.path !== expectedAssetPath) {
    issues.push(`${assetsRel} ViewRef path for ${className} must be '${expectedAssetPath}', got '${policy.path}'.`, {
      path: assetsRel,
      code: 'ui.policy_path_mismatch',
      target: prefabRel,
    });
  }

  const expectedKind = inferViewKindName(className);
  const rawKind = extractObjectProperty(policy.body, 'kind');
  const actualKind = rawKind ? enumValueName(rawKind, 'ViewKind', VIEW_POLICY_KINDS) : undefined;
  if (!actualKind) {
    issues.push(`${assetsRel} ViewPolicy for ${className} must declare a valid ViewKind.`, {
      path: assetsRel,
      code: 'ui.policy_kind_invalid',
      target: prefabRel,
    });
  } else if (actualKind !== expectedKind) {
    issues.push(`${assetsRel} ViewKind for ${className} conflicts with prefab name; expected ViewKind.${expectedKind}, got ${rawKind}.`, {
      path: assetsRel,
      code: 'ui.policy_kind_mismatch',
      target: prefabRel,
    });
  }

  const rawLayer = extractObjectProperty(policy.body, 'layer');
  if (rawLayer && !enumValueName(rawLayer, 'ViewLayer', VIEW_POLICY_LAYERS)) {
    issues.push(`${assetsRel} ViewLayer for ${className} is invalid: ${rawLayer}.`, {
      path: assetsRel,
      code: 'ui.policy_layer_invalid',
      target: prefabRel,
    });
  }

  const rawStack = extractObjectProperty(policy.body, 'stack');
  if (rawStack) {
    const actualStack = enumValueName(rawStack, 'ViewStackMode', VIEW_POLICY_STACKS);
    if (!actualStack) {
      issues.push(`${assetsRel} ViewStackMode for ${className} is invalid: ${rawStack}.`, {
        path: assetsRel,
        code: 'ui.policy_stack_invalid',
        target: prefabRel,
      });
    } else if (actualKind && actualStack !== VIEW_POLICY_DEFAULT_STACK[actualKind]) {
      issues.push(`${assetsRel} ViewStackMode for ${className} conflicts with ViewKind.${actualKind}; expected ViewStackMode.${VIEW_POLICY_DEFAULT_STACK[actualKind]}, got ${rawStack}.`, {
        path: assetsRel,
        code: 'ui.policy_stack_mismatch',
        target: prefabRel,
      });
    }
  }
}

function validateUiGeneratedRefs(projectRoot, project, issues) {
  const descriptors = project.global ? [project.global, ...project.modules] : project.modules;
  for (const descriptor of descriptors) {
    const codeDir = path.join(descriptor.dir, 'code');
    const assetsPath = path.join(codeDir, 'generated', 'assets.ts');
    for (const prefabPath of scanPrefabs(path.join(descriptor.dir, 'res', 'view'))) {
      const name = path.basename(prefabPath, '.prefab');
      const scriptPath = path.join(codeDir, 'view', `${name}.ts`);
      const refsPath = path.join(codeDir, 'view', 'refs', `${name}.refs.generated.ts`);
      validatePrefabOpenableStructure(projectRoot, prefabPath, 'View', issues);
      if (!fs.existsSync(scriptPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing View script: ${toPosix(path.relative(projectRoot, scriptPath))}.`);
      } else {
        validatePrefabContainsScript(projectRoot, prefabPath, scriptPath, 'View', issues);
      }
      const markersOk = validateAutoRefMarkers(projectRoot, prefabPath, issues);
      if (!fs.existsSync(refsPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing generated AutoRefs: ${toPosix(path.relative(projectRoot, refsPath))}.`);
      } else if (markersOk) {
        validateAutoRefsGeneratedFresh(projectRoot, prefabPath, refsPath, 'View', issues);
      }
      validateGeneratedViewPolicy(projectRoot, descriptor, prefabPath, assetsPath, issues);
    }
    for (const prefabPath of scanPrefabs(path.join(descriptor.dir, 'res', 'part'))) {
      const name = path.basename(prefabPath, '.prefab');
      const scriptPath = path.join(codeDir, 'part', `${name}.ts`);
      const refsPath = path.join(codeDir, 'part', 'refs', `${name}.refs.generated.ts`);
      validatePrefabOpenableStructure(projectRoot, prefabPath, 'Part', issues);
      if (!fs.existsSync(scriptPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing Part script: ${toPosix(path.relative(projectRoot, scriptPath))}.`);
      } else {
        validatePrefabContainsScript(projectRoot, prefabPath, scriptPath, 'Part', issues);
      }
      const markersOk = validateAutoRefMarkers(projectRoot, prefabPath, issues);
      if (!fs.existsSync(refsPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing generated AutoRefs: ${toPosix(path.relative(projectRoot, refsPath))}.`);
      } else if (markersOk) {
        validateAutoRefsGeneratedFresh(projectRoot, prefabPath, refsPath, 'Part', issues);
      }
    }
  }
}

function validateSystemUiMasksNotInBusinessPrefabs(projectRoot, project, issues) {
  const descriptors = []
    .concat(project.global ? [project.global] : [])
    .concat(project.modules)
    .concat(project.libraries)
    .concat(project.contentPacks);
  const forbidden = new Set(['PopupMask', 'YZForgePopupMask', 'TouchMask', 'UITouchMask', 'YZForgeTouchMask']);
  for (const descriptor of descriptors) {
    for (const prefabPath of scanPrefabs(path.join(descriptor.dir, 'res'))) {
      const rel = toPosix(path.relative(projectRoot, prefabPath));
      const records = readSerializedRecords(projectRoot, prefabPath, issues);
      if (!records) {
        continue;
      }
      for (const record of records) {
        if (record && forbidden.has(record._name)) {
          issues.push(`${rel} must not contain SystemUI mask node '${record._name}'. PopupMask and TouchMask are created by SystemUI.`, {
            path: rel,
            code: 'ui.system_mask_prefab',
          });
        }
      }
    }
  }
}

function withoutExt(filePath) {
  return filePath.replace(/\.[^.\\/]+$/, '');
}

function lowerCamelCase(name) {
  return String(name || '').replace(/^[A-Z]/, (value) => value.toLowerCase());
}

function scanFiles(root, extension) {
  return walk(root, (filePath) => filePath.endsWith(extension) && !filePath.endsWith(`${extension}.meta`))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function scanRuntimeFiles(root) {
  return walk(root, (filePath) => {
    return !filePath.endsWith('.meta') && !filePath.endsWith('.DS_Store');
  }).sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function inferAssetType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.prefab') return 'Prefab';
  if (ext === '.json') return 'JsonAsset';
  if (ext === '.scene') return 'SceneAsset';
  return 'Asset';
}

function contentPackAssetPath(pack, filePath) {
  return toPosix(withoutExt(path.relative(pack.dir, filePath)));
}

function readConfigTableSpec(projectRoot, filePath, issues) {
  const rel = toPosix(path.relative(projectRoot, filePath));
  let payload;
  try {
    payload = readJsonc(filePath);
  } catch (error) {
    issues.push(`${rel} config table JSON cannot be parsed: ${error.message}.`, {
      path: rel,
      code: 'config.json_invalid',
    });
    return undefined;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    issues.push(`${rel} config table must be generated by YZForge ConfigBuilder.`, {
      path: rel,
      code: 'config.payload_invalid',
    });
    return undefined;
  }
  const meta = payload._yzforgeConfig;
  if (!meta || typeof meta !== 'object') {
    issues.push(`${rel} is missing _yzforgeConfig; config JSON must be generated from config-source/export-plan.json.`, {
      path: rel,
      code: 'config.generated_metadata_missing',
    });
    return undefined;
  }
  const primaryKey = typeof meta.primaryKey === 'string' && meta.primaryKey ? meta.primaryKey : undefined;
  if (!primaryKey) {
    issues.push(`${rel} config metadata is missing primaryKey.`, {
      path: rel,
      code: 'config.primary_key_missing',
    });
    return undefined;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : undefined;
  if (!rows) {
    issues.push(`${rel} generated config table must contain rows[].`, {
      path: rel,
      code: 'config.payload_invalid',
    });
    return undefined;
  }

  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !(primaryKey in row)) {
      issues.push(`${rel} config row is missing primary key '${primaryKey}'.`, {
        path: rel,
        code: 'config.primary_key_missing',
      });
      continue;
    }
    const key = row[primaryKey];
    if (seen.has(key)) {
      issues.push(`${rel} has duplicate config primary key '${String(key)}' for '${primaryKey}'.`, {
        path: rel,
        code: 'config.duplicate_key',
      });
    }
    seen.add(key);
  }

  return {
    primaryKey,
    rows,
  };
}

function scanConfigTables(projectRoot, descriptor, issues) {
  const root = path.join(descriptor.dir, 'res', 'content', 'config');
  const files = scanFiles(root, '.json');
  const tables = {};
  for (const filePath of files) {
    const key = lowerCamelCase(path.basename(filePath, path.extname(filePath)));
    const spec = readConfigTableSpec(projectRoot, filePath, issues);
    if (tables[key]) {
      issues.push(`${descriptor.projectPath} has duplicate config table key: ${key} (${toPosix(path.relative(projectRoot, filePath))}).`, {
        path: toPosix(path.relative(projectRoot, filePath)),
        code: 'config.duplicate_table_key',
      });
    }
    tables[key] = {
      path: contentPackAssetPath(descriptor, filePath),
      primaryKey: spec?.primaryKey ?? 'id',
    };
  }
  return tables;
}

function generatedConfigTableRefs(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const refs = {};
  const pattern = /\b([A-Za-z_$][\w$]*)\s*:\s*tableRef(?:<[^>]+>)?\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const body = match[2];
    const name = extractStringProperty(body, 'name');
    const primaryKey = extractStringProperty(body, 'primaryKey') || 'id';
    if (name) {
      refs[match[1]] = { path: name, primaryKey };
    }
  }
  return refs;
}

function validateConfigGenerated(projectRoot, descriptor, issues) {
  const configPath = path.join(descriptor.dir, 'code', 'generated', 'config.ts');
  const rel = toPosix(path.relative(projectRoot, configPath));
  if (!fs.existsSync(configPath)) {
    issues.push(`${descriptor.projectPath} generated config is missing: ${rel}.`, {
      path: rel,
      code: 'config.generated_missing',
    });
    return;
  }
  const expected = scanConfigTables(projectRoot, descriptor, issues);
  const actual = generatedConfigTableRefs(configPath) || {};
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`${rel} is stale. Run YZForge Generate All.`, {
      path: rel,
      code: 'config.generated_stale',
    });
  }
  for (const [key, ref] of Object.entries(actual)) {
    const filePath = path.join(descriptor.dir, `${ref.path}.json`);
    if (!fs.existsSync(filePath)) {
      issues.push(`${rel} references missing config payload for table '${key}': ${toPosix(path.relative(projectRoot, filePath))}.`, {
        path: rel,
        code: 'config.payload_missing',
        target: toPosix(path.relative(projectRoot, filePath)),
      });
    }
  }
}

function scanContentPackRefs(pack, projectRoot, issues) {
  const assetFiles = [
    ...scanFiles(path.join(pack.dir, 'res', 'prefab'), '.prefab'),
    ...scanFiles(path.join(pack.dir, 'res', 'scene'), '.scene'),
    ...scanRuntimeFiles(path.join(pack.dir, 'res', 'runtime')),
  ].sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
  const configFiles = scanFiles(path.join(pack.dir, 'res', 'content', 'config'), '.json');

  const refs = {};
  for (const filePath of assetFiles) {
    const key = lowerCamelCase(path.basename(filePath, path.extname(filePath)));
    if (refs[key]) {
      issues.push(`${pack.projectPath} has duplicate ContentPack ref key: ${key} (${toPosix(path.relative(projectRoot, filePath))}).`);
    }
    refs[key] = {
      kind: 'asset',
      type: inferAssetType(filePath),
      path: contentPackAssetPath(pack, filePath),
    };
  }
  for (const filePath of configFiles) {
    const key = lowerCamelCase(path.basename(filePath, path.extname(filePath)));
    const spec = readConfigTableSpec(projectRoot, filePath, issues);
    if (refs[key]) {
      issues.push(`${pack.projectPath} has duplicate ContentPack ref key: ${key} (${toPosix(path.relative(projectRoot, filePath))}).`);
    }
    refs[key] = {
      kind: 'config',
      table: contentPackAssetPath(pack, filePath),
      primaryKey: spec?.primaryKey ?? 'id',
      codec: 'yzforge-json',
    };
  }
  return refs;
}

function normalizeContentPackPresentationRequests(pack, refs, issues) {
  const requests = pack.presentationRequests ?? [];
  if (!Array.isArray(requests)) {
    issues.push(`${pack.projectPath} presentationRequests must be an array.`);
    return [];
  }
  const normalized = [];
  const keys = new Set();
  for (const [index, request] of requests.entries()) {
    const label = `${pack.projectPath} presentationRequests[${index}]`;
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      issues.push(`${label} must be an object.`);
      continue;
    }
    const allowed = new Set(['key', 'capability', 'version', 'prefab']);
    let valid = true;
    for (const field of Object.keys(request)) {
      if (!allowed.has(field)) {
        issues.push(`${label} rejects unknown property '${field}'.`);
        valid = false;
      }
    }
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(request.key || '')) {
      issues.push(`${label}.key must be an alphanumeric Pascal/camel identifier.`);
      valid = false;
    }
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(request.capability || '')) {
      issues.push(`${label}.capability must be a dotted lowercase capability id.`);
      valid = false;
    }
    if (!Number.isSafeInteger(request.version) || request.version <= 0) {
      issues.push(`${label}.version must be a positive integer.`);
      valid = false;
    }
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(request.prefab || '')) {
      issues.push(`${label}.prefab must be a generated prefab ref key.`);
      valid = false;
    } else if (refs[request.prefab]?.kind !== 'asset' || refs[request.prefab]?.type !== 'Prefab') {
      issues.push(`${label}.prefab '${request.prefab}' must name a prefab under this ContentPack.`);
      valid = false;
    }
    if (typeof request.key === 'string' && keys.has(request.key)) {
      issues.push(`${pack.projectPath} presentation request key '${request.key}' is duplicated.`);
      valid = false;
    }
    if (typeof request.key === 'string') {
      keys.add(request.key);
    }
    if (valid) {
      normalized.push({
        key: request.key,
        capability: request.capability,
        version: request.version,
        prefab: request.prefab,
      });
    }
  }
  return normalized.sort(comparePresentationRequestKeys);
}

function validateContentPackManifest(projectRoot, project, issues) {
  for (const pack of project.contentPacks) {
    const manifestPath = path.join(pack.dir, 'manifest.generated.json');
    const rel = toPosix(path.relative(projectRoot, manifestPath));
    if (!fs.existsSync(manifestPath)) {
      issues.push(`${pack.projectPath} generated manifest is missing: ${rel}.`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      issues.push(`${rel} is invalid JSON: ${error.message}.`);
      continue;
    }

    const expectedRefs = scanContentPackRefs(pack, projectRoot, issues);
    const expectedDependencies = [...(pack.libraries || [])].sort();
    const expectedPresentationRequests = normalizeContentPackPresentationRequests(pack, expectedRefs, issues);
    const expectedBody = {
      schemaVersion: 2,
      id: pack.id,
      owner: pack.owner,
      name: pack.name,
      bundle: pack.bundle || expectedBundle('content-pack', pack),
      dependencies: expectedDependencies,
      presentationRequests: expectedPresentationRequests,
      contentHash: contentPackContentHash(expectedDependencies, expectedRefs, expectedPresentationRequests),
      refs: expectedRefs,
    };
    const expected = generatedJson(pack.projectPath, expectedBody);
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
      issues.push(`${rel} is stale. Run YZForge Generate All.`);
    }
  }
}

function contentPackContentHash(dependencies, refs, presentationRequests) {
  const normalizedRefs = {};
  for (const key of Object.keys(refs).sort()) {
    normalizedRefs[key] = refs[key];
  }
  const normalizedRequests = [...(presentationRequests || [])]
    .map((request) => ({
      key: request.key,
      capability: request.capability,
      version: request.version,
      prefab: request.prefab,
    }))
    .sort(comparePresentationRequestKeys);
  const value = JSON.stringify({
    dependencies: [...dependencies].sort(),
    presentationRequests: normalizedRequests,
    refs: normalizedRefs,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `00000000${(hash >>> 0).toString(16)}`.slice(-8);
}

// Content hashes are persisted and verified on other devices. Do not use
// localeCompare here: its result depends on the host's default locale.
function comparePresentationRequestKeys(left, right) {
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

const UUID_BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const UUID_HEX_CHARS = '0123456789abcdef';

function compactUuid(value) {
  const compact = String(value || '').split('@')[0].replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    return '';
  }
  return compact;
}

function formatUuid(compact) {
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join('-');
}

function compressUuid(value, min) {
  const compact = compactUuid(value);
  if (!compact) {
    return '';
  }

  const reserved = min ? 2 : 5;
  let result = compact.slice(0, reserved);
  for (let i = reserved; i < compact.length; i += 3) {
    const lhs = UUID_HEX_CHARS.indexOf(compact[i]);
    const mid = UUID_HEX_CHARS.indexOf(compact[i + 1]);
    const rhs = UUID_HEX_CHARS.indexOf(compact[i + 2]);
    result += UUID_BASE64_KEYS[(lhs << 2) | (mid >> 2)];
    result += UUID_BASE64_KEYS[((mid & 3) << 4) | rhs];
  }
  return result;
}

function isSerializedCustomType(value) {
  const type = String(value || '').split('@')[0];
  if (!type || type.startsWith('cc.') || type.includes('.')) {
    return false;
  }
  if (/^[0-9a-fA-F-]{32,36}$/.test(type)) {
    return Boolean(compactUuid(type));
  }
  return /^[A-Za-z0-9+/]{22,23}$/.test(type);
}

function buildScriptUuidMap(projectRoot, issues) {
  const scripts = new Map();
  const metaFiles = walk(path.join(projectRoot, 'assets'), (filePath) => filePath.endsWith('.ts.meta'))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));

  for (const metaPath of metaFiles) {
    const scriptPath = metaPath.slice(0, -'.meta'.length);
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (error) {
      issues.push(`${toPosix(path.relative(projectRoot, metaPath))} script meta is invalid JSON: ${error.message}.`);
      continue;
    }

    const compact = compactUuid(meta.uuid);
    if (!compact) {
      continue;
    }

    const rel = toPosix(path.relative(projectRoot, scriptPath));
    const record = {
      uuid: formatUuid(compact),
      path: scriptPath,
      rel,
    };
    for (const key of [record.uuid, compact, compressUuid(compact, true), compressUuid(compact, false)]) {
      if (key) {
        scripts.set(key, record);
      }
    }
  }

  return scripts;
}

function scriptSerializedKeys(projectRoot, scriptPath, issues) {
  const metaPath = `${scriptPath}.meta`;
  const rel = toPosix(path.relative(projectRoot, scriptPath));
  if (!fs.existsSync(metaPath)) {
    issues.push(`${rel} script meta is missing.`);
    return [];
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    issues.push(`${toPosix(path.relative(projectRoot, metaPath))} script meta is invalid JSON: ${error.message}.`);
    return [];
  }

  const compact = compactUuid(meta.uuid);
  if (!compact) {
    issues.push(`${toPosix(path.relative(projectRoot, metaPath))} script meta uuid is missing or invalid.`);
    return [];
  }

  return [formatUuid(compact), compact, compressUuid(compact, true), compressUuid(compact, false)];
}

function validatePrefabContainsScript(projectRoot, prefabPath, scriptPath, label, issues) {
  const expected = new Set(scriptSerializedKeys(projectRoot, scriptPath, issues));
  if (expected.size === 0) {
    return;
  }

  const actual = new Set(readSerializedScriptTypes(projectRoot, prefabPath, issues));
  if (![...expected].some((key) => actual.has(key))) {
    issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} must mount ${label} script: ${toPosix(path.relative(projectRoot, scriptPath))}.`);
  }
}

function collectSerializedTypes(value, types) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSerializedTypes(item, types);
    }
    return;
  }

  if (typeof value.__type__ === 'string' && isSerializedCustomType(value.__type__)) {
    types.add(value.__type__.split('@')[0]);
  }
  for (const item of Object.values(value)) {
    collectSerializedTypes(item, types);
  }
}

function readSerializedScriptTypes(projectRoot, assetPath, issues) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
  } catch (error) {
    issues.push(`${toPosix(path.relative(projectRoot, assetPath))} serialized asset JSON cannot be parsed: ${error.message}.`);
    return [];
  }

  const types = new Set();
  collectSerializedTypes(data, types);
  return [...types].sort();
}

function scanSerializedAssets(root) {
  return walk(root, (filePath) => {
    return (filePath.endsWith('.prefab') || filePath.endsWith('.scene')) && !filePath.endsWith('.meta');
  }).sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function allowedScriptSourcePrefixes(kind, descriptor) {
  const prefixes = [
    'assets/shared/',
    'assets/yzforge/runtime/',
  ];

  if (kind === 'module') {
    prefixes.push(`assets/modules/${descriptor.name}/`);
    prefixes.push('assets/app/global/');
  } else if (kind === 'library') {
    prefixes.push(`assets/libraries/${descriptor.name}/`);
  } else if (kind === 'content-pack') {
    prefixes.push(`assets/modules/${descriptor.owner}/`);
  } else if (kind === 'global') {
    prefixes.push('assets/app/global/');
  }

  for (const library of descriptor.libraries || []) {
    prefixes.push(`assets/libraries/${library}/`);
  }

  return prefixes;
}

function isAllowedScriptSource(sourceRel, prefixes) {
  return prefixes.some((prefix) => sourceRel === prefix.slice(0, -1) || sourceRel.startsWith(prefix));
}

function validateSerializedScriptSources(projectRoot, owner, assetPaths, scriptUuidMap, issues) {
  const prefixes = allowedScriptSourcePrefixes(owner.kind, owner.descriptor);
  for (const assetPath of assetPaths) {
    const assetRel = toPosix(path.relative(projectRoot, assetPath));
    for (const type of readSerializedScriptTypes(projectRoot, assetPath, issues)) {
      const script = scriptUuidMap.get(type);
      if (!script) {
        issues.push(`${assetRel} references unknown script uuid: ${type}.`);
        continue;
      }
      if (!isAllowedScriptSource(script.rel, prefixes)) {
        issues.push(`${assetRel} references script outside allowed scope: ${script.rel}.`);
      }
    }
  }
}

function validatePrefabScriptSources(projectRoot, project, issues) {
  const scriptUuidMap = buildScriptUuidMap(projectRoot, issues);

  if (project.global) {
    validateSerializedScriptSources(projectRoot, {
      kind: 'global',
      descriptor: project.global,
    }, scanSerializedAssets(path.join(project.global.dir, 'res')), scriptUuidMap, issues);
  }

  for (const descriptor of project.modules) {
    validateSerializedScriptSources(projectRoot, {
      kind: 'module',
      descriptor,
    }, scanSerializedAssets(path.join(descriptor.dir, 'res')), scriptUuidMap, issues);
  }

  for (const descriptor of project.libraries) {
    validateSerializedScriptSources(projectRoot, {
      kind: 'library',
      descriptor,
    }, scanSerializedAssets(path.join(descriptor.dir, 'res')), scriptUuidMap, issues);
  }

  for (const descriptor of project.contentPacks) {
    validateSerializedScriptSources(projectRoot, {
      kind: 'content-pack',
      descriptor,
    }, scanSerializedAssets(path.join(descriptor.dir, 'res')), scriptUuidMap, issues);
  }
}

function validateContentPackDoesNotProvideUiViews(projectRoot, project, issues) {
  const scriptUuidMap = buildScriptUuidMap(projectRoot, issues);
  for (const descriptor of project.contentPacks) {
    for (const prefabPath of scanPrefabs(path.join(descriptor.dir, 'res', 'prefab'))) {
      const rel = toPosix(path.relative(projectRoot, prefabPath));
      const name = path.basename(prefabPath, '.prefab');
      if (VIEW_POLICY_KINDS.some((kind) => name.startsWith(kind))) {
        issues.push(`${rel} ContentPack must not provide UIManager View prefab; move View prefabs to owner Module res/view.`, {
          path: rel,
          code: 'content_pack.ui_view_prefab',
        });
      }
      for (const type of readSerializedScriptTypes(projectRoot, prefabPath, issues)) {
        const script = scriptUuidMap.get(type);
        if (script && /\/code\/view\//.test(script.rel)) {
          issues.push(`${rel} ContentPack must not mount UIManager View script: ${script.rel}.`, {
            path: rel,
            code: 'content_pack.ui_view_script',
            target: script.rel,
          });
        }
      }
    }
  }
}

function generatedViewPolicies(content) {
  const policies = new Map();
  const pattern = /\b([A-Za-z_$][\w$]*)\s*:\s*viewRef\(\s*['"][^'"]+['"]\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*['"][^'"]+['"]\s*,\s*\{([\s\S]*?)\}\s*\)\s*,?/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const rawKind = extractObjectProperty(match[3], 'kind');
    policies.set(match[1], {
      className: match[2],
      kind: rawKind ? enumValueName(rawKind, 'ViewKind', VIEW_POLICY_KINDS) : undefined,
      rawKind,
    });
  }
  return policies;
}

function offsetLocation(content, offset) {
  const before = content.slice(0, offset);
  const lines = before.split(/\r\n?|\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function validateOpenForResultTargets(projectRoot, project, issues) {
  const descriptors = project.global ? [project.global, ...project.modules] : project.modules;
  for (const descriptor of descriptors) {
    const codeDir = path.join(descriptor.dir, 'code');
    const assetsPath = path.join(codeDir, 'generated', 'assets.ts');
    if (!fs.existsSync(assetsPath)) {
      continue;
    }
    const policies = generatedViewPolicies(fs.readFileSync(assetsPath, 'utf8'));
    const toastKeys = new Set(Array.from(policies.entries())
      .filter(([, policy]) => policy.kind === 'Toast')
      .map(([key]) => key));
    if (toastKeys.size === 0) {
      continue;
    }

    for (const filePath of walk(codeDir, (item) => item.endsWith('.ts') && !item.endsWith('.generated.ts'))) {
      const rel = toPosix(path.relative(projectRoot, filePath));
      const content = fs.readFileSync(filePath, 'utf8');
      const source = stripCodeComments(content);
      const pattern = /\bopenForResult\s*\(\s*assets\.views\.([A-Za-z_$][\w$]*)\b/g;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        if (!toastKeys.has(match[1])) {
          continue;
        }
        issues.push(`${rel} must not call openForResult with Toast View '${match[1]}'. Use open or a Popup/Paper result flow.`, {
          path: rel,
          code: 'ui.open_for_result_toast',
          target: toPosix(path.relative(projectRoot, assetsPath)),
          ...offsetLocation(source, match.index),
        });
      }
    }
  }
}

function stripCodeComments(content) {
  return String(content || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractImportSpecifiers(content) {
  return extractImportRecords(content).map((record) => record.specifier);
}

function fallbackImportRecords(content) {
  const source = stripCodeComments(content);
  const records = [];
  const staticPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = staticPattern.exec(source)) !== null) {
    records.push({ specifier: match[1], kind: 'static', line: undefined, column: undefined });
  }
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicPattern.exec(source)) !== null) {
    records.push({ specifier: match[1], kind: 'dynamic', line: undefined, column: undefined });
  }
  return records;
}

function sourceLocation(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    line: position.line + 1,
    column: position.character + 1,
  };
}

function extractImportRecords(content, fileName = 'source.ts') {
  const ts = loadTypeScript();
  if (!ts) {
    return fallbackImportRecords(content);
  }

  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const records = [];
  const addRecord = (node, specifier, kind, typeOnly = false) => {
    records.push({
      specifier,
      kind,
      typeOnly,
      ...sourceLocation(sourceFile, node),
    });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addRecord(node, node.moduleSpecifier.text, 'import', Boolean(node.importClause?.isTypeOnly));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addRecord(node, node.moduleSpecifier.text, 'export', Boolean(node.isTypeOnly));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) {
        addRecord(node, argument.text, 'dynamic');
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      addRecord(node, node.argument.literal.text, 'import-type', true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return records;
}

function pushImportIssue(issues, rel, message, record, targetRel) {
  issues.push(`${rel} ${message}`, {
    path: rel,
    line: record.line,
    column: record.column,
    specifier: record.specifier,
    target: targetRel,
    code: 'import.boundary',
  });
}

function parseTypeScriptFile(content, fileName) {
  const ts = loadTypeScript();
  if (!ts) {
    return undefined;
  }
  return {
    ts,
    sourceFile: ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
}

function pushNodeIssue(issues, rel, message, code, sourceFile, node, extra = {}) {
  const location = sourceFile && node ? sourceLocation(sourceFile, node) : {};
  issues.push(`${rel} ${message}`, {
    path: rel,
    code,
    ...location,
    ...extra,
  });
}

function isForbiddenServiceUiCall(ts, sourceFile, node) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const expression = node.expression.getText(sourceFile);
  return /^(?:this\.module\.ui|this\.ui)\.(?:open|openForResult|close|closeLayer|back)$/.test(expression);
}

function isLongLivedNodeType(ts, sourceFile, node) {
  if (!ts.isPropertyDeclaration(node) || !node.type) {
    return false;
  }
  const typeText = node.type.getText(sourceFile);
  return /(?:^|[<>,\s|&()[\]{}])(?:Node|Component)(?:$|[<>,\s|&()[\]{}])/.test(typeText)
    || /\bcc\.(?:Node|Component)\b/.test(typeText);
}

function isThisMethodCall(ts, sourceFile, node, method) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  return node.expression.name.text === method && node.expression.expression.getText(sourceFile) === 'this';
}

function isCallNamed(ts, node, names) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && names.has(node.expression.text);
}

function isUnmanagedNodeOn(ts, sourceFile, node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  if (node.expression.name.text !== 'on') {
    return false;
  }
  const target = node.expression.expression.getText(sourceFile);
  return target === 'this.node' || /\.node$/.test(target);
}

function isInsideThisAddDisposer(ts, sourceFile, node) {
  let current = node.parent;
  while (current) {
    if (isThisMethodCall(ts, sourceFile, current, 'addDisposer')) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function assignedIdentifier(ts, node) {
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(parent.left)) {
    return parent.left.text;
  }
  return undefined;
}

function unwrapExpression(ts, node) {
  let current = node;
  let changed = true;
  while (current && changed) {
    changed = false;
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      changed = true;
    } else if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      changed = true;
    } else if (typeof ts.isNonNullExpression === 'function' && ts.isNonNullExpression(current)) {
      current = current.expression;
      changed = true;
    } else if (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)) {
      current = current.expression;
      changed = true;
    }
  }
  return current;
}

function isAssignmentOperator(ts, kind) {
  return [
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
    ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.AsteriskAsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken,
    ts.SyntaxKind.PercentEqualsToken,
    ts.SyntaxKind.LessThanLessThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.BarEqualsToken,
    ts.SyntaxKind.CaretEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ].includes(kind);
}

function propertyNameText(ts, name) {
  if (!name) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function expressionIsAlias(ts, node, aliases) {
  const expression = unwrapExpression(ts, node);
  return Boolean(expression && ts.isIdentifier(expression) && aliases.has(expression.text));
}

function isContextAppReference(ts, node, contextAliases, appAliases) {
  const expression = unwrapExpression(ts, node);
  if (!expression) {
    return false;
  }
  if (ts.isIdentifier(expression)) {
    return appAliases.has(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'app' && expressionIsAlias(ts, expression.expression, contextAliases);
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = unwrapExpression(ts, expression.argumentExpression);
    return argument
      && ts.isStringLiteral(argument)
      && argument.text === 'app'
      && expressionIsAlias(ts, expression.expression, contextAliases);
  }
  return false;
}

function expressionTargetsContextApp(ts, node, contextAliases, appAliases) {
  const expression = unwrapExpression(ts, node);
  if (!expression) {
    return false;
  }
  if (isContextAppReference(ts, expression, contextAliases, appAliases)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expressionTargetsContextApp(ts, expression.expression, contextAliases, appAliases);
  }
  return false;
}

function collectExtensionContextAliases(ts, sourceFile) {
  const contextAliases = new Set(['context']);
  const appAliases = new Set();
  const lifecycleHooks = new Set([
    'install',
    'installBeforeStart',
    'installAfterMainBinding',
    'installBeforeFirstModule',
    'dispose',
    'uninstall',
  ]);

  const parameterLooksLikeExtensionContext = (node) => {
    if (!ts.isIdentifier(node.name)) {
      return false;
    }
    if (node.type && /\bExtensionContext\b/.test(node.type.getText(sourceFile))) {
      return true;
    }
    if (!node.parent) {
      return false;
    }
    if (ts.isMethodDeclaration(node.parent) && propertyNameText(ts, node.parent.name) && lifecycleHooks.has(propertyNameText(ts, node.parent.name))) {
      return true;
    }
    if (
      ts.isPropertyAssignment(node.parent)
      && propertyNameText(ts, node.parent.name)
      && lifecycleHooks.has(propertyNameText(ts, node.parent.name))
    ) {
      return true;
    }
    return node.name.text === 'context';
  };

  const collect = (node) => {
    if (ts.isParameter(node) && parameterLooksLikeExtensionContext(node)) {
      contextAliases.add(node.name.text);
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && expressionIsAlias(ts, node.initializer, contextAliases)) {
        contextAliases.add(node.name.text);
      }
      if (ts.isIdentifier(node.name) && isContextAppReference(ts, node.initializer, contextAliases, appAliases)) {
        appAliases.add(node.name.text);
      }
      if (ts.isObjectBindingPattern(node.name) && expressionIsAlias(ts, node.initializer, contextAliases)) {
        for (const element of node.name.elements) {
          const key = propertyNameText(ts, element.propertyName || element.name);
          if (key === 'app' && ts.isIdentifier(element.name)) {
            appAliases.add(element.name.text);
          }
        }
      }
    }

    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  return { contextAliases, appAliases };
}

function isAppMutatorCall(ts, sourceFile, node, contextAliases, appAliases) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const expression = node.expression.getText(sourceFile);
  if (!/^(?:Object\.assign|Object\.defineProperty|Object\.defineProperties|Reflect\.set|Reflect\.deleteProperty)$/.test(expression)) {
    return false;
  }
  const [target] = node.arguments;
  return Boolean(target && expressionTargetsContextApp(ts, target, contextAliases, appAliases));
}

function validateExtensionAstRules(ts, sourceFile, rel, issues) {
  const { contextAliases, appAliases } = collectExtensionContextAliases(ts, sourceFile);
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node)
      && isAssignmentOperator(ts, node.operatorToken.kind)
      && expressionTargetsContextApp(ts, node.left, contextAliases, appAliases)
    ) {
      pushNodeIssue(
        issues,
        rel,
        'Extension must not mutate App fields; expose capabilities through ExtensionContext tokens.',
        'extension.app_mutation',
        sourceFile,
        node,
      );
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      && expressionTargetsContextApp(ts, node.operand, contextAliases, appAliases)
    ) {
      pushNodeIssue(
        issues,
        rel,
        'Extension must not mutate App fields; expose capabilities through ExtensionContext tokens.',
        'extension.app_mutation',
        sourceFile,
        node,
      );
    } else if (
      node.kind === ts.SyntaxKind.DeleteExpression
      && expressionTargetsContextApp(ts, node.expression, contextAliases, appAliases)
    ) {
      pushNodeIssue(
        issues,
        rel,
        'Extension must not mutate App fields; expose capabilities through ExtensionContext tokens.',
        'extension.app_mutation',
        sourceFile,
        node,
      );
    } else if (isAppMutatorCall(ts, sourceFile, node, contextAliases, appAliases)) {
      pushNodeIssue(
        issues,
        rel,
        'Extension must not mutate App fields; expose capabilities through ExtensionContext tokens.',
        'extension.app_mutation',
        sourceFile,
        node,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectManagedTimerNames(ts, sourceFile) {
  const managed = new Set();
  const visitDisposer = (node) => {
    if (isCallNamed(ts, node, new Set(['clearInterval', 'clearTimeout']))) {
      const [target] = node.arguments;
      if (target && ts.isIdentifier(target)) {
        managed.add(target.text);
      }
    }
    ts.forEachChild(node, visitDisposer);
  };
  const visit = (node) => {
    if (isThisMethodCall(ts, sourceFile, node, 'addDisposer')) {
      for (const argument of node.arguments) {
        visitDisposer(argument);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return managed;
}

function validateViewAstRules(ts, sourceFile, rel, issues) {
  const managedTimers = collectManagedTimerNames(ts, sourceFile);
  const timerCalls = new Set(['setInterval', 'setTimeout']);
  const visit = (node) => {
    if (isUnmanagedNodeOn(ts, sourceFile, node)) {
      pushNodeIssue(
        issues,
        rel,
        'view must use this.listen instead of direct Node.on.',
        'view.listener_unmanaged',
        sourceFile,
        node,
      );
    }
    if (isCallNamed(ts, node, timerCalls) && !isInsideThisAddDisposer(ts, sourceFile, node)) {
      const timerName = assignedIdentifier(ts, node);
      if (!timerName || !managedTimers.has(timerName)) {
        pushNodeIssue(
          issues,
          rel,
          'view timers must be cleaned with addDisposer.',
          'view.timer_unmanaged',
          sourceFile,
          node,
        );
      }
    }
    if (isThisMethodCall(ts, sourceFile, node, 'schedule') || isThisMethodCall(ts, sourceFile, node, 'scheduleOnce')) {
      pushNodeIssue(
        issues,
        rel,
        'view schedules must be cleaned with addDisposer.',
        'view.schedule_unmanaged',
        sourceFile,
        node,
      );
    }
    if (isCallNamed(ts, node, new Set(['tween'])) && !isInsideThisAddDisposer(ts, sourceFile, node)) {
      pushNodeIssue(
        issues,
        rel,
        'view tween must be cleaned with addDisposer.',
        'view.tween_unmanaged',
        sourceFile,
        node,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function validateStrictAstRules(rel, content, issues) {
  const parsed = parseTypeScriptFile(content, rel);
  if (!parsed) {
    return false;
  }
  const { ts, sourceFile } = parsed;
  const isModel = /\/code\/model\//.test(rel);
  const isService = /\/code\/service\//.test(rel);
  const isView = /\/code\/view\//.test(rel);
  const isExtension = /^assets\/app\/extensions\//.test(rel);
  if (!isModel && !isService && !isView && !isExtension) {
    return true;
  }

  if (isExtension) {
    validateExtensionAstRules(ts, sourceFile, rel, issues);
  }

  if (isModel) {
    for (const record of extractImportRecords(content, rel)) {
      if (record.specifier === 'cc') {
        issues.push(`${rel} model must not import cc.`, {
          path: rel,
          line: record.line,
          column: record.column,
          specifier: record.specifier,
          code: 'model.cc_import',
        });
      }
    }
  }

  if (isService) {
    const visit = (node) => {
      if (isForbiddenServiceUiCall(ts, sourceFile, node)) {
        pushNodeIssue(
          issues,
          rel,
          'service must not directly operate UI; move UI orchestration to Flow.',
          'service.ui_direct',
          sourceFile,
          node,
        );
      }
      if (isLongLivedNodeType(ts, sourceFile, node)) {
        pushNodeIssue(
          issues,
          rel,
          'service must not keep long-lived Node or Component fields.',
          'service.node_field',
          sourceFile,
          node,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (isView) {
    validateViewAstRules(ts, sourceFile, rel, issues);
  }

  return true;
}

function resolveExistingImportTarget(filePath) {
  const candidates = [
    filePath,
    `${filePath}.ts`,
    `${filePath}.tsx`,
    `${filePath}.js`,
    `${filePath}.json`,
    path.join(filePath, 'index.ts'),
    path.join(filePath, 'index.tsx'),
    path.join(filePath, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return filePath;
}

function resolveImportTarget(projectRoot, fromFile, specifier) {
  if (specifier.startsWith('.')) {
    return toPosix(path.relative(projectRoot, resolveExistingImportTarget(path.resolve(path.dirname(fromFile), specifier))));
  }
  if (specifier === 'yzforge') {
    return 'packages/yzforge-runtime/src/index.ts';
  }
  if (specifier.startsWith('yzforge/modules/')) {
    const name = specifier.slice('yzforge/modules/'.length).split('/')[0];
    return `assets/app/registry/modules/${name}.ref.generated.ts`;
  }
  if (specifier.startsWith('yzforge/libraries/')) {
    const name = specifier.slice('yzforge/libraries/'.length).split('/')[0];
    return `assets/app/registry/libraries/${name}.ref.generated.ts`;
  }
  if (specifier.startsWith('yzforge/content-packs/')) {
    return `assets/app/registry/content-packs/${specifier.slice('yzforge/content-packs/'.length)}.generated.ts`;
  }
  if (specifier.startsWith('yzforge/contracts/modules/')) {
    const name = specifier.slice('yzforge/contracts/modules/'.length).split('/')[0];
    return `assets/app/contracts/modules/${name}.contract.generated.ts`;
  }
  if (specifier.startsWith('yzforge/contracts/libraries/')) {
    const name = specifier.slice('yzforge/contracts/libraries/'.length).split('/')[0];
    return `assets/app/contracts/libraries/${name}.contract.generated.ts`;
  }
  if (specifier.startsWith('yzforge/contracts/content-packs/')) {
    const name = specifier.slice('yzforge/contracts/content-packs/'.length).split('/')[0];
    return `assets/app/contracts/content-packs/${name}.contract.generated.ts`;
  }
  if (specifier.startsWith('yzforge/contracts/extensions/')) {
    const name = specifier.slice('yzforge/contracts/extensions/'.length).split('/')[0];
    return `assets/app/contracts/extensions/${name}.contract.generated.ts`;
  }
  if (specifier.startsWith('yzforge/shared/')) {
    return toPosix(path.relative(projectRoot, resolveExistingImportTarget(path.join(projectRoot, 'assets', 'shared', 'code', specifier.slice('yzforge/shared/'.length)))));
  }
  if (specifier.startsWith('yzforge/')) {
    return toPosix(path.relative(projectRoot, resolveExistingImportTarget(path.join(projectRoot, 'packages', 'yzforge-runtime', 'src', specifier.slice('yzforge/'.length)))));
  }
  if (specifier.startsWith('db://assets/')) {
    return toPosix(path.relative(projectRoot, resolveExistingImportTarget(path.join(projectRoot, 'assets', specifier.slice('db://assets/'.length)))));
  }
  return undefined;
}

function moduleFromRegistryTarget(targetRel) {
  const match = targetRel.match(/^assets\/app\/registry\/modules\/([^/.]+)\.ref\.generated\.ts$/);
  return match ? match[1] : undefined;
}

function libraryFromRegistryOrContractTarget(targetRel) {
  const registry = targetRel.match(/^assets\/app\/registry\/libraries\/([^/.]+)\.ref\.generated\.ts$/);
  if (registry) {
    return registry[1];
  }
  const contract = targetRel.match(/^assets\/app\/contracts\/libraries\/([^/.]+)\.contract\.generated\.ts$/);
  return contract ? contract[1] : undefined;
}

function contentPackOwnerFromTarget(targetRel, specifier) {
  const generated = targetRel.match(/^assets\/modules\/([^/]+)\/code\/generated\/content-packs\.ts$/);
  if (generated) {
    return generated[1];
  }
  const direct = targetRel.match(/^assets\/content-packs\/([^/]+)\//);
  if (direct) {
    return direct[1];
  }
  const alias = specifier.match(/^yzforge\/content-packs\/([^/]+)(?:\/|$)/);
  return alias ? alias[1] : undefined;
}

function codeScopeFromPath(rel) {
  let match = rel.match(/^assets\/modules\/([^/]+)\//);
  if (match) {
    return { kind: 'module', name: match[1] };
  }
  match = rel.match(/^assets\/libraries\/([^/]+)\//);
  if (match) {
    return { kind: 'library', name: match[1] };
  }
  if (rel.startsWith('assets/shared/')) {
    return { kind: 'shared', name: 'shared' };
  }
  if (rel.startsWith('assets/app/global/')) {
    return { kind: 'global', name: 'global' };
  }
  if (rel.startsWith('assets/app/extensions/')) {
    return { kind: 'extension', name: 'extension' };
  }
  if (rel.startsWith('assets/app/registry/') || rel.startsWith('assets/app/contracts/')) {
    return { kind: 'contract', name: 'app' };
  }
  return undefined;
}

function normalizeList(values) {
  return Array.from(new Set(values || [])).sort((a, b) => a.localeCompare(b));
}

function sameNameList(left, right) {
  return normalizeList(left).join('|') === normalizeList(right).join('|');
}

function extractStringProperty(content, property) {
  const match = new RegExp(`\\b${property}\\s*:\\s*['"]([^'"]+)['"]`).exec(content);
  return match ? match[1] : undefined;
}

function extractLibraryArray(content) {
  const match = /\blibraries\s*:\s*\[([\s\S]*?)\]/m.exec(content);
  if (!match) {
    return [];
  }
  const libraries = [];
  const refPattern = /\b([A-Za-z_$][\w$]*)Ref\b/g;
  let ref;
  while ((ref = refPattern.exec(match[1])) !== null) {
    libraries.push(ref[1]);
  }
  return normalizeList(libraries);
}

function parseRefOrEntryFile(projectRoot, filePath, label, issues) {
  const rel = toPosix(path.relative(projectRoot, filePath));
  if (!fs.existsSync(filePath)) {
    issues.push(`${label} is missing: ${rel}.`);
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    rel,
    name: extractStringProperty(content, 'name'),
    bundle: extractStringProperty(content, 'bundle'),
    libraries: extractLibraryArray(content),
  };
}

function validateShapeMatchesDescriptor(shape, descriptor, kind, shapeLabel, issues) {
  if (!shape) {
    return;
  }
  const label = `${kind}:${descriptor.name} ${shapeLabel}`;
  if (shape.name !== descriptor.name) {
    issues.push(`${shape.rel} ${label} name must be '${descriptor.name}', got '${shape.name}'.`);
  }
  const expected = expectedBundle(kind, descriptor);
  if (shape.bundle !== expected) {
    issues.push(`${shape.rel} ${label} bundle must be '${expected}', got '${shape.bundle}'.`);
  }
  if (!sameNameList(shape.libraries, descriptor.libraries || [])) {
    issues.push(`${shape.rel} ${label} libraries must be [${normalizeList(descriptor.libraries || []).join(', ')}], got [${shape.libraries.join(', ')}].`);
  }
}

function validateRefEntryConsistency(projectRoot, project, issues) {
  for (const descriptor of project.modules) {
    const ref = parseRefOrEntryFile(
      projectRoot,
      path.join(projectRoot, 'assets', 'app', 'registry', 'modules', `${descriptor.name}.ref.generated.ts`),
      `module:${descriptor.name} ModuleRef`,
      issues,
    );
    const entry = parseRefOrEntryFile(
      projectRoot,
      path.join(descriptor.dir, descriptor.entry || 'code/generated/entry.ts'),
      `module:${descriptor.name} ModuleEntry`,
      issues,
    );
    validateShapeMatchesDescriptor(ref, descriptor, 'module', 'ref', issues);
    validateShapeMatchesDescriptor(entry, descriptor, 'module', 'entry', issues);
    if (ref && entry && (!sameNameList(ref.libraries, entry.libraries) || ref.name !== entry.name || ref.bundle !== entry.bundle)) {
      issues.push(`module:${descriptor.name} ModuleRef and ModuleEntry must declare the same name, bundle, and libraries.`);
    }
  }

  for (const descriptor of project.libraries) {
    const ref = parseRefOrEntryFile(
      projectRoot,
      path.join(projectRoot, 'assets', 'app', 'registry', 'libraries', `${descriptor.name}.ref.generated.ts`),
      `library:${descriptor.name} LibraryRef`,
      issues,
    );
    const entry = parseRefOrEntryFile(
      projectRoot,
      path.join(descriptor.dir, descriptor.entry || 'code/generated/entry.ts'),
      `library:${descriptor.name} LibraryEntry`,
      issues,
    );
    validateShapeMatchesDescriptor(ref, descriptor, 'library', 'ref', issues);
    validateShapeMatchesDescriptor(entry, descriptor, 'library', 'entry', issues);
    if (ref && entry && (!sameNameList(ref.libraries, entry.libraries) || ref.name !== entry.name || ref.bundle !== entry.bundle)) {
      issues.push(`library:${descriptor.name} LibraryRef and LibraryEntry must declare the same name, bundle, and libraries.`);
    }
  }
}

function isEntryImportAllowed(projectRoot, descriptor, targetRel) {
  const descriptorRel = toPosix(path.relative(projectRoot, descriptor.dir));
  return targetRel.startsWith(`${descriptorRel}/code/`)
    || targetRel.startsWith('assets/yzforge/runtime/')
    || targetRel.startsWith('packages/yzforge-runtime/src/')
    || targetRel.startsWith('assets/app/registry/')
    || targetRel.startsWith('assets/app/contracts/')
    || targetRel.startsWith('assets/shared/');
}

function validateEntryImports(projectRoot, project, issues) {
  const descriptors = project.modules.map((descriptor) => ({ kind: 'module', descriptor }))
    .concat(project.libraries.map((descriptor) => ({ kind: 'library', descriptor })));
  for (const { kind, descriptor } of descriptors) {
    const filePath = path.join(descriptor.dir, descriptor.entry || 'code/generated/entry.ts');
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const rel = toPosix(path.relative(projectRoot, filePath));
    for (const record of extractImportRecords(fs.readFileSync(filePath, 'utf8'), rel)) {
      const targetRel = resolveImportTarget(projectRoot, filePath, record.specifier);
      if (!targetRel || !isEntryImportAllowed(projectRoot, descriptor, targetRel)) {
        pushImportIssue(issues, rel, `imports unsupported ${kind} entry dependency: ${record.specifier}.`, record, targetRel);
      }
    }
  }
}

function validateLibraryCycles(project, issues) {
  const graph = new Map(project.libraries.map((library) => [library.name, library.libraries || []]));
  const visiting = new Set();
  const visited = new Set();
  const reported = new Set();

  function visit(name, pathStack) {
    if (visiting.has(name)) {
      const start = pathStack.indexOf(name);
      const cycle = pathStack.slice(start);
      if (cycle[cycle.length - 1] !== name) {
        cycle.push(name);
      }
      const key = normalizeList(cycle).join('|');
      if (!reported.has(key)) {
        reported.add(key);
        issues.push(`Library dependency cycle: ${cycle.join(' -> ')}.`);
      }
      return;
    }
    if (visited.has(name)) {
      return;
    }
    visiting.add(name);
    for (const dependency of graph.get(name) || []) {
      if (graph.has(dependency)) {
        visit(dependency, pathStack.concat(dependency));
      }
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of graph.keys()) {
    visit(name, [name]);
  }
}

function validateImportBoundaries(projectRoot, project, issues) {
  const descriptors = new Map();
  for (const descriptor of project.modules) {
    descriptors.set(`module:${descriptor.name}`, descriptor);
  }
  for (const descriptor of project.libraries) {
    descriptors.set(`library:${descriptor.name}`, descriptor);
  }

  const files = walk(path.join(projectRoot, 'assets'), (filePath) => filePath.endsWith('.ts'));
  for (const filePath of files) {
    const rel = toPosix(path.relative(projectRoot, filePath));
    if (rel.startsWith('assets/yzforge/runtime/')) {
      continue;
    }
    const scope = codeScopeFromPath(rel);
    if (!scope) {
      continue;
    }
    const descriptor = descriptors.get(`${scope.kind}:${scope.name}`);
    const declaredLibraries = new Set(descriptor?.libraries || []);

    for (const record of extractImportRecords(fs.readFileSync(filePath, 'utf8'), rel)) {
      const targetRel = resolveImportTarget(projectRoot, filePath, record.specifier);
      if (!targetRel) {
        continue;
      }

      const targetScope = codeScopeFromPath(targetRel);
      const usedLibrary = libraryFromRegistryOrContractTarget(targetRel);
      if ((scope.kind === 'module' || scope.kind === 'library') && usedLibrary && usedLibrary !== scope.name && !declaredLibraries.has(usedLibrary)) {
        pushImportIssue(issues, rel, `imports undeclared library '${usedLibrary}'. Add it to ${scope.name} ${scope.kind}.json libraries.`, record, targetRel);
      }

      const packOwner = contentPackOwnerFromTarget(targetRel, record.specifier);
      if (packOwner) {
        if (scope.kind === 'module' && packOwner !== scope.name) {
          pushImportIssue(issues, rel, `accesses non-owner ContentPack for '${packOwner}'. Only owner module '${packOwner}' may import it.`, record, targetRel);
        } else if (scope.kind !== 'module' && scope.kind !== 'contract') {
          pushImportIssue(issues, rel, `must not access ContentPack owned by '${packOwner}'.`, record, targetRel);
        }
      }

      if (scope.kind === 'module') {
        if (targetScope?.kind === 'module' && targetScope.name !== scope.name && !moduleFromRegistryTarget(targetRel)) {
          pushImportIssue(issues, rel, `imports another module internal path: ${record.specifier}`, record, targetRel);
        }
        if (targetScope?.kind === 'library') {
          pushImportIssue(issues, rel, `imports library internal path: ${record.specifier}`, record, targetRel);
        }
        if (targetScope?.kind === 'global') {
          pushImportIssue(issues, rel, `imports global internal path: ${record.specifier}. Use a Global public facade, app token, or event.`, record, targetRel);
        }
      } else if (scope.kind === 'library') {
        if (targetScope?.kind === 'module') {
          pushImportIssue(issues, rel, `imports module internal path: ${record.specifier}`, record, targetRel);
        }
        if (targetScope?.kind === 'library' && targetScope.name !== scope.name) {
          pushImportIssue(issues, rel, `imports another library internal path: ${record.specifier}`, record, targetRel);
        }
      } else if (scope.kind === 'shared') {
        if (targetScope && ['global', 'module', 'library'].includes(targetScope.kind)) {
          pushImportIssue(issues, rel, `shared code must not import ${targetScope.kind} scope: ${record.specifier}`, record, targetRel);
        }
      } else if (scope.kind === 'global') {
        if (targetScope && ['module', 'library'].includes(targetScope.kind)) {
          pushImportIssue(issues, rel, `global code must not import ${targetScope.kind} internal path: ${record.specifier}`, record, targetRel);
        }
      } else if (scope.kind === 'extension') {
        if (targetScope && ['module', 'library', 'global'].includes(targetScope.kind)) {
          pushImportIssue(issues, rel, `extension code must not import ${targetScope.kind} internal path: ${record.specifier}`, record, targetRel);
        }
      } else if (scope.kind === 'contract') {
        if (targetScope && ['module', 'library', 'global'].includes(targetScope.kind)) {
          pushImportIssue(issues, rel, `registry/contract must not import runtime scope path: ${record.specifier}`, record, targetRel);
        }
      }
    }
  }
}

function validateStrictCodeRules(projectRoot, issues) {
  const files = walk(path.join(projectRoot, 'assets'), (filePath) => filePath.endsWith('.ts'));
  for (const filePath of files) {
    const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    if (rel.startsWith('assets/yzforge/runtime/')) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const withoutComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const astChecked = validateStrictAstRules(rel, content, issues);

    if (/\/res\//.test(rel)) {
      issues.push(`${rel} must not place TypeScript source under res/.`);
    }
    if (/^assets\/content-packs\//.test(rel)) {
      issues.push(`${rel} content packs must not contain TypeScript source.`);
    }
    if (!astChecked && /\/code\/model\//.test(rel) && /from\s+['"]cc['"]/.test(withoutComments)) {
      issues.push(`${rel} model must not import cc.`);
    }
    if (!astChecked && /\/code\/service\//.test(rel) && /\bthis\.module\.ui\.(open|openForResult|close|closeLayer|back)\s*\(/.test(withoutComments)) {
      issues.push(`${rel} service must not directly operate UI; move UI orchestration to Flow.`);
    }
    if (!astChecked && /\/code\/service\//.test(rel) && /^\s*(?:private|protected|public)\s+[\w$]+\??\s*:\s*[^;\n]*(?:Node|Component)\b/m.test(withoutComments)) {
      issues.push(`${rel} service must not keep long-lived Node or Component fields.`);
    }
    if (!astChecked && /\/code\/view\//.test(rel) && /\.node\.on\s*\(/.test(withoutComments)) {
      issues.push(`${rel} view must use this.listen instead of direct Node.on.`);
    }
    if (!astChecked && /\/code\/view\//.test(rel) && /\b(?:setInterval|setTimeout)\s*\(/.test(withoutComments)) {
      issues.push(`${rel} view timers must be cleaned with addDisposer.`);
    }
    if (!astChecked && /\/code\/view\//.test(rel) && /\bthis\.schedule(?:Once)?\s*\(/.test(withoutComments)) {
      issues.push(`${rel} view schedules must be cleaned with addDisposer.`);
    }
    if (!astChecked && /\/code\/view\//.test(rel) && /\btween\s*\(/.test(withoutComments)) {
      issues.push(`${rel} view tween must be cleaned with addDisposer.`);
    }
    if (!astChecked && /^assets\/app\/extensions\//.test(rel)) {
      const appTarget = String.raw`(?:context\s*(?:\.\s*app|\[\s*['"]app['"]\s*\])|app)`;
      const appField = String.raw`(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*['"][^'"]+['"]\s*\]))+`;
      const appAssignment = new RegExp(`${appTarget}${appField}\\s*(?:[+\\-*/%&|^?]?=|\\+\\+|--)`);
      const appMutatorCall = new RegExp(
        String.raw`\b(?:Object\.assign|Object\.defineProperty|Object\.defineProperties|Reflect\.set|Reflect\.deleteProperty)\s*\(\s*${appTarget}`,
      );
      if (appAssignment.test(withoutComments) || appMutatorCall.test(withoutComments)) {
        issues.push(`${rel} Extension must not mutate App fields; expose capabilities through ExtensionContext tokens.`, {
          path: rel,
          code: 'extension.app_mutation',
        });
      }
    }
    const isBusinessCode = /^assets\/(?:modules|libraries)\//.test(rel) || /^assets\/app\/global\//.test(rel);
    if (isBusinessCode) {
      const safeAreaMatch = /\bsys\s*\.\s*getSafeAreaRect\s*\(/.exec(withoutComments);
      if (safeAreaMatch) {
        issues.push(`${rel} business code must read safe area through app.viewport.profile, not sys.getSafeAreaRect.`, {
          path: rel,
          code: 'viewport.safe_area_direct',
          ...offsetLocation(withoutComments, safeAreaMatch.index),
        });
      }
      const designResolutionMatch = /\bview\s*\.\s*setDesignResolutionSize\s*\(/.exec(withoutComments);
      if (designResolutionMatch) {
        issues.push(`${rel} business code must not change design resolution directly; configure App viewport instead.`, {
          path: rel,
          code: 'viewport.design_resolution_direct',
          ...offsetLocation(withoutComments, designResolutionMatch.index),
        });
      }
    }
    if (/^assets\/(?:modules|libraries)\//.test(rel) && /\bassetManager\.loadBundle\s*\(/.test(withoutComments)) {
      issues.push(`${rel} must not call assetManager.loadBundle directly.`);
    }
    if (/^assets\/(?:modules|libraries)\//.test(rel) && /\binstantiate\s*\(/.test(withoutComments) && !/\.assets\.instantiate\s*\(/.test(withoutComments)) {
      issues.push(`${rel} uses manual instantiate; use owner assets.instantiate or track ownership explicitly.`);
    }
  }
}

function validate(projectRoot, options = {}) {
  activeProjectRoot = path.resolve(projectRoot);
  const project = scanProject(projectRoot);
  const issues = createIssueCollector(projectRoot);
  const known = {
    modules: new Set(project.modules.map((item) => item.name)),
    libraries: new Set(project.libraries.map((item) => item.name)),
  };

  validateOrphanScopes(project, issues);
  validateRuntimeTemplate(projectRoot, issues);
  for (const descriptor of project.modules) {
    validateDescriptor('module', descriptor, known, issues);
    validateBundleMeta(projectRoot, 'module', descriptor, issues);
    validatePublicContract(projectRoot, descriptor, issues);
    validateConfigGenerated(projectRoot, descriptor, issues);
  }
  for (const descriptor of project.libraries) {
    validateDescriptor('library', descriptor, known, issues);
    validateBundleMeta(projectRoot, 'library', descriptor, issues);
    validatePublicContract(projectRoot, descriptor, issues);
    validateLibraryProviders(projectRoot, descriptor, issues);
    validateConfigGenerated(projectRoot, descriptor, issues);
  }
  for (const descriptor of project.contentPacks) {
    validateDescriptor('content-pack', descriptor, known, issues);
    validateBundleMeta(projectRoot, 'content-pack', descriptor, issues);
    if (!known.modules.has(descriptor.owner)) {
      issues.push(`content-pack:${descriptor.id} owner module '${descriptor.owner}' does not exist.`);
    }
  }

  runValidatorRules([
    { name: 'generated-integrity', run: () => validateGenerated(projectRoot, issues) },
    { name: 'forbidden-imports', run: () => validateForbiddenImports(projectRoot, issues) },
    { name: 'runtime-template-imports', run: () => validateRuntimeTemplateImports(projectRoot, issues) },
  ]);
  if (options.strict) {
    runValidatorRules([
      { name: 'case-conflicts', run: () => validateCaseConflicts(projectRoot, issues) },
      { name: 'toolchain', run: () => validateToolchainResolver(projectRoot, issues) },
      { name: 'path-maps', run: () => validatePathMaps(projectRoot, issues) },
      { name: 'cocos-assembly', run: () => validateCocosAssemblyResolution(projectRoot, issues) },
      { name: 'runtime-bundle-boundary', run: () => validateRuntimeBundleBoundary(projectRoot, issues) },
      { name: 'app-state-machine', run: () => validateAppStateMachine(projectRoot, issues) },
      { name: 'extension-transactions', run: () => validateExtensionTransactions(projectRoot, issues) },
      { name: 'main-scene', run: () => validateMainScene(projectRoot, issues) },
      { name: 'ui-generated-refs', run: () => validateUiGeneratedRefs(projectRoot, project, issues) },
      { name: 'ui-mask-boundary', run: () => validateSystemUiMasksNotInBusinessPrefabs(projectRoot, project, issues) },
      { name: 'content-pack-manifest', run: () => validateContentPackManifest(projectRoot, project, issues) },
      { name: 'prefab-script-sources', run: () => validatePrefabScriptSources(projectRoot, project, issues) },
      { name: 'content-pack-ui-boundary', run: () => validateContentPackDoesNotProvideUiViews(projectRoot, project, issues) },
      { name: 'view-result-targets', run: () => validateOpenForResultTargets(projectRoot, project, issues) },
      { name: 'entry-consistency', run: () => validateRefEntryConsistency(projectRoot, project, issues) },
      { name: 'entry-imports', run: () => validateEntryImports(projectRoot, project, issues) },
      { name: 'library-cycles', run: () => validateLibraryCycles(project, issues) },
      { name: 'scope-import-boundaries', run: () => validateImportBoundaries(projectRoot, project, issues) },
      { name: 'app-facade', run: () => validateAppFacadeAccess(projectRoot, issues) },
      { name: 'strict-code', run: () => validateStrictCodeRules(projectRoot, issues) },
    ]);
  }

  return {
    ok: issues.length === 0,
    strict: Boolean(options.strict),
    modules: project.modules.length,
    libraries: project.libraries.length,
    contentPacks: project.contentPacks.length,
    issues,
    issueDetails: issues.details,
  };
}

module.exports = {
  validate,
};
