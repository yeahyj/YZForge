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

function requireModule(projectRoot, owner) {
  assertPascalName(owner, 'Module owner');
  const ownerModule = path.join(projectRoot, 'assets', 'modules', owner, 'module.json');
  if (!fs.existsSync(ownerModule)) {
    throw new Error(`Owner module does not exist: ${owner}`);
  }
}

function createView(projectRoot, owner, name) {
  requireModule(projectRoot, owner);
  assertPascalName(name, 'View');
  const root = `assets/modules/${owner}`;
  ensureDir(path.join(projectRoot, root, 'code/view'));
  ensureDir(path.join(projectRoot, root, 'res/view'));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };

  write(`${root}/code/view/${name}.ts`, [
    "import { _decorator } from 'cc';",
    `import { ${name}Refs } from './refs/${name}.refs.generated';`,
    '',
    'const { ccclass } = _decorator;',
    '',
    `@ccclass('${name}')`,
    `export class ${name} extends ${name}Refs<void, void> {`,
    '    protected onOpen(): void {',
    `        this.module.logger.info('${name} opened.');`,
    '    }',
    '}',
    '',
  ].join('\n'));

  return {
    kind: 'view',
    owner,
    name,
    prefab: `${root}/res/view/${name}.prefab`,
    changed,
  };
}

function createGlobalView(projectRoot, name) {
  assertPascalName(name, 'Global View');
  const root = 'assets/app/global';
  ensureDir(path.join(projectRoot, root, 'code/view'));
  ensureDir(path.join(projectRoot, root, 'res/view'));
  ensureDir(path.join(projectRoot, root, 'res/part'));
  ensureDir(path.join(projectRoot, root, 'res/runtime'));
  ensureDir(path.join(projectRoot, root, 'res/content'));
  ensureDir(path.join(projectRoot, root, 'res/sound'));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };

  write(`${root}/code/view/${name}.ts`, [
    "import { _decorator } from 'cc';",
    `import { ${name}Refs } from './refs/${name}.refs.generated';`,
    '',
    'const { ccclass } = _decorator;',
    '',
    `@ccclass('${name}')`,
    `export class ${name} extends ${name}Refs<void, void> {`,
    '    protected onOpen(): void {}',
    '}',
    '',
  ].join('\n'));

  return {
    kind: 'global-view',
    name,
    prefab: `${root}/res/view/${name}.prefab`,
    changed,
  };
}

function createPart(projectRoot, owner, name) {
  requireModule(projectRoot, owner);
  assertPascalName(name, 'Part');
  const root = `assets/modules/${owner}`;
  ensureDir(path.join(projectRoot, root, 'code/part'));
  ensureDir(path.join(projectRoot, root, 'res/part'));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };

  write(`${root}/code/part/${name}.ts`, [
    "import { _decorator } from 'cc';",
    `import { ${name}Refs } from './refs/${name}.refs.generated';`,
    '',
    'const { ccclass } = _decorator;',
    '',
    `@ccclass('${name}')`,
    `export class ${name} extends ${name}Refs<void> {}`,
    '',
  ].join('\n'));

  return {
    kind: 'part',
    owner,
    name,
    prefab: `${root}/res/part/${name}.prefab`,
    changed,
  };
}

function createModuleUnit(projectRoot, owner, name, folder, baseType, bodyLines) {
  requireModule(projectRoot, owner);
  assertPascalName(name, baseType);
  const root = `assets/modules/${owner}`;
  ensureDir(path.join(projectRoot, root, 'code', folder));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };

  write(`${root}/code/${folder}/${name}.ts`, [
    `import { ${baseType} } from '../../../../yzforge/runtime';`,
    '',
    `export class ${name} extends ${baseType} {`,
    ...bodyLines,
    '}',
    '',
  ].join('\n'));

  return {
    kind: folder,
    owner,
    name,
    changed,
  };
}

function createModel(projectRoot, owner, name) {
  return createModuleUnit(projectRoot, owner, name, 'model', 'Model', []);
}

function createService(projectRoot, owner, name) {
  return createModuleUnit(projectRoot, owner, name, 'service', 'Service', [
    '    public onCreate(): void {',
    `        this.module.logger.info('${name} created.');`,
    '    }',
  ]);
}

function createFlow(projectRoot, owner, name) {
  return createModuleUnit(projectRoot, owner, name, 'flow', 'Flow', [
    '    public async start(): Promise<void> {',
    `        this.module.logger.info('${name} started.');`,
    '    }',
  ]);
}

function createEventFile(projectRoot, owner, name) {
  requireModule(projectRoot, owner);
  assertPascalName(name, 'Event');
  const root = `assets/modules/${owner}`;
  ensureDir(path.join(projectRoot, root, 'code/events'));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };
  const eventId = `${owner}.${name}`;
  write(`${root}/code/events/${name}.ts`, [
    `export const ${name} = '${eventId}' as const;`,
    '',
    `export interface ${name}Payload {`,
    '    readonly value?: unknown;',
    '}',
    '',
    `export interface ${name}Events {`,
    `    readonly [${name}]: ${name}Payload;`,
    '}',
    '',
  ].join('\n'));

  return {
    kind: 'event-file',
    owner,
    name,
    changed,
  };
}

function createExtensionStub(projectRoot, name) {
  assertPascalName(name, 'Extension');
  const root = 'assets/app/extensions';
  ensureDir(path.join(projectRoot, root));

  const changed = [];
  const write = (relative, content) => {
    if (writeNewText(projectRoot, relative, content)) changed.push(relative);
  };

  write(`${root}/${name}.ts`, [
    "import { defineExtensionToken, type Extension, type ExtensionRegistry } from '../../yzforge/runtime';",
    '',
    `export interface ${name}Api {`,
    '    readonly name: string;',
    '}',
    '',
    `export const ${name}Token = defineExtensionToken<${name}Api>('${name}');`,
    '',
    `class ${name}ApiImpl implements ${name}Api {`,
    `    public readonly name = '${name}';`,
    '}',
    '',
    `export const ${name}Extension: Extension = {`,
    `    name: '${name}',`,
    '    install(registry: ExtensionRegistry): void {',
    `        registry.provide(${name}Token, new ${name}ApiImpl());`,
    '    },',
    '};',
    '',
  ].join('\n'));

  return {
    kind: 'extension-stub',
    name,
    changed,
  };
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
  if (kind === 'view') {
    return createView(projectRoot, args.owner, args.name);
  }
  if (kind === 'global-view') {
    return createGlobalView(projectRoot, args.name);
  }
  if (kind === 'part') {
    return createPart(projectRoot, args.owner, args.name);
  }
  if (kind === 'model') {
    return createModel(projectRoot, args.owner, args.name);
  }
  if (kind === 'service') {
    return createService(projectRoot, args.owner, args.name);
  }
  if (kind === 'flow') {
    return createFlow(projectRoot, args.owner, args.name);
  }
  if (kind === 'event-file') {
    return createEventFile(projectRoot, args.owner, args.name);
  }
  if (kind === 'extension-stub') {
    return createExtensionStub(projectRoot, args.name);
  }
  throw new Error(`Unknown create kind: ${kind}`);
}

module.exports = {
  create,
  createContentPack,
  createFlow,
  createEventFile,
  createExtensionStub,
  createGlobalView,
  createLibrary,
  createModel,
  createModule,
  createPart,
  createService,
  createView,
};
