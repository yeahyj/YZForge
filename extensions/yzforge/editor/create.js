'use strict';

const fs = require('fs');
const path = require('path');
const { isPascalCase, kebabCase, writeJsonIfChanged, writeTextIfChanged } = require('./fs-utils');

function assertPascalName(name, label) {
  if (!isPascalCase(name)) {
    throw new Error(`${label} name must be PascalCase: ${name}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeNewText(projectRoot, relativePath, content) {
  const filePath = path.join(projectRoot, relativePath);
  if (fs.existsSync(filePath)) {
    return false;
  }
  return writeTextIfChanged(filePath, content);
}

function writeNewJson(projectRoot, relativePath, value) {
  const filePath = path.join(projectRoot, relativePath);
  if (fs.existsSync(filePath)) {
    return false;
  }
  return writeJsonIfChanged(filePath, value);
}

function createModule(projectRoot, name) {
  assertPascalName(name, 'Module');
  const root = `assets/modules/${name}`;
  ensureDir(path.join(projectRoot, root, 'code'));
  ensureDir(path.join(projectRoot, root, 'res/view'));
  ensureDir(path.join(projectRoot, root, 'res/part'));
  ensureDir(path.join(projectRoot, root, 'res/runtime'));
  ensureDir(path.join(projectRoot, root, 'res/content'));
  ensureDir(path.join(projectRoot, root, 'res/sound'));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };
  const writeJson = (relative, value) => {
    if (writeNewJson(projectRoot, relative, value)) changed.push(relative);
  };

  writeJson(`${root}/module.json`, {
    schemaVersion: 1,
    kind: 'module',
    name,
    bundle: `yzforge-module-${kebabCase(name)}`,
    entry: 'code/entry.generated.ts',
    public: 'code/public.ts',
    enterParams: `${name}EnterParams`,
    libraries: [],
  });
  write(`${root}/code/public.ts`, [
    `export interface ${name}EnterParams {`,
    '    readonly from?: string;',
    '}',
    '',
  ].join('\n'));
  write(`${root}/code/${name}Module.ts`, [
    "import { Module } from '../../../yzforge/runtime';",
    `import type { ${name}EnterParams } from './public';`,
    '',
    `export class ${name}Module extends Module<${name}EnterParams> {`,
    `    protected onEnter(params?: ${name}EnterParams): void {`,
    `        this.logger.info('${name} module entered.', params);`,
    '    }',
    '}',
    '',
  ].join('\n'));
  write(`${root}/code/events.ts`, `export interface ${name}Events {}\n`);
  return { kind: 'module', name, changed };
}

function createLibrary(projectRoot, name) {
  assertPascalName(name, 'Library');
  const root = `assets/libraries/${name}`;
  ensureDir(path.join(projectRoot, root, 'code'));
  ensureDir(path.join(projectRoot, root, 'res/prefab'));
  ensureDir(path.join(projectRoot, root, 'res/runtime'));
  ensureDir(path.join(projectRoot, root, 'res/content'));
  ensureDir(path.join(projectRoot, root, 'res/sound'));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };
  const writeJson = (relative, value) => {
    if (writeNewJson(projectRoot, relative, value)) changed.push(relative);
  };

  writeJson(`${root}/library.json`, {
    schemaVersion: 1,
    kind: 'library',
    name,
    bundle: `yzforge-lib-${kebabCase(name)}`,
    entry: 'code/entry.generated.ts',
    public: 'code/public.ts',
    libraries: [],
  });
  write(`${root}/code/public.ts`, [
    `export interface ${name}TokenMap {}`,
    '',
  ].join('\n'));
  return { kind: 'library', name, changed };
}

function createContentPack(projectRoot, owner, name) {
  assertPascalName(owner, 'ContentPack owner');
  assertPascalName(name, 'ContentPack');
  const ownerModule = path.join(projectRoot, 'assets', 'modules', owner, 'module.json');
  if (!fs.existsSync(ownerModule)) {
    throw new Error(`Owner module does not exist: ${owner}`);
  }

  const root = `assets/content-packs/${owner}/${name}`;
  ensureDir(path.join(projectRoot, root, 'res/prefab'));
  ensureDir(path.join(projectRoot, root, 'res/scene'));
  ensureDir(path.join(projectRoot, root, 'res/runtime'));
  ensureDir(path.join(projectRoot, root, 'res/content'));

  const changed = [];
  const writeJson = (relative, value) => {
    if (writeNewJson(projectRoot, relative, value)) changed.push(relative);
  };

  writeJson(`${root}/content-pack.json`, {
    schemaVersion: 1,
    kind: 'content-pack',
    id: `${kebabCase(owner)}.${kebabCase(name)}`,
    owner,
    name,
    bundle: `yzforge-content-pack-${kebabCase(owner)}-${kebabCase(name)}`,
    libraries: [],
  });
  return { kind: 'content-pack', owner, name, changed };
}

function create(projectRoot, kind, args) {
  if (kind === 'module') {
    return createModule(projectRoot, args.name);
  }
  if (kind === 'library') {
    return createLibrary(projectRoot, args.name);
  }
  if (kind === 'content-pack') {
    return createContentPack(projectRoot, args.owner, args.name);
  }
  throw new Error(`Unknown create kind: ${kind}`);
}

module.exports = {
  create,
  createContentPack,
  createLibrary,
  createModule,
};
