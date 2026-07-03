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
  for (const descriptor of project.modules) {
    const codeDir = path.join(descriptor.dir, 'code');
    for (const prefabPath of scanPrefabs(path.join(descriptor.dir, 'res', 'view'))) {
      const name = path.basename(prefabPath, '.prefab');
      const scriptPath = path.join(codeDir, 'view', `${name}.ts`);
      const refsPath = path.join(codeDir, 'view', 'refs', `${name}.refs.generated.ts`);
      if (!fs.existsSync(scriptPath)) {
        issues.push(`${toPosix(path.relative(projectRoot, prefabPath))} missing View script: ${toPosix(path.relative(projectRoot, scriptPath))}.`);
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
