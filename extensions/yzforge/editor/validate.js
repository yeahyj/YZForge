'use strict';

const fs = require('fs');
const path = require('path');
const { isPascalCase, kebabCase, verifyGeneratedHash, walk } = require('./fs-utils');
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
