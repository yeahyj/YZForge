'use strict';

const fs = require('fs');
const path = require('path');
const { generatedText, isPascalCase, kebabCase, writeJsonIfChanged, writeTextIfChanged } = require('./fs-utils');
const { renderAutoRefsBase } = require('./generate');

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

function writeEmptyAutoRefs(projectRoot, relativePath, source, baseType, className, changed) {
  if (writeNewText(projectRoot, relativePath, generatedText(source, renderAutoRefsBase(baseType, className, [])))) {
    changed.push(relativePath);
  }
}

function eventFileNames(projectRoot, root) {
  const eventsDir = path.join(projectRoot, root, 'code', 'events');
  if (!fs.existsSync(eventsDir)) {
    return [];
  }
  return fs.readdirSync(eventsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts')
    .map((entry) => path.basename(entry.name, '.ts'))
    .sort((a, b) => a.localeCompare(b));
}

function renderEventIndex(owner, eventNames) {
  const lines = [];
  for (const name of eventNames) {
    lines.push(`import type { ${name}Events } from './${name}';`);
  }
  if (eventNames.length > 0) {
    lines.push('');
    for (const name of eventNames) {
      lines.push(`export { ${name} } from './${name}';`);
      lines.push(`export type { ${name}Events, ${name}Payload } from './${name}';`);
    }
    lines.push('');
  }
  const extensions = eventNames.length > 0 ? ` extends ${eventNames.map((name) => `${name}Events`).join(', ')}` : '';
  lines.push(`export interface ${owner}Events${extensions} {}`);
  lines.push('');
  return lines.join('\n');
}

function writeEventIndex(projectRoot, root, owner, changed) {
  const relativePath = `${root}/code/events/index.ts`;
  if (writeTextIfChanged(path.join(projectRoot, relativePath), renderEventIndex(owner, eventFileNames(projectRoot, root)))) {
    changed.push(relativePath);
  }
}

function createModule(projectRoot, name) {
  assertPascalName(name, 'Module');
  const root = `assets/modules/${name}`;
  ensureDir(path.join(projectRoot, root, 'code'));
  ensureDir(path.join(projectRoot, root, 'code/generated'));
  ensureDir(path.join(projectRoot, root, 'code/events'));
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
    $schema: '../../../schemas/yzforge.scope.schema.json',
    schemaVersion: 2,
    kind: 'module',
    name,
    bundle: `yzforge-module-${kebabCase(name)}`,
    entry: 'code/generated/entry.ts',
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
    "import { Module } from 'yzforge';",
    `import type { ${name}EnterParams } from './public';`,
    '',
    `export class ${name}Module extends Module<${name}EnterParams> {`,
    `    protected onEnter(params?: ${name}EnterParams): void {`,
    `        this.logger.info('${name} module entered.', params);`,
    '    }',
    '}',
    '',
  ].join('\n'));
  writeEventIndex(projectRoot, root, name, changed);
  return { kind: 'module', name, changed };
}

function createLibrary(projectRoot, name) {
  assertPascalName(name, 'Library');
  const root = `assets/libraries/${name}`;
  ensureDir(path.join(projectRoot, root, 'code'));
  ensureDir(path.join(projectRoot, root, 'code/generated'));
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
    $schema: '../../../schemas/yzforge.scope.schema.json',
    schemaVersion: 2,
    kind: 'library',
    name,
    bundle: `yzforge-lib-${kebabCase(name)}`,
    entry: 'code/generated/entry.ts',
    public: 'code/public.ts',
    libraries: [],
  });
  write(`${root}/code/public.ts`, [
    `export interface ${name}TokenMap {}`,
    '',
  ].join('\n'));
  write(`${root}/code/providers.ts`, [
    "import { defineLibraryProviders } from 'yzforge';",
    `import type { ${name}TokenMap } from './public';`,
    '',
    `export const providers = defineLibraryProviders<${name}TokenMap>({`,
    '});',
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
    $schema: '../../../../schemas/yzforge.scope.schema.json',
    schemaVersion: 2,
    kind: 'content-pack',
    id: `${kebabCase(owner)}.${kebabCase(name)}`,
    owner,
    name,
    bundle: `yzforge-content-pack-${kebabCase(owner)}-${kebabCase(name)}`,
    libraries: [],
    presentationRequests: [],
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

function createView(projectRoot, owner, name, viewKind) {
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
  writeEmptyAutoRefs(
    projectRoot,
    `${root}/code/view/refs/${name}.refs.generated.ts`,
    `${root}/res/view/${name}.prefab`,
    'View',
    `${name}Refs`,
    changed,
  );

  return {
    kind: 'view',
    owner,
    name,
    viewKind,
    prefab: `${root}/res/view/${name}.prefab`,
    changed,
  };
}

function createGlobalView(projectRoot, name, viewKind) {
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
  writeEmptyAutoRefs(
    projectRoot,
    `${root}/code/view/refs/${name}.refs.generated.ts`,
    `${root}/res/view/${name}.prefab`,
    'View',
    `${name}Refs`,
    changed,
  );

  return {
    kind: 'global-view',
    name,
    viewKind,
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
  writeEmptyAutoRefs(
    projectRoot,
    `${root}/code/part/refs/${name}.refs.generated.ts`,
    `${root}/res/part/${name}.prefab`,
    'Part',
    `${name}Refs`,
    changed,
  );

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
    `import { ${baseType} } from 'yzforge';`,
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
  writeEventIndex(projectRoot, root, owner, changed);

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
    "import { defineExtensionToken, type Extension, type ExtensionContext } from 'yzforge';",
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
    '    installBeforeStart(context: ExtensionContext): void {',
    `        context.provide(${name}Token, new ${name}ApiImpl());`,
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
    return createView(projectRoot, args.owner, args.name, args.viewKind);
  }
  if (kind === 'global-view') {
    return createGlobalView(projectRoot, args.name, args.viewKind);
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
