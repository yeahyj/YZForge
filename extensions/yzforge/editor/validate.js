'use strict';

const fs = require('fs');
const path = require('path');
const { isPascalCase, kebabCase, toPosix, verifyGeneratedHash, walk } = require('./fs-utils');
const { scanProject } = require('./scanner');

function expectedBundle(kind, descriptor) {
  if (kind === 'module') {
    return `yzforge-module-${kebabCase(descriptor.name)}`;
  }
  if (kind === 'library') {
    return `yzforge-lib-${kebabCase(descriptor.name)}`;
  }
  return `yzforge-content-pack-${kebabCase(descriptor.owner)}-${kebabCase(descriptor.name)}`;
}

function validateDescriptor(kind, descriptor, known, issues) {
  const label = `${kind}:${descriptor.name || descriptor.id}`;
  if (descriptor.schemaVersion !== 1) {
    issues.push(`${label} schemaVersion must be 1.`);
  }
  if (descriptor.kind !== kind) {
    issues.push(`${label} kind must be '${kind}'.`);
  }
  if (!isPascalCase(descriptor.name)) {
    issues.push(`${label} name must be PascalCase.`);
  }
  const expected = expectedBundle(kind, descriptor);
  if (descriptor.bundle !== expected) {
    issues.push(`${label} bundle must be '${expected}', got '${descriptor.bundle}'.`);
  }
  for (const library of descriptor.libraries || []) {
    if (!known.libraries.has(library)) {
      issues.push(`${label} declares missing library '${library}'.`);
    }
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

function validateGenerated(projectRoot, issues) {
  const generatedFiles = walk(projectRoot, (filePath) => /\.generated\.(ts|json)$/.test(filePath));
  for (const filePath of generatedFiles) {
    if (!filePath.endsWith('.ts')) {
      continue;
    }
    const result = verifyGeneratedHash(fs.readFileSync(filePath, 'utf8'));
    if (!result.ok) {
      issues.push(`${path.relative(projectRoot, filePath)} generated hash mismatch (${result.reason || `${result.actual} != ${result.expected}`}).`);
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
    const importLines = content.match(/^import\s+.*$/gm) || [];
    const moduleMatch = rel.match(/^assets\/modules\/([^/]+)\//);
    const libraryMatch = rel.match(/^assets\/libraries\/([^/]+)\//);
    if (/assetManager\.loadBundle|resources\.load/.test(content)) {
      issues.push(`${rel} uses forbidden dynamic resource loading API.`);
    }
    for (const line of importLines) {
      const target = (line.match(/from\s+['"]([^'"]+)['"]/) || [])[1] || '';
      if (moduleMatch && target.includes('/modules/') && !target.includes(`/modules/${moduleMatch[1]}/`)) {
        issues.push(`${rel} imports another module internal path: ${target}`);
      }
      if (moduleMatch && target.includes('/libraries/') && !target.includes('/registry/libraries/') && !target.startsWith('yzforge/libraries/')) {
        issues.push(`${rel} imports library internal path: ${target}`);
      }
      if (libraryMatch && target.includes('/modules/')) {
        issues.push(`${rel} imports module internal path: ${target}`);
      }
    }
  }
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

function validateMainScene(projectRoot, issues) {
  const scenePath = path.join(projectRoot, 'assets', 'app', 'main', 'Main.scene');
  const scriptPath = path.join(projectRoot, 'assets', 'app', 'main', 'Main.ts');
  if (!fs.existsSync(scenePath)) {
    issues.push('Main scene is missing: assets/app/main/Main.scene.');
    return;
  }
  if (!fs.existsSync(scriptPath)) {
    issues.push('Main component is missing: assets/app/main/Main.ts.');
  }
  const content = fs.readFileSync(scenePath, 'utf8');
  for (const name of ['MainRoot', 'Canvas', 'UIRoot', 'PageLayer', 'PaperLayer', 'PopupLayer', 'ToastLayer', 'TopLayer', 'SystemLayer']) {
    if (!content.includes(`"_name": "${name}"`)) {
      issues.push(`Main scene missing node: ${name}.`);
    }
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

function parseAutoRefMarker(name) {
  const match = /^@([A-Za-z_$][\w$]*)(?::([A-Za-z_$][\w$.]*))?$/.exec(String(name || ''));
  if (!match) {
    return undefined;
  }
  const component = match[2] ? match[2].replace(/^cc\./, '') : undefined;
  return {
    key: match[1],
    component,
  };
}

function validateAutoRefMarkers(prefabPath, issues) {
  let records;
  try {
    const data = JSON.parse(fs.readFileSync(prefabPath, 'utf8'));
    records = Array.isArray(data) ? data : [data];
  } catch (error) {
    issues.push(`${toPosix(prefabPath)} prefab JSON cannot be parsed: ${error.message}.`);
    return;
  }

  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record._name !== 'string') {
      continue;
    }
    const marker = parseAutoRefMarker(record._name);
    if (!marker) {
      continue;
    }
    if (seen.has(marker.key)) {
      issues.push(`${toPosix(prefabPath)} has duplicate AutoRef marker: @${marker.key}.`);
    }
    seen.add(marker.key);
    if (marker.component && !AUTO_REF_COMPONENTS.has(marker.component)) {
      issues.push(`${toPosix(prefabPath)} has unsupported AutoRef component marker: ${record._name}.`);
    }
  }
}

function scanPrefabs(root) {
  return walk(root, (filePath) => filePath.endsWith('.prefab') && !filePath.endsWith('.prefab.meta'))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

function validateUiGeneratedRefs(projectRoot, project, issues) {
  const descriptors = project.global ? [project.global, ...project.modules] : project.modules;
  for (const descriptor of descriptors) {
    const codeDir = path.join(descriptor.dir, 'code');
    for (const prefabPath of scanPrefabs(path.join(descriptor.dir, 'res', 'view'))) {
      const name = path.basename(prefabPath, '.prefab');
      const scriptPath = path.join(codeDir, 'view', `${name}.ts`);
      const refsPath = path.join(codeDir, 'view', 'refs', `${name}.refs.generated.ts`);
      if (!fs.existsSync(scriptPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing View script: ${toPosix(path.relative(projectRoot, scriptPath))}.`);
      } else {
        validatePrefabContainsScript(projectRoot, prefabPath, scriptPath, 'View', issues);
      }
      if (!fs.existsSync(refsPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing generated AutoRefs: ${toPosix(path.relative(projectRoot, refsPath))}.`);
      }
      validateAutoRefMarkers(prefabPath, issues);
    }
    for (const prefabPath of scanPrefabs(path.join(descriptor.dir, 'res', 'part'))) {
      const name = path.basename(prefabPath, '.prefab');
      const scriptPath = path.join(codeDir, 'part', `${name}.ts`);
      const refsPath = path.join(codeDir, 'part', 'refs', `${name}.refs.generated.ts`);
      if (!fs.existsSync(scriptPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing Part script: ${toPosix(path.relative(projectRoot, scriptPath))}.`);
      } else {
        validatePrefabContainsScript(projectRoot, prefabPath, scriptPath, 'Part', issues);
      }
      if (!fs.existsSync(refsPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing generated AutoRefs: ${toPosix(path.relative(projectRoot, refsPath))}.`);
      }
      validateAutoRefMarkers(prefabPath, issues);
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

function scanContentPackRefs(pack, projectRoot, issues) {
  const files = [
    ...scanFiles(path.join(pack.dir, 'res', 'prefab'), '.prefab'),
    ...scanFiles(path.join(pack.dir, 'res', 'scene'), '.scene'),
    ...scanRuntimeFiles(path.join(pack.dir, 'res', 'runtime')),
  ].sort((a, b) => toPosix(a).localeCompare(toPosix(b)));

  const refs = {};
  for (const filePath of files) {
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
  return refs;
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

    const expected = {
      schemaVersion: 1,
      id: pack.id,
      owner: pack.owner,
      bundle: pack.bundle || expectedBundle('content-pack', pack),
      refs: scanContentPackRefs(pack, projectRoot, issues),
    };
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
      issues.push(`${rel} is stale. Run YZForge Generate All.`);
    }
  }
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

function stripCodeComments(content) {
  return String(content || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractImportSpecifiers(content) {
  const source = stripCodeComments(content);
  const specs = [];
  const staticPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = staticPattern.exec(source)) !== null) {
    specs.push(match[1]);
  }
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicPattern.exec(source)) !== null) {
    specs.push(match[1]);
  }
  return specs;
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
    return 'assets/yzforge/runtime/index.ts';
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
  if (specifier.startsWith('yzforge-contracts/modules/')) {
    const name = specifier.slice('yzforge-contracts/modules/'.length).split('/')[0];
    return `assets/app/contracts/modules/${name}.contract.generated.ts`;
  }
  if (specifier.startsWith('yzforge-contracts/libraries/')) {
    const name = specifier.slice('yzforge-contracts/libraries/'.length).split('/')[0];
    return `assets/app/contracts/libraries/${name}.contract.generated.ts`;
  }
  if (specifier.startsWith('yzforge-contracts/content-packs/')) {
    const name = specifier.slice('yzforge-contracts/content-packs/'.length).split('/')[0];
    return `assets/app/contracts/content-packs/${name}.contract.generated.ts`;
  }
  if (specifier.startsWith('yzforge-shared/')) {
    return toPosix(path.relative(projectRoot, resolveExistingImportTarget(path.join(projectRoot, 'assets', 'shared', 'code', specifier.slice('yzforge-shared/'.length)))));
  }
  if (specifier.startsWith('yzforge/')) {
    return toPosix(path.relative(projectRoot, resolveExistingImportTarget(path.join(projectRoot, 'assets', 'yzforge', 'runtime', specifier.slice('yzforge/'.length)))));
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
  const generated = targetRel.match(/^assets\/modules\/([^/]+)\/code\/content-packs\.generated\.ts$/);
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
      path.join(descriptor.dir, descriptor.entry || 'code/entry.generated.ts'),
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
      path.join(descriptor.dir, descriptor.entry || 'code/entry.generated.ts'),
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
    || targetRel.startsWith('assets/app/registry/')
    || targetRel.startsWith('assets/app/contracts/')
    || targetRel.startsWith('assets/shared/');
}

function validateEntryImports(projectRoot, project, issues) {
  const descriptors = project.modules.map((descriptor) => ({ kind: 'module', descriptor }))
    .concat(project.libraries.map((descriptor) => ({ kind: 'library', descriptor })));
  for (const { kind, descriptor } of descriptors) {
    const filePath = path.join(descriptor.dir, descriptor.entry || 'code/entry.generated.ts');
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const rel = toPosix(path.relative(projectRoot, filePath));
    for (const specifier of extractImportSpecifiers(fs.readFileSync(filePath, 'utf8'))) {
      const targetRel = resolveImportTarget(projectRoot, filePath, specifier);
      if (!targetRel || !isEntryImportAllowed(projectRoot, descriptor, targetRel)) {
        issues.push(`${rel} imports unsupported ${kind} entry dependency: ${specifier}.`);
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

    for (const specifier of extractImportSpecifiers(fs.readFileSync(filePath, 'utf8'))) {
      const targetRel = resolveImportTarget(projectRoot, filePath, specifier);
      if (!targetRel) {
        continue;
      }

      const targetScope = codeScopeFromPath(targetRel);
      const usedLibrary = libraryFromRegistryOrContractTarget(targetRel);
      if ((scope.kind === 'module' || scope.kind === 'library') && usedLibrary && usedLibrary !== scope.name && !declaredLibraries.has(usedLibrary)) {
        issues.push(`${rel} imports undeclared library '${usedLibrary}'. Add it to ${scope.name} ${scope.kind}.json libraries.`);
      }

      const packOwner = contentPackOwnerFromTarget(targetRel, specifier);
      if (packOwner) {
        if (scope.kind === 'module' && packOwner !== scope.name) {
          issues.push(`${rel} accesses non-owner ContentPack for '${packOwner}'. Only owner module '${packOwner}' may import it.`);
        } else if (scope.kind !== 'module' && scope.kind !== 'contract') {
          issues.push(`${rel} must not access ContentPack owned by '${packOwner}'.`);
        }
      }

      if (scope.kind === 'module') {
        if (targetScope?.kind === 'module' && targetScope.name !== scope.name && !moduleFromRegistryTarget(targetRel)) {
          issues.push(`${rel} imports another module internal path: ${specifier}`);
        }
        if (targetScope?.kind === 'library') {
          issues.push(`${rel} imports library internal path: ${specifier}`);
        }
      } else if (scope.kind === 'library') {
        if (targetScope?.kind === 'module') {
          issues.push(`${rel} imports module internal path: ${specifier}`);
        }
        if (targetScope?.kind === 'library' && targetScope.name !== scope.name) {
          issues.push(`${rel} imports another library internal path: ${specifier}`);
        }
      } else if (scope.kind === 'shared') {
        if (targetScope && ['global', 'module', 'library'].includes(targetScope.kind)) {
          issues.push(`${rel} shared code must not import ${targetScope.kind} scope: ${specifier}`);
        }
      } else if (scope.kind === 'global') {
        if (targetScope && ['module', 'library'].includes(targetScope.kind)) {
          issues.push(`${rel} global code must not import ${targetScope.kind} internal path: ${specifier}`);
        }
      } else if (scope.kind === 'contract') {
        if (targetScope && ['module', 'library', 'global'].includes(targetScope.kind)) {
          issues.push(`${rel} registry/contract must not import runtime scope path: ${specifier}`);
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

    if (/\/res\//.test(rel)) {
      issues.push(`${rel} must not place TypeScript source under res/.`);
    }
    if (/^assets\/content-packs\//.test(rel)) {
      issues.push(`${rel} content packs must not contain TypeScript source.`);
    }
    if (/\/code\/model\//.test(rel) && /from\s+['"]cc['"]/.test(withoutComments)) {
      issues.push(`${rel} model must not import cc.`);
    }
    if (/\/code\/service\//.test(rel) && /\bthis\.module\.ui\.(open|openForResult|close|closeLayer|back)\s*\(/.test(withoutComments)) {
      issues.push(`${rel} service must not directly operate UI; move UI orchestration to Flow.`);
    }
    if (/\/code\/service\//.test(rel) && /^\s*(?:private|protected|public)\s+[\w$]+\??\s*:\s*[^;\n]*(?:Node|Component)\b/m.test(withoutComments)) {
      issues.push(`${rel} service must not keep long-lived Node or Component fields.`);
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
  const project = scanProject(projectRoot);
  const issues = [];
  const known = {
    modules: new Set(project.modules.map((item) => item.name)),
    libraries: new Set(project.libraries.map((item) => item.name)),
  };

  for (const descriptor of project.modules) {
    validateDescriptor('module', descriptor, known, issues);
    validateBundleMeta(projectRoot, 'module', descriptor, issues);
    validatePublicContract(projectRoot, descriptor, issues);
  }
  for (const descriptor of project.libraries) {
    validateDescriptor('library', descriptor, known, issues);
    validateBundleMeta(projectRoot, 'library', descriptor, issues);
    validatePublicContract(projectRoot, descriptor, issues);
  }
  for (const descriptor of project.contentPacks) {
    validateDescriptor('content-pack', descriptor, known, issues);
    validateBundleMeta(projectRoot, 'content-pack', descriptor, issues);
    if (!known.modules.has(descriptor.owner)) {
      issues.push(`content-pack:${descriptor.id} owner module '${descriptor.owner}' does not exist.`);
    }
  }

  validateGenerated(projectRoot, issues);
  validateForbiddenImports(projectRoot, issues);
  if (options.strict) {
    validateCaseConflicts(projectRoot, issues);
    validateMainScene(projectRoot, issues);
    validateUiGeneratedRefs(projectRoot, project, issues);
    validateContentPackManifest(projectRoot, project, issues);
    validatePrefabScriptSources(projectRoot, project, issues);
    validateRefEntryConsistency(projectRoot, project, issues);
    validateEntryImports(projectRoot, project, issues);
    validateLibraryCycles(project, issues);
    validateImportBoundaries(projectRoot, project, issues);
    validateStrictCodeRules(projectRoot, issues);
  }

  return {
    ok: issues.length === 0,
    strict: Boolean(options.strict),
    modules: project.modules.length,
    libraries: project.libraries.length,
    contentPacks: project.contentPacks.length,
    issues,
  };
}

module.exports = {
  validate,
};
