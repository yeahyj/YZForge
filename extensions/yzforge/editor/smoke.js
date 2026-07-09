'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { validateBuildMatrix } = require('./build-matrix');
const { cleanGenerated } = require('./cleanup');
const { buildConfig, configDashboard, deleteConfigPlanTable, saveConfigPlanTable } = require('./config-builder');
const { create } = require('./create');
const { generate } = require('./generate');
const { kebabCase, toPosix } = require('./fs-utils');
const {
  loadTypeScript: loadToolchainTypeScript,
  prepareTypecheckTsconfig,
  readCocosDashboardProfiles,
  resolveCocosEditorRoot,
} = require('./toolchain');
const { validate } = require('./validate');

const UUID_BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const UUID_HEX_CHARS = '0123456789abcdef';
const MAIN_SCRIPT_UUID = '10000000-0000-4000-8000-000000000010';
const SCREEN_FITTER_UUID = '10000000-0000-4000-8000-000000000011';
const FULL_SCREEN_ROOT_UUID = '10000000-0000-4000-8000-000000000012';
const SAFE_AREA_ROOT_UUID = '10000000-0000-4000-8000-000000000013';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectThrows(task, expected) {
  try {
    task();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    assert(message.includes(expected), `Expected error to include '${expected}', got:\n${message}`);
    return error;
  }
  throw new Error(`Expected task to throw: ${expected}`);
}

function loadTypeScript() {
  return loadToolchainTypeScript(path.resolve(__dirname, '..', '..', '..'), { required: true });
}

function writeText(projectRoot, relativePath, content) {
  const filePath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function updateText(projectRoot, relativePath, update) {
  const filePath = path.join(projectRoot, relativePath);
  writeText(projectRoot, relativePath, update(fs.readFileSync(filePath, 'utf8')));
}

function writeJson(projectRoot, relativePath, value) {
  writeText(projectRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeBinary(projectRoot, relativePath, content) {
  const filePath = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xlsxColumnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function xlsxCell(value, rowIndex, columnIndex) {
  const ref = `${xlsxColumnName(columnIndex)}${rowIndex + 1}`;
  if (typeof value === 'number') {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 6);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 8);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function writeXlsx(projectRoot, relativePath, sheetName, rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    if (!row) {
      return '';
    }
    const cells = row.map((value, columnIndex) => xlsxCell(value, rowIndex, columnIndex)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<sheetData>${sheetRows}</sheetData>`,
    '</worksheet>',
  ].join('');
  const workbookXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`,
    '</workbook>',
  ].join('');
  const zip = makeStoredZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ]);
  writeBinary(projectRoot, relativePath, zip);
}

function listRuntimeSourceFiles(sourceRoot, current = '') {
  const directory = path.join(sourceRoot, current);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listRuntimeSourceFiles(sourceRoot, relative));
    } else if (entry.isFile() && relative.endsWith('.ts')) {
      files.push(relative);
    }
  }
  return files;
}

function writeRuntimeFixture(projectRoot) {
  const sourceRoot = path.resolve(__dirname, '..', '..', '..', 'packages', 'yzforge-runtime', 'src');
  const targetRoots = ['packages/yzforge-runtime/src', 'extensions/yzforge/runtime-template', 'assets/yzforge/runtime'];
  for (const relative of listRuntimeSourceFiles(sourceRoot)) {
    const content = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');
    for (const targetRoot of targetRoots) {
      writeText(projectRoot, `${targetRoot}/${relative}`, content);
    }
  }
}

function readJson(projectRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function updateJson(projectRoot, relativePath, update) {
  const value = readJson(projectRoot, relativePath);
  update(value);
  writeJson(projectRoot, relativePath, value);
}

function requireFile(projectRoot, relativePath) {
  assert(fs.existsSync(path.join(projectRoot, relativePath)), `Expected file to exist: ${relativePath}`);
}

function requireText(projectRoot, relativePath, expected) {
  requireFile(projectRoot, relativePath);
  const content = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert(content.includes(expected), `Expected ${relativePath} to include: ${expected}`);
}

function loadRuntimeModule(projectRoot, relativePath, dependencies = {}) {
  const ts = loadTypeScript();
  const sourcePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  });
  const module = { exports: {} };
  const wrapper = new vm.Script(`(function (exports, require, module) {\n${transpiled.outputText}\n})`, {
    filename: relativePath,
  });
  const run = wrapper.runInNewContext({
    console,
    Promise,
    Error,
    Map,
    Set,
    WeakMap,
    Array,
    Math,
    String,
    Object,
  });
  run(module.exports, (specifier) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, specifier)) {
      return dependencies[specifier];
    }
    if (specifier === './types') {
      return {};
    }
    throw new Error(`Unexpected runtime smoke import in ${relativePath}: ${specifier}`);
  }, module);
  return module.exports;
}

async function assertReleaseScopeBehavior() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const errors = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/errors.ts');
  const runtime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/lifetime.ts', {
    './errors': errors,
  });
  const { OwnershipLedger, ReleaseScope } = runtime;
  assert(typeof OwnershipLedger === 'function', 'Expected OwnershipLedger runtime export.');
  assert(typeof ReleaseScope === 'function', 'Expected ReleaseScope runtime export.');

  const ledger = new OwnershipLedger();
  const root = new ReleaseScope('app', 'root', ledger);
  const child = root.child('module', 'Battle');
  const events = [];

  root.defer('root-action', async (reason) => {
    events.push(`root:${reason.type}`);
  });
  child.defer('child-action', async (reason) => {
    events.push(`child:${reason.type}`);
  });
  ledger.acquire(root, 'bundle', 'main', { path: 'assets/main' }, 2);
  ledger.acquire(child, 'asset', 'page', { path: 'assets/modules/Battle/res/view/PageBattle.prefab' });

  const beforeRelease = ledger.snapshot();
  assert(beforeRelease.scopes.length === 2, 'OwnershipLedger must snapshot registered scopes.');
  assert(beforeRelease.holdings.length === 2, 'OwnershipLedger must snapshot active holdings.');
  assert(beforeRelease.holdings.some((item) => item.ownerKey === 'app:root' && item.kind === 'bundle' && item.count === 2), 'OwnershipLedger must track root holdings.');
  assert(beforeRelease.holdings.some((item) => item.ownerKey === 'app:root/module:Battle' && item.kind === 'asset' && item.count === 1), 'OwnershipLedger must track child holdings.');

  await root.release({ type: 'test_release' });
  assert(events.join('|') === 'child:test_release|root:test_release', 'ReleaseScope must release children before parent actions.');
  assert(
    ledger.snapshot().scopes.every((scope) => !scope.lastFailure),
    'OwnershipLedger scopes must not report release failures after a clean release.',
  );

  await root.release({ type: 'repeat_release' });
  assert(events.join('|') === 'child:test_release|root:test_release', 'ReleaseScope.release must be idempotent.');

  const afterScopeRelease = ledger.snapshot();
  assert(afterScopeRelease.scopes.every((scope) => scope.released === true), 'OwnershipLedger must mark released scopes.');
  assert(afterScopeRelease.holdings.length === 2, 'OwnershipLedger must not execute resource release actions.');
  assert(afterScopeRelease.leaks.length === 2, 'OwnershipLedger must expose holdings owned by released scopes as leaks.');

  ledger.release(root, 'bundle', 'main');
  assert(ledger.snapshot().holdings.some((item) => item.ownerKey === 'app:root' && item.kind === 'bundle' && item.count === 1), 'OwnershipLedger partial release must decrement count.');
  ledger.release(root, 'bundle', 'main');
  ledger.release(child, 'asset', 'page');
  assert(ledger.snapshot().holdings.length === 0, 'OwnershipLedger release should only update ledger records.');

  const rootSnapshot = root.snapshot();
  assert(rootSnapshot.released === true, 'ReleaseScope snapshot must expose released state.');
  assert(rootSnapshot.releasing === false, 'ReleaseScope snapshot must clear releasing state.');
  assert(rootSnapshot.actionCount === 0, 'ReleaseScope snapshot must clear released actions.');
  assert(rootSnapshot.children.length === 0, 'ReleaseScope release must clear child scopes.');
}

async function assertAssetReleasePolicyBehavior() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const errors = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/errors.ts');
  const lifetime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/lifetime.ts', {
    './errors': errors,
  });
  class Asset {}
  class Prefab extends Asset {}
  class Node {
    constructor(name = 'Node') {
      this.name = name;
      this.active = true;
    }

    addChild() {}
    destroy() {}
  }
  const cc = {
    Asset,
    Prefab,
    Node,
    instantiate() {
      return new Node('Instance');
    },
    isValid() {
      return true;
    },
  };
  const assetsRuntime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/assets.ts', {
    cc,
    './bundle-manager': {},
    './errors': errors,
    './lifetime': lifetime,
  });
  const { AssetScope } = assetsRuntime;
  const { OwnershipLedger, ReleaseScope } = lifetime;
  const releaseEvents = [];
  const ledger = new OwnershipLedger();
  const scope = new ReleaseScope('module', 'Battle', ledger);
  const bundle = {
    name: 'yzforge-module-battle',
    async loadAsset(assetPath) {
      return new Asset(assetPath);
    },
    releaseAsset(assetPath) {
      releaseEvents.push(assetPath);
      if (assetPath === 'bad') {
        throw new Error('release failed');
      }
    },
  };
  const assetScope = new AssetScope('Battle', bundle, { debug() {}, warn() {} }, scope, ledger);
  await assetScope.load({ path: 'good', type: Asset });
  await assetScope.load({ path: 'bad', type: Asset });

  let releaseError;
  try {
    await scope.release({ type: 'module_unload' });
  } catch (error) {
    releaseError = error;
  }
  assert(releaseError?.code === 'release.scope_failed', 'ReleaseScope must aggregate AssetScope release failures.');
  const failedScopeSnapshot = ledger.snapshot().scopes.find((scopeItem) => scopeItem.ownerKey === 'module:Battle');
  assert(failedScopeSnapshot?.lastFailure?.code === 'release.scope_failed', 'OwnershipLedger must snapshot ReleaseScope failure reason.');
  assert(
    failedScopeSnapshot?.lastFailure?.errors?.some((error) => error?.code === 'asset.release_failed'),
    'OwnershipLedger release failure evidence must include nested asset release failures.',
  );
  assert(releaseEvents.join('|') === 'good|bad', 'AssetScope releaseAll must continue after a failed asset release.');
  assert(assetScope.snapshot().assets.some((item) => item.path === 'bad'), 'Failed asset release must remain visible in AssetScope snapshot.');
  assert(ledger.snapshot().leaks.some((item) => item.ownerKey === 'module:Battle' && item.kind === 'asset' && item.key.startsWith('bad::')), 'OwnershipLedger must expose failed asset release as leak evidence.');
}

async function assertBundleCachePolicyBehavior() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const errors = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/errors.ts');
  const lifetime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/lifetime.ts', {
    './errors': errors,
  });
  class Asset {}
  class Bundle {
    constructor(name) {
      this.name = name;
    }

    load(_path, _type, done) {
      done(null, new Asset());
    }

    releaseAll() {
      events.push(`releaseAll:${this.name}`);
    }
  }
  const bundles = new Map();
  const events = [];
  const cc = {
    Asset,
    assetManager: {
      getBundle(name) {
        return bundles.get(name);
      },
      loadBundle(name, done) {
        const bundle = new Bundle(name);
        bundles.set(name, bundle);
        done(null, bundle);
      },
      removeBundle(bundle) {
        events.push(`remove:${bundle.name}`);
        bundles.delete(bundle.name);
      },
      releaseAsset() {},
    },
  };
  const bundleRuntime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/bundle-manager.ts', {
    cc,
    './errors': errors,
    './lifetime': lifetime,
  });
  const { BundleManager } = bundleRuntime;
  const { OwnershipLedger, ReleaseScope } = lifetime;
  const ledger = new OwnershipLedger();
  const scope = new ReleaseScope('module', 'Battle', ledger);
  const manager = new BundleManager({ debug() {}, warn() {} }, { cachePolicy: 'keep-hot' }, ledger);
  await manager.loadBundle('battle', { owner: scope });
  assert(manager.snapshot('battle').cacheState === 'owned', 'Bundle snapshot must mark owner-held bundles as owned.');
  await scope.release({ type: 'module_unload' });
  const hotSnapshot = manager.snapshot('battle');
  assert(hotSnapshot.cacheState === 'hot' && hotSnapshot.refCount === 0, 'Bundle release should leave zero-ref bundle as hot cache when policy keeps cache.');
  assert(bundles.has('battle'), 'Hot bundle cache must keep the Cocos bundle loaded.');
  const purge = await manager.purgeUnusedBundles({ type: 'memory_pressure' });
  assert(purge.some((item) => item.name === 'battle' && item.purged), 'Bundle purge must report purged hot bundles.');
  assert(!bundles.has('battle'), 'Bundle purge must remove hot bundle from Cocos assetManager.');
  assert(events.join('|') === 'releaseAll:battle|remove:battle', 'Bundle purge must release assets before removing the bundle.');
}

async function assertLibraryOwnerAcquireBehavior() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const errors = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/errors.ts');
  const lifetime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/lifetime.ts', {
    './errors': errors,
  });
  const libraryRuntime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/library.ts', {
    './assets': { LibraryAssets: class LibraryAssets {} },
    './errors': errors,
    './lifetime': lifetime,
  });
  const { LibraryRegistry } = libraryRuntime;
  assert(typeof LibraryRegistry === 'function', 'Expected LibraryRegistry runtime export.');

  const ownershipEvents = [];
  const kernel = {
    ownership: {
      acquire(owner, kind, key, detail) {
        ownershipEvents.push(['acquire', lifetime.ownerKeyOf(owner), kind, key, detail]);
      },
      release(owner, kind, key, count = 1) {
        ownershipEvents.push(['release', lifetime.ownerKeyOf(owner), kind, key, count]);
      },
    },
    logger: {
      child() {
        return {
          warn() {},
          debug() {},
        };
      },
    },
  };
  const registry = new LibraryRegistry(kernel);
  const deferred = [];
  const owner = {
    ownerKey: 'module:Battle',
    defer(label, task) {
      deferred.push({ label, task });
      return () => {};
    },
  };
  const ref = { name: 'BattleCore', bundle: 'yzforge-lib-battle-core', libraries: [] };
  const record = {
    ref,
    entry: { tokens: {} },
    bundle: {},
    scope: { release: async () => {} },
    assets: { snapshot: () => ({ ownerName: ref.name, loadedCount: 0, trackedNodeCount: 0, assets: [] }) },
    handle: { ref, bundleName: ref.bundle, use() {}, unload: async () => {} },
    owners: new Set(),
    tokenInstances: new Map(),
  };
  registry.records.set(ref.name, record);

  await registry.acquire(ref, owner);
  await registry.acquire(ref, owner);

  assert(record.owners.size === 1, 'Library owner set must stay unique after repeated owner acquire.');
  assert(
    ownershipEvents.filter((event) => event[0] === 'acquire').length === 1,
    'Library owner acquire must only update OwnershipLedger once per owner.',
  );
  assert(deferred.length === 1, 'Library scope release must only be bound once per owner.');

  await registry.releaseOwner(owner);
  assert(
    ownershipEvents.filter((event) => event[0] === 'release').length === 1,
    'Library owner release must balance the single ledger acquire.',
  );
  assert(!registry.records.has(ref.name), 'Library must unload after its only owner is released.');
}

async function assertExtensionRegistryBehavior() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const errors = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/errors.ts');
  const logger = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/logger.ts');
  const configCodecStore = new Map();
  const configCodecEvents = [];
  const configRuntime = {
    configCodecs: {
      register(codec) {
        if (configCodecStore.has(codec.name)) {
          throw new Error(`Duplicate smoke config codec: ${codec.name}`);
        }
        configCodecStore.set(codec.name, codec);
        configCodecEvents.push(`register:${codec.name}`);
        let active = true;
        return () => {
          if (!active) {
            return;
          }
          active = false;
          if (configCodecStore.get(codec.name) === codec) {
            configCodecStore.delete(codec.name);
            configCodecEvents.push(`dispose:${codec.name}`);
          }
        };
      },
    },
  };
  const extensionRuntime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/extension-registry.ts', {
    './config': configRuntime,
    './errors': errors,
    './logger': logger,
  });
  const { ExtensionRegistry } = extensionRuntime;
  assert(typeof ExtensionRegistry === 'function', 'Expected ExtensionRegistry runtime export.');

  const lifecycleHandlers = new Map();
  const emitLifecycle = (event, payload) => {
    for (const handler of Array.from(lifecycleHandlers.get(event) || [])) {
      handler(payload);
    }
  };
  const app = {
    lifecycle: {
      on(event, handler) {
        let handlers = lifecycleHandlers.get(event);
        if (!handlers) {
          handlers = new Set();
          lifecycleHandlers.set(event, handlers);
        }
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
          if (handlers.size === 0) {
            lifecycleHandlers.delete(event);
          }
        };
      },
    },
    viewport: { profile: {} },
  };
  const logs = [];
  const quietLogger = new logger.Logger({
    log(level, scope, message, data) {
      logs.push({ level, scope, message, data });
    },
  });
  const systemUIProviderStore = new Map();
  const systemUIProviderEvents = [];
  const systemUI = {
    registerProvider(provider) {
      if (systemUIProviderStore.has(provider.name)) {
        throw new Error(`Duplicate smoke SystemUI provider: ${provider.name}`);
      }
      systemUIProviderStore.set(provider.name, provider);
      systemUIProviderEvents.push(`register:${provider.name}`);
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        if (systemUIProviderStore.get(provider.name) === provider) {
          systemUIProviderStore.delete(provider.name);
          systemUIProviderEvents.push(`dispose:${provider.name}`);
          provider.dispose?.();
        }
      };
    },
  };
  const newRegistry = () => new ExtensionRegistry(app, quietLogger, { systemUI });
  const registry = newRegistry();
  const appToken = { id: 'analytics.app' };
  const serviceToken = { id: 'analytics.service' };
  const moduleToken = { id: 'analytics.module' };
  const events = [];

  await registry.install({
    name: 'Gameplay',
    dependencies: ['Core'],
    installBeforeStart(context) {
      events.push(`Gameplay:${context.phase}`);
      context.provideModule(moduleToken, (module) => `module:${module.name}`);
    },
    installAfterMainBinding(context) {
      events.push(`Gameplay:${context.phase}`);
    },
    installBeforeFirstModule(context) {
      events.push(`Gameplay:${context.phase}`);
    },
    dispose(context) {
      events.push(`Gameplay:${context.phase}`);
    },
  });
  await registry.install({
    name: 'Core',
    installBeforeStart(context) {
      events.push(`Core:${context.phase}`);
      context.provide(appToken, 'ready');
      context.registerAppService(serviceToken, { ready: true }, {
        dispose(value) {
          events.push(`service-dispose:${value.ready}`);
        },
      });
      context.onLifecycle('foreground', () => events.push('Core:foreground'));
      context.registerConfigCodec({
        name: 'core-binary',
        version: 1,
        decode(data) {
          return data;
        },
      });
      context.registerSystemUIProvider({
        name: 'core-system-ui',
        dispose() {
          events.push('system-provider-dispose:core');
        },
      });
    },
    dispose(context) {
      events.push(`Core:${context.phase}`);
    },
  });

  await registry.installBeforeStart();
  assert(
    events.join('|') === 'Core:before-start|Gameplay:before-start',
    'Extension before-start phase must run dependencies before dependents.',
  );
  assert(registry.use(appToken) === 'ready', 'ExtensionContext.provide must register app tokens.');
  assert(registry.use(serviceToken).ready === true, 'ExtensionContext.registerAppService must register managed app services.');
  assert(registry.useModuleToken({ name: 'Battle' }, moduleToken) === 'module:Battle', 'ExtensionContext.provideModule must register module-scoped tokens.');
  assert(configCodecStore.has('core-binary'), 'ExtensionContext.registerConfigCodec must register config codecs.');
  assert(systemUIProviderStore.has('core-system-ui'), 'ExtensionContext.registerSystemUIProvider must register SystemUI providers.');
  emitLifecycle('foreground');
  assert(events.includes('Core:foreground'), 'ExtensionContext.onLifecycle must register lifecycle listeners.');

  await registry.install({
    name: 'Late',
    dependencies: ['Core'],
    installBeforeStart(context) {
      events.push(`Late:${context.phase}`);
    },
    installAfterMainBinding(context) {
      events.push(`Late:${context.phase}`);
    },
  });
  assert(events.includes('Late:before-start'), 'Late extension install must replay completed phases.');

  await registry.installAfterMainBinding();
  await registry.installBeforeFirstModule();
  assert(events.includes('Gameplay:after-main-binding'), 'Extension after-main-binding phase must run.');
  assert(events.includes('Gameplay:before-first-module'), 'Extension before-first-module phase must run.');

  await registry.dispose({ type: 'test_dispose' });
  assert(
    events.indexOf('Gameplay:dispose') >= 0
      && events.indexOf('Core:dispose') >= 0
      && events.indexOf('Gameplay:dispose') < events.indexOf('Core:dispose'),
    'Extension dispose must run dependents before dependencies.',
  );
  const foregroundEventCount = events.filter((event) => event === 'Core:foreground').length;
  emitLifecycle('foreground');
  assert(
    events.filter((event) => event === 'Core:foreground').length === foregroundEventCount,
    'Extension lifecycle listeners must be removed when the registry is disposed.',
  );
  assert(!configCodecStore.has('core-binary'), 'Extension config codecs must be removed when the registry is disposed.');
  assert(configCodecEvents.includes('dispose:core-binary'), 'Extension config codec disposer must run when the registry is disposed.');
  assert(events.includes('service-dispose:true'), 'Extension app services must be disposed when the registry is disposed.');
  assert(!systemUIProviderStore.has('core-system-ui'), 'Extension SystemUI providers must be removed when the registry is disposed.');
  assert(systemUIProviderEvents.includes('dispose:core-system-ui'), 'Extension SystemUI provider disposer must run when the registry is disposed.');

  const disposeFailureRegistry = newRegistry();
  const disposeFailureEvents = [];
  const disposeFailureServiceToken = { id: 'dispose.failure.service' };
  await disposeFailureRegistry.install({
    name: 'DisposeFailure',
    installBeforeStart(context) {
      context.onLifecycle('foreground', () => disposeFailureEvents.push('foreground'));
      context.registerAppService(disposeFailureServiceToken, { alive: true }, {
        dispose() {
          disposeFailureEvents.push('service-disposed');
        },
      });
      context.registerConfigCodec({
        name: 'dispose-failure-binary',
        version: 1,
        decode(data) {
          return data;
        },
      });
      context.registerSystemUIProvider({
        name: 'dispose-failure-system-ui',
        dispose() {
          disposeFailureEvents.push('system-ui-disposed');
        },
      });
    },
    dispose() {
      throw new Error('dispose boom');
    },
  });
  await disposeFailureRegistry.installBeforeStart();
  emitLifecycle('foreground');
  assert(disposeFailureEvents.length === 1, 'Dispose failure smoke must register a lifecycle listener before disposal.');
  assert(disposeFailureRegistry.use(disposeFailureServiceToken).alive === true, 'Dispose failure smoke must register a service before disposal.');
  assert(configCodecStore.has('dispose-failure-binary'), 'Dispose failure smoke must register a config codec before disposal.');
  assert(systemUIProviderStore.has('dispose-failure-system-ui'), 'Dispose failure smoke must register a SystemUI provider before disposal.');
  let disposeFailure;
  try {
    await disposeFailureRegistry.dispose({ type: 'dispose_failure_smoke' });
  } catch (error) {
    disposeFailure = error;
  }
  assert(disposeFailure?.message === 'dispose boom', 'Extension dispose failure must still be reported.');
  emitLifecycle('foreground');
  assert(disposeFailureEvents.filter((event) => event === 'foreground').length === 1, 'Extension side effects must be cleaned even when dispose throws.');
  assert(disposeFailureEvents.includes('service-disposed'), 'Extension app services must be disposed even when dispose throws.');
  assert(!configCodecStore.has('dispose-failure-binary'), 'Extension config codecs must be removed even when dispose throws.');
  assert(!systemUIProviderStore.has('dispose-failure-system-ui'), 'Extension SystemUI providers must be removed even when dispose throws.');
  assert(disposeFailureEvents.includes('system-ui-disposed'), 'Extension SystemUI provider disposer must run even when dispose throws.');

  const missing = newRegistry();
  await missing.install({ name: 'NeedsMissing', dependencies: ['Missing'] });
  let missingError;
  try {
    await missing.installBeforeStart();
  } catch (error) {
    missingError = error;
  }
  assert(missingError?.code === 'extension.dependency_missing', 'Extension missing dependency must fail with a typed error.');
  assert(missingError?.details?.dependencyChain?.join(' -> ') === 'NeedsMissing -> Missing', 'Extension missing dependency must report dependency chain.');

  const cycle = newRegistry();
  await cycle.install({ name: 'A', dependencies: ['B'] });
  await cycle.install({ name: 'B', dependencies: ['A'] });
  let cycleError;
  try {
    await cycle.installBeforeStart();
  } catch (error) {
    cycleError = error;
  }
  assert(cycleError?.code === 'extension.dependency_cycle', 'Extension dependency cycle must fail with a typed error.');

  const failing = newRegistry();
  const rollbackEvents = [];
  const rollbackToken = { id: 'rollback.core' };
  const rollbackServiceToken = { id: 'rollback.service.core' };
  const badRollbackToken = { id: 'rollback.bad' };
  const badRollbackServiceToken = { id: 'rollback.service.bad' };
  await failing.install({
    name: 'Core',
    installBeforeStart(context) {
      rollbackEvents.push(`Core:${context.phase}`);
      context.provide(rollbackToken, 'core-ready');
      context.registerAppService(rollbackServiceToken, { source: 'core' }, {
        dispose() {
          rollbackEvents.push('Core:service-dispose');
        },
      });
      context.onLifecycle('foreground', () => rollbackEvents.push('Core:foreground'));
      context.registerConfigCodec({
        name: 'rollback-core-binary',
        version: 1,
        decode(data) {
          return data;
        },
      });
      context.registerSystemUIProvider({
        name: 'rollback-core-system-ui',
        dispose() {
          rollbackEvents.push('Core:system-provider-dispose');
        },
      });
    },
    dispose(context, reason) {
      rollbackEvents.push(`Core:${context.phase}:${reason?.type}`);
    },
  });
  await failing.install({
    name: 'Bad',
    dependencies: ['Core'],
    installBeforeStart(context) {
      context.provide(badRollbackToken, 'bad-leak');
      context.registerAppService(badRollbackServiceToken, { source: 'bad' }, {
        dispose() {
          rollbackEvents.push('Bad:service-dispose');
        },
      });
      context.registerConfigCodec({
        name: 'rollback-bad-binary',
        version: 1,
        decode(data) {
          return data;
        },
      });
      context.registerSystemUIProvider({
        name: 'rollback-bad-system-ui',
        dispose() {
          rollbackEvents.push('Bad:system-provider-dispose');
        },
      });
      throw new Error('boom');
    },
  });
  let phaseError;
  try {
    await failing.installBeforeStart();
  } catch (error) {
    phaseError = error;
  }
  assert(phaseError?.code === 'extension.phase_failed', 'Extension phase failure must be wrapped.');
  assert(phaseError?.details?.extensionName === 'Bad', 'Extension phase failure must include extension name.');
  assert(phaseError?.details?.phase === 'before-start', 'Extension phase failure must include phase.');
  assert(phaseError?.details?.dependencyChain?.join(' -> ') === 'Bad -> Core', 'Extension phase failure must include dependency chain.');
  assert(rollbackEvents.includes('Core:before-start'), 'Extension phase failure smoke must run completed dependency hooks before failure.');
  assert(
    rollbackEvents.includes('Core:dispose:extension_phase_rollback'),
    'Extension phase failure must dispose completed extensions from the failed transaction.',
  );
  assert(rollbackEvents.includes('Core:service-dispose'), 'Extension phase rollback must dispose services from completed hooks.');
  assert(rollbackEvents.includes('Bad:service-dispose'), 'Extension phase rollback must dispose services from the failing hook.');
  assert(rollbackEvents.includes('Core:system-provider-dispose'), 'Extension phase rollback must dispose SystemUI providers from completed hooks.');
  assert(rollbackEvents.includes('Bad:system-provider-dispose'), 'Extension phase rollback must dispose SystemUI providers from the failing hook.');
  emitLifecycle('foreground');
  assert(!rollbackEvents.includes('Core:foreground'), 'Extension phase rollback must remove lifecycle listeners registered in the failed transaction.');
  assert(!configCodecStore.has('rollback-core-binary'), 'Extension phase rollback must remove config codecs from completed hooks.');
  assert(!configCodecStore.has('rollback-bad-binary'), 'Extension phase rollback must remove config codecs from the failing hook.');
  assert(!systemUIProviderStore.has('rollback-core-system-ui'), 'Extension phase rollback must remove SystemUI providers from completed hooks.');
  assert(!systemUIProviderStore.has('rollback-bad-system-ui'), 'Extension phase rollback must remove SystemUI providers from the failing hook.');
  let rollbackServiceTokenError;
  try {
    failing.use(rollbackServiceToken);
  } catch (error) {
    rollbackServiceTokenError = error;
  }
  assert(rollbackServiceTokenError?.code === 'extension.token_missing', 'Extension phase rollback must remove services registered by completed extensions.');
  let badRollbackServiceTokenError;
  try {
    failing.use(badRollbackServiceToken);
  } catch (error) {
    badRollbackServiceTokenError = error;
  }
  assert(badRollbackServiceTokenError?.code === 'extension.token_missing', 'Extension phase rollback must remove services registered before a failing hook throws.');
  let rollbackTokenError;
  try {
    failing.use(rollbackToken);
  } catch (error) {
    rollbackTokenError = error;
  }
  assert(rollbackTokenError?.code === 'extension.token_missing', 'Extension phase rollback must remove tokens provided by completed extensions.');
  let badRollbackTokenError;
  try {
    failing.use(badRollbackToken);
  } catch (error) {
    badRollbackTokenError = error;
  }
  assert(badRollbackTokenError?.code === 'extension.token_missing', 'Extension phase rollback must remove tokens provided before a failing hook throws.');

  const preciseRollback = new ExtensionRegistry(app, quietLogger);
  const preciseEvents = [];
  const preciseToken = { id: 'rollback.precise' };
  await preciseRollback.install({
    name: 'Core',
    installBeforeStart(context) {
      preciseEvents.push(`Core:${context.phase}`);
      context.provide(preciseToken, 'precise-ready');
    },
    rollbackBeforeStart(context, reason) {
      preciseEvents.push(`Core:${context.phase}:rollback:${reason.phase}:${reason.failedExtension}:${reason.type}`);
    },
    dispose(context, reason) {
      preciseEvents.push(`Core:${context.phase}:dispose:${reason?.type}`);
    },
  });
  await preciseRollback.install({
    name: 'Bad',
    dependencies: ['Core'],
    installBeforeStart() {
      throw new Error('precise boom');
    },
  });
  try {
    await preciseRollback.installBeforeStart();
  } catch (_error) {
    // Expected: the assertion below checks the precise rollback path.
  }
  assert(
    preciseEvents.join('|') === 'Core:before-start|Core:before-start:rollback:before-start:Bad:extension_phase_rollback',
    'Extension phase-specific rollback hook must run instead of full dispose during phase rollback.',
  );
  let preciseRollbackTokenError;
  try {
    preciseRollback.use(preciseToken);
  } catch (error) {
    preciseRollbackTokenError = error;
  }
  assert(preciseRollbackTokenError?.code === 'extension.token_missing', 'Extension phase-specific rollback must still run after transaction token rollback.');
  await preciseRollback.dispose({ type: 'precise_dispose_after_failed_phase' });
  assert(
    preciseEvents.includes('Core:dispose:dispose:precise_dispose_after_failed_phase'),
    'Extension phase-specific rollback must not mark the extension as fully disposed.',
  );
}

async function assertViewResultCloseBehavior() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const errors = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/errors.ts');
  const uiRuntime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/ui.ts', {
    cc: {
      Component: class Component {},
      EventKeyboard: class EventKeyboard {},
      input: { on() {}, off() {} },
      Input: { EventType: { KEY_DOWN: 'key-down' } },
      isValid(value) {
        return Boolean(value) && value.valid !== false;
      },
      KeyCode: { MOBILE_BACK: 6, ESCAPE: 27 },
      Node: class Node {},
    },
    './errors': errors,
    './layer-registry': {
      LayerRegistry: class LayerRegistry {
        constructor(roots = {}) {
          this.roots = roots;
        }
        configure(roots) {
          this.roots = roots;
        }
        get(layer) {
          return this.roots[layer];
        }
        snapshot() {
          return [];
        }
      },
    },
    './system-ui': {
      SystemUI: class SystemUI {
        updatePopupMask() {}
        dispose() {}
        snapshot() {
          return { popupMaskVisible: false, touchMaskVisible: false };
        }
      },
    },
    './view-runtime': {
      ViewRuntime: class ViewRuntime {
        beforeOpen(view, data) { return view.__yzforgeBeforeOpen(data); }
        open(view, data) { return view.__yzforgeOpen(data); }
        beforeClose(view, reason) { return view.__yzforgeBeforeClose(reason); }
        close(view, result) { return view.__yzforgeClose(result); }
      },
    },
  });
  const { View } = uiRuntime;
  assert(typeof View === 'function', 'Expected View runtime export.');

  class ResultView extends View {
    onClose(result) {
      this.closedWith = result;
    }
  }

  const cancelResult = { cancelled: true, reason: 'module_unload' };
  const resultView = new ResultView();
  resultView.__yzforgeBind({}, { ref: { path: 'res/view/ResultView' } });
  const waitCancel = resultView.__yzforgeWaitResult();
  await resultView.__yzforgeClose(cancelResult);
  assert(await waitCancel === cancelResult, 'View close must resolve pending result with cancel payload.');
  assert(resultView.closedWith === cancelResult, 'View onClose must receive the close result.');

  class FailingCloseView extends View {
    onClose() {
      throw new Error('close failed');
    }
  }

  const failingView = new FailingCloseView();
  const closeResult = { ok: true };
  failingView.__yzforgeBind({}, { ref: { path: 'res/view/FailingCloseView' } });
  const waitClose = failingView.__yzforgeWaitResult();
  let closeError;
  try {
    await failingView.__yzforgeClose(closeResult);
  } catch (error) {
    closeError = error;
  }
  assert(await waitClose === closeResult, 'View close must resolve result before reporting lifecycle failures.');
  assert(closeError?.code === 'ui.view_lifecycle_close_failed', 'View close lifecycle failures must be reported after result resolution.');
}

async function assertAppStateMachineBehavior() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const errors = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/errors.ts');
  const events = [];
  const controls = {};
  const lifecycleHandlers = new Map();
  const emitLifecycle = (event, payload) => {
    for (const handler of Array.from(lifecycleHandlers.get(event) || [])) {
      handler(payload);
    }
  };
  controls.emitLifecycle = emitLifecycle;

  function createLogger(scope = 'app') {
    return {
      info(message) { events.push(`${scope}:info:${message}`); },
      warn(message) { events.push(`${scope}:warn:${message}`); },
      debug(message) { events.push(`${scope}:debug:${message}`); },
      child(name) { return createLogger(`${scope}/${name}`); },
    };
  }

  class SmokeReleaseScope {
    constructor(kind = 'app', key = 'root', parent) {
      this.kind = kind;
      this.key = key;
      this.ownerKey = parent ? `${parent.ownerKey}/${kind}:${key}` : `${kind}:${key}`;
      this.released = false;
    }

    child(kind, key) {
      return new SmokeReleaseScope(kind, key, this);
    }

    defer() {
      return () => {};
    }

    async release(reason) {
      this.released = true;
      events.push(`release:${this.ownerKey}:${reason?.type ?? 'unknown'}`);
    }

    snapshot() {
      return {
        ownerKey: this.ownerKey,
        kind: this.kind,
        key: this.key,
        released: this.released,
        releasing: false,
        actionCount: 0,
        children: [],
      };
    }
  }

  class SmokeViewportManager {
    constructor() {
      this.profile = {
        frameWidth: 1280,
        frameHeight: 720,
        visibleWidth: 1280,
        visibleHeight: 720,
        designWidth: 1280,
        designHeight: 720,
        aspectRatio: 1280 / 720,
        orientation: 'landscape',
        safeArea: { x: 0, y: 0, width: 1280, height: 720 },
        safeInsets: { left: 0, right: 0, top: 0, bottom: 0 },
      };
    }

    initialize() {
      events.push('viewport.initialize');
    }

    dispose() {
      events.push('viewport.dispose');
    }

    onChanged() {
      events.push('viewport.onChanged');
      return () => events.push('viewport.offChanged');
    }
  }

  class SmokeAppKernel {
    constructor(app) {
      this.logger = createLogger();
      this.entries = {
        waitForModule: async () => ({}),
        validateModule() {},
      };
      this.ownership = {
        snapshot: () => ({ scopes: [], holdings: [], leaks: [] }),
      };
      this.releaseScope = new SmokeReleaseScope();
      this.configs = {
        loadScope: async () => ({}),
      };
      this.bundles = {
        snapshots: () => [],
        preloadBundle: async (bundle) => {
          events.push(`bundle.preload:${bundle}`);
          if (controls.preloadBundle) {
            await controls.preloadBundle(bundle);
          }
          return {};
        },
        loadBundle: async () => ({}),
        purgeUnusedBundles: async (reason) => {
          events.push(`bundle.purge:${reason?.type ?? 'unknown'}`);
          return [];
        },
      };
      this.shared = {};
      this.libraries = {
        snapshots: () => [],
        acquire: async () => {},
      };
      this.extensions = {
        install: async (extension) => events.push(`extension.install:${extension.name}`),
        installBeforeStart: async () => {
          events.push('extension.before-start');
          if (controls.beforeStart) {
            await controls.beforeStart();
          }
        },
        installAfterMainBinding: async () => {
          events.push('extension.after-main-binding');
          if (controls.afterMainBinding) {
            await controls.afterMainBinding();
          }
        },
        installBeforeFirstModule: async () => {
          events.push('extension.before-first-module');
          if (controls.beforeFirstModule) {
            await controls.beforeFirstModule();
          }
        },
        dispose: async (reason) => {
          events.push(`extension.dispose:${reason?.type ?? 'unknown'}`);
        },
        use: () => 'token-value',
        useModuleToken: () => 'module-token-value',
      };
      this.global = {
        initialize: async () => events.push('global.initialize'),
        dispose: async () => events.push('global.dispose'),
      };
      this.lifecycle = {
        install: () => events.push('lifecycle.install'),
        dispose: () => events.push('lifecycle.dispose'),
        on: (event, handler) => {
          events.push(`lifecycle.on:${event}`);
          let handlers = lifecycleHandlers.get(event);
          if (!handlers) {
            handlers = new Set();
            lifecycleHandlers.set(event, handlers);
          }
          handlers.add(handler);
          return () => {
            events.push(`lifecycle.off:${event}`);
            handlers.delete(handler);
            if (handlers.size === 0) {
              lifecycleHandlers.delete(event);
            }
          };
        },
        emitViewportChanged: () => events.push('lifecycle.viewport-changed'),
      };
      this.viewport = new SmokeViewportManager();
      this.ui = {
        configureRoots: () => events.push('ui.configureRoots'),
        installBackKeyHandler: () => events.push('ui.installBackKeyHandler'),
        dispose: () => events.push('ui.dispose'),
        disposeModule: async () => events.push('ui.disposeModule'),
        createForModule: () => ({}),
        snapshot: () => ({ layers: [], system: {}, views: [] }),
      };
      this.navigator = {
        enter: async () => ({ ref: { name: 'Entered' } }),
        detach: async () => events.push('navigator.detach'),
        snapshot: () => ({ stack: [] }),
      };
      this.app = app;
    }
  }

  const appRuntime = loadRuntimeModule(projectRoot, 'packages/yzforge-runtime/src/app.ts', {
    './assets': { ModuleAssets: class ModuleAssets {} },
    './content-pack': { ContentPackManager: class ContentPackManager {} },
    './kernel': { AppKernel: SmokeAppKernel },
    './library': { ModuleLibraryManager: class ModuleLibraryManager {} },
    './main-binding': { createMainBinding: () => ({ layerRoots: {} }) },
    './module': { ModuleState: { Entering: 'entering' } },
    './viewport': { ViewportManager: SmokeViewportManager },
    './errors': errors,
  });
  const { App, AppState } = appRuntime;
  assert(AppState.Created === 'created', 'AppState must expose created state.');

  const ref = { name: 'Battle', bundle: 'yzforge-module-battle', libraries: [] };
  const app = new App();
  assert(app.state === AppState.Created, 'App must start in Created state.');
  assert(app.snapshot().state === AppState.Created, 'App snapshot must expose current state.');
  assert(app.snapshot().resourceDiagnostics?.healthy === true, 'App snapshot must expose healthy resource diagnostics when no leaks exist.');

  let invalidLoad;
  try {
    await app.loadModule(ref);
  } catch (error) {
    invalidLoad = error;
  }
  assert(invalidLoad?.code === 'app.invalid_state', 'App.loadModule must fail before start.');
  assert(invalidLoad?.details?.state === AppState.Created, 'Invalid loadModule must report current App state.');
  const invalidLoadSnapshot = app.snapshot().lastFailure;
  assert(invalidLoadSnapshot?.api === 'loadModule', 'App snapshot must expose the last failed API.');
  assert(invalidLoadSnapshot?.state === AppState.Created, 'App failure snapshot must expose the final App state.');
  assert(invalidLoadSnapshot?.error?.code === 'app.invalid_state', 'App failure snapshot must expose structured error summaries.');

  await app.start();
  assert(app.state === AppState.Started, 'App.start must transition to Started.');
  assert(events.includes('lifecycle.on:memory-warning'), 'App.start must install the memory pressure cache policy.');
  await app.purgeResourceCache({ type: 'smoke_cache_purge' });
  assert(events.includes('bundle.purge:smoke_cache_purge'), 'App.purgeResourceCache must delegate to BundleManager purge.');
  controls.emitLifecycle('memory-warning');
  await Promise.resolve();
  assert(events.includes('bundle.purge:memory_pressure'), 'App memory-warning policy must purge unused hot bundles.');

  let moduleLoadFailure;
  try {
    await app.loadModule(ref);
  } catch (error) {
    moduleLoadFailure = error;
  }
  assert(moduleLoadFailure, 'App.loadModule must surface module load failures.');
  const moduleLoadFailureSnapshot = app.snapshot().lastFailure;
  assert(moduleLoadFailureSnapshot?.api === 'loadModule', 'App failure snapshot must update after module load failure.');
  assert(moduleLoadFailureSnapshot?.state === AppState.Started, 'Module load failure snapshot must keep the current App state.');

  let releaseConcurrentPreload;
  controls.preloadBundle = () => new Promise((resolve) => {
    releaseConcurrentPreload = resolve;
  });
  const concurrentRef = { name: 'PreloadOnly', bundle: 'yzforge-module-preload-only', libraries: [] };
  const concurrentPreloadA = app.preloadModule(concurrentRef);
  const concurrentPreloadB = app.preloadModule(concurrentRef);
  assert(events.filter((event) => event === 'bundle.preload:yzforge-module-preload-only').length === 1, 'Concurrent App.preloadModule calls must share one preload task.');
  releaseConcurrentPreload();
  const [concurrentScopeA, concurrentScopeB] = await Promise.all([concurrentPreloadA, concurrentPreloadB]);
  assert(concurrentScopeA === concurrentScopeB, 'Concurrent App.preloadModule calls must resolve the same preload scope.');
  controls.preloadBundle = undefined;

  let duplicateStart;
  try {
    await app.start();
  } catch (error) {
    duplicateStart = error;
  }
  assert(duplicateStart?.code === 'app.invalid_state', 'App.start must reject duplicate start.');
  assert(duplicateStart?.details?.state === AppState.Started, 'Duplicate start must report Started state.');
  assert(app.snapshot().lastFailure?.api === 'start', 'App failure snapshot must update after duplicate start failure.');

  let releaseDisposePreload;
  controls.preloadBundle = () => new Promise((resolve) => {
    releaseDisposePreload = resolve;
  });
  const disposePreload = app.preloadModule({ name: 'DisposePreload', bundle: 'yzforge-module-dispose-preload', libraries: [] });
  const disposeDuringPreload = app.dispose({ type: 'test_dispose' });
  await Promise.resolve();
  assert(app.state === AppState.Disposing, 'App.dispose during preload must enter Disposing.');
  assert(!events.includes('extension.dispose:test_dispose'), 'App.dispose must wait for pending preload tasks before runtime disposal.');
  releaseDisposePreload();
  await disposePreload;
  await disposeDuringPreload;
  controls.preloadBundle = undefined;
  assert(app.state === AppState.Disposed, 'App.dispose must transition to Disposed.');
  assert(events.includes('lifecycle.off:memory-warning'), 'App.dispose must unbind the memory pressure cache policy.');
  const memoryPressurePurgeCount = events.filter((event) => event === 'bundle.purge:memory_pressure').length;
  controls.emitLifecycle('memory-warning');
  await Promise.resolve();
  assert(
    events.filter((event) => event === 'bundle.purge:memory_pressure').length === memoryPressurePurgeCount,
    'App.dispose must prevent memory-warning from purging after lifecycle teardown.',
  );
  await app.dispose({ type: 'repeat_dispose' });
  assert(app.state === AppState.Disposed, 'App.dispose must be idempotent after Disposed.');

  let enterAfterDispose;
  try {
    await app.enterModule(ref);
  } catch (error) {
    enterAfterDispose = error;
  }
  assert(enterAfterDispose?.code === 'app.invalid_state', 'App.enterModule must fail after dispose.');
  assert(enterAfterDispose?.details?.state === AppState.Disposed, 'Invalid enterModule must report Disposed state.');

  let releaseStart;
  controls.beforeStart = () => new Promise((resolve) => {
    releaseStart = resolve;
  });
  const slowApp = new App();
  const startTask = slowApp.start();
  await Promise.resolve();
  assert(slowApp.state === AppState.Starting, 'App must enter Starting while start task is pending.');
  const disposeTask = slowApp.dispose({ type: 'dispose_during_start' });
  assert(slowApp.state === AppState.Disposing, 'App.dispose during start must enter Disposing.');
  releaseStart();
  await startTask;
  await disposeTask;
  assert(slowApp.state === AppState.Disposed, 'App.dispose during start must finish Disposed.');

  controls.beforeStart = async () => {
    throw new Error('start failed');
  };
  const failingApp = new App();
  let startFailure;
  try {
    await failingApp.start();
  } catch (error) {
    startFailure = error;
  }
  assert(startFailure?.message === 'start failed', 'App.start must surface original start failure after rollback.');
  assert(failingApp.state === AppState.Disposed, 'App.start failure must rollback to Disposed when cleanup succeeds.');
  const startFailureSnapshot = failingApp.snapshot().lastFailure;
  assert(startFailureSnapshot?.api === 'start', 'App start failure snapshot must expose the failed API.');
  assert(startFailureSnapshot?.state === AppState.Disposed, 'App start failure snapshot must expose the rollback final state.');
  assert(startFailureSnapshot?.error?.message === 'start failed', 'App start failure snapshot must expose the original error summary.');
  assert(
    startFailureSnapshot?.transitions?.map((transition) => `${transition.from}->${transition.to}`).join('|') === 'created->starting|starting->disposing|disposing->disposed',
    'App start failure snapshot must expose rollback state transitions.',
  );
}

function writeBundleMeta(projectRoot, relativeDir, bundleName) {
  writeJson(projectRoot, `${relativeDir}.meta`, {
    userData: {
      isBundle: true,
      bundleName,
    },
  });
}

function writeScriptMeta(projectRoot, relativeScriptPath, uuid) {
  writeJson(projectRoot, `${relativeScriptPath}.meta`, {
    ver: '4.0.24',
    importer: 'typescript',
    imported: true,
    uuid,
    files: [],
    subMetas: {},
    userData: {},
  });
}

function writeAssemblyRecord(projectRoot, target, resolved = { type: 'module', id: 'assets/yzforge/runtime/index.ts' }) {
  writeJson(projectRoot, `temp/programming/packer-driver/targets/${target}/assembly-record.json`, {
    chunks: {
      main: {
        imports: {
          yzforge: {
            resolved,
            messages: [],
          },
        },
      },
    },
  });
}

function compactUuid(value) {
  return String(value || '').replace(/-/g, '').toLowerCase();
}

function compressScriptUuid(uuid) {
  const compact = compactUuid(uuid);
  let result = compact.slice(0, 5);
  for (let i = 5; i < compact.length; i += 3) {
    const lhs = UUID_HEX_CHARS.indexOf(compact[i]);
    const mid = UUID_HEX_CHARS.indexOf(compact[i + 1]);
    const rhs = UUID_HEX_CHARS.indexOf(compact[i + 2]);
    result += UUID_BASE64_KEYS[(lhs << 2) | (mid >> 2)];
    result += UUID_BASE64_KEYS[((mid & 3) << 4) | rhs];
  }
  return result;
}

function markerComponent(name) {
  const match = /^@[A-Za-z_$][\w$]*:([A-Za-z_$][\w$.]*)$/.exec(String(name || ''));
  if (!match) {
    return undefined;
  }
  const component = match[1].replace(/^cc\./, '');
  return component === 'Node' ? undefined : component;
}

function uiTransformRecord(nodeId, width = 120, height = 40) {
  return {
    __type__: 'cc.UITransform',
    node: { __id__: nodeId },
    _contentSize: {
      __type__: 'cc.Size',
      width,
      height,
    },
    _anchorPoint: {
      __type__: 'cc.Vec2',
      x: 0.5,
      y: 0.5,
    },
  };
}

function spriteRecord(nodeId) {
  return {
    __type__: 'cc.Sprite',
    node: { __id__: nodeId },
    _color: {
      __type__: 'cc.Color',
      r: 255,
      g: 255,
      b: 255,
      a: 255,
    },
    _spriteFrame: {
      __uuid__: '7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941',
      __expectedType__: 'cc.SpriteFrame',
    },
  };
}

function labelRecord(nodeId, text = 'Text') {
  return {
    __type__: 'cc.Label',
    node: { __id__: nodeId },
    _string: text,
    _fontSize: 20,
    _lineHeight: 28,
    _horizontalAlign: 1,
    _verticalAlign: 1,
  };
}

function buttonRecord(nodeId) {
  return {
    __type__: 'cc.Button',
    node: { __id__: nodeId },
    clickEvents: [],
    _interactable: true,
    _transition: 0,
    _target: { __id__: nodeId },
  };
}

function serializedPrefab(scriptUuid, markers = [], options = {}) {
  const records = [
    {
      __type__: 'cc.Prefab',
      _name: 'Prefab',
      data: { __id__: 1 },
    },
    {
      __type__: 'cc.Node',
      _name: 'Root',
      _children: [],
      _components: [],
      _prefab: null,
    },
  ];
  const root = records[1];
  const rootTransformId = records.length;
  records.push(uiTransformRecord(1, options.rootWidth || 640, options.rootHeight || 360));
  root._components.push({ __id__: rootTransformId });

  const scriptId = records.length;
  records.push({
    __type__: compressScriptUuid(scriptUuid),
    node: { __id__: 1 },
    _enabled: true,
  });
  root._components.push({ __id__: scriptId });

  for (const name of markers) {
    const component = options.omitMarkerComponents ? undefined : markerComponent(name);
    const nodeId = records.length;
    const node = {
      __type__: 'cc.Node',
      _name: name,
      _parent: { __id__: 1 },
      _children: [],
      _components: [],
      _prefab: null,
    };
    records.push(node);
    root._children.push({ __id__: nodeId });

    const transformId = records.length;
    records.push(uiTransformRecord(nodeId, component === 'Button' ? 160 : 120, component === 'Button' ? 48 : 40));
    node._components.push({ __id__: transformId });

    if (!component) {
      continue;
    }
    if (component === 'Sprite') {
      const spriteId = records.length;
      records.push(spriteRecord(nodeId));
      node._components.push({ __id__: spriteId });
    } else if (component === 'Label') {
      const labelId = records.length;
      records.push(labelRecord(nodeId, name));
      node._components.push({ __id__: labelId });
    } else if (component === 'Button') {
      const spriteId = records.length;
      records.push(spriteRecord(nodeId));
      node._components.push({ __id__: spriteId });
      const buttonId = records.length;
      records.push(buttonRecord(nodeId));
      node._components.push({ __id__: buttonId });
    } else {
      const componentId = records.length;
      records.push({
        __type__: `cc.${component}`,
        node: { __id__: nodeId },
      });
      node._components.push({ __id__: componentId });
    }
  }

  const prefabInfoId = records.length;
  root._prefab = { __id__: prefabInfoId };
  records.push({
    __type__: 'cc.PrefabInfo',
    root: { __id__: 1 },
    asset: { __id__: 0 },
    fileId: '',
    instance: null,
    targetOverrides: null,
    nestedPrefabInstanceRoots: null,
  });
  return `${JSON.stringify(records, null, 2)}\n`;
}

function serializedMainScene(mainScriptUuid) {
  const node = (name, parentId, childIds, componentIds = []) => ({
    __type__: 'cc.Node',
    _name: name,
    _parent: parentId === undefined ? null : { __id__: parentId },
    _children: childIds.map((childId) => ({ __id__: childId })),
    _components: componentIds.map((componentId) => ({ __id__: componentId })),
    _prefab: null,
  });

  const records = [
    {
      __type__: 'cc.SceneAsset',
      scene: { __id__: 1 },
    },
    {
      __type__: 'cc.Scene',
      _name: 'Main',
      _children: [{ __id__: 2 }],
    },
    node('MainRoot', 1, [3, 5], [14]),
    node('WorldRoot', 2, [4]),
    node('SceneHost', 3, []),
    node('Canvas', 2, [6], [15]),
    node('UIRoot', 5, [7, 8, 9, 10, 11, 12, 13]),
    node('UnderlayLayer', 6, [], [16]),
    node('PageLayer', 6, [], [17]),
    node('PaperLayer', 6, [], [18]),
    node('PopupLayer', 6, [], [19]),
    node('ToastLayer', 6, [], [20]),
    node('TopLayer', 6, [], [21]),
    node('SystemOverlayLayer', 6, [], [22]),
    {
      __type__: compressScriptUuid(mainScriptUuid),
      node: { __id__: 2 },
      _enabled: true,
    },
    {
      __type__: 'cc.Canvas',
      node: { __id__: 5 },
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 7 },
      _enabled: true,
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 8 },
      _enabled: true,
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 9 },
      _enabled: true,
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 10 },
      _enabled: true,
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 11 },
      _enabled: true,
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 12 },
      _enabled: true,
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 13 },
      _enabled: true,
    },
  ];

  return `${JSON.stringify(records, null, 2)}\n`;
}

function mainComponentSource() {
  return [
    "import { _decorator, Component } from 'cc';",
    "import type { App } from 'yzforge';",
    "import { clearYZForgeApp, createYZForgeApp } from '../bootstrap/app';",
    '',
    'const { ccclass } = _decorator;',
    '',
    "@ccclass('Main')",
    'export class Main extends Component {',
    '    private app?: App;',
    '',
    '    protected onLoad(): void {',
    '        void this.startApp();',
    '    }',
    '',
    '    private async startApp(): Promise<void> {',
    '        this.app = await createYZForgeApp();',
    '        await this.app.start({ mainRoot: this.node });',
    '    }',
    '',
    '    protected onDestroy(): void {',
    "        void this.app?.dispose({ type: 'main_destroy' });",
    '        clearYZForgeApp(this.app);',
    '        this.app = undefined;',
    '    }',
    '}',
    '',
  ].join('\n');
}

function appStateMachineRuntimeSource() {
  return [
    'export enum AppState {',
    "    Created = 'created',",
    "    Starting = 'starting',",
    "    Started = 'started',",
    "    Disposing = 'disposing',",
    "    Disposed = 'disposed',",
    "    Failed = 'failed',",
    '}',
    '',
    'export interface AppRuntimeSnapshot {',
    '    readonly state: AppState;',
    '}',
    '',
    'export class App {',
    '    private appState = AppState.Created;',
    '    private readonly preloadTasks = new Map<string, Promise<unknown>>();',
    '    private readonly moduleTasks = new Map<string, Promise<unknown>>();',
    '',
    '    public get state(): AppState {',
    '        return this.appState;',
    '    }',
    '',
    '    public async start(): Promise<void> {',
    "        this.assertState('start', [AppState.Created]);",
    '    }',
    '',
    '    public async preloadModule(): Promise<void> {',
    "        this.assertState('preloadModule', [AppState.Started]);",
    "        const task = this.preloadTasks.get('module');",
    '        if (task) {',
    '            await task;',
    '        }',
    '    }',
    '',
    '    public async loadModule(): Promise<void> {',
    "        this.assertState('loadModule', [AppState.Started]);",
    '    }',
    '',
    '    public async enterModule(): Promise<void> {',
    "        this.assertState('enterModule', [AppState.Started]);",
    '    }',
    '',
    '    public async unloadModule(): Promise<void> {',
    "        this.assertState('unloadModule', [AppState.Started, AppState.Disposing]);",
    '    }',
    '',
    '    public async installExtension(): Promise<void> {',
    "        this.assertState('installExtension', [AppState.Created, AppState.Starting, AppState.Started]);",
    '    }',
    '',
    '    public use(): unknown {',
    "        this.assertState('use', [AppState.Starting, AppState.Started, AppState.Disposing]);",
    "        return 'token';",
    '    }',
    '',
    '    public useModuleToken(): unknown {',
    "        this.assertState('useModuleToken', [AppState.Started, AppState.Disposing]);",
    "        return 'module-token';",
    '    }',
    '',
    '    public async purgeResourceCache(): Promise<void> {',
    "        this.assertState('purgeResourceCache', [AppState.Started, AppState.Disposing]);",
    '    }',
    '',
    '    public async dispose(): Promise<void> {',
    "        this.assertState('dispose', [AppState.Created, AppState.Starting, AppState.Started, AppState.Failed]);",
    '        for (const task of Array.from(this.preloadTasks.values())) {',
    '            await task;',
    '        }',
    '        for (const task of Array.from(this.moduleTasks.values())) {',
    '            await task;',
    '        }',
    '    }',
    '',
    '    public snapshot(): AppRuntimeSnapshot {',
    '        return { state: this.appState };',
    '    }',
    '',
    '    private assertState(api: string, allowed: readonly AppState[]): void {',
    "        throw new Error('app.invalid_state');",
    '        void api;',
    '        void allowed;',
    '    }',
    '}',
    '',
  ].join('\n');
}

function toolchainResolverSmokeSource() {
  return [
    "'use strict';",
    '',
    'function resolveCocosEditorRoot() { return undefined; }',
    'function resolveCocosExecutable() { return undefined; }',
    'function resolveCocosBuildOutputPath() { return undefined; }',
    'function resolveCocosTypeScript() { return undefined; }',
    'function resolveCocosEngineRoot() { return undefined; }',
    'function resolveCocosEngineAssets() { return undefined; }',
    'function resolveCocosProjectSettings() { return undefined; }',
    'function resolveCocosTempAssembly() { return undefined; }',
    'function prepareTypecheckTsconfig() { return undefined; }',
    'function readCocosDashboardProfiles() { return []; }',
    'function dashboardEditorRootCandidates() { return []; }',
    'function runCocosBuild() { return { ok: true }; }',
    'function runTypecheck() { return { ok: true }; }',
    '',
    'module.exports = {',
    '  resolveCocosEditorRoot,',
    '  resolveCocosExecutable,',
    '  resolveCocosBuildOutputPath,',
    '  resolveCocosTypeScript,',
    '  resolveCocosEngineRoot,',
    '  resolveCocosEngineAssets,',
    '  resolveCocosProjectSettings,',
    '  resolveCocosTempAssembly,',
    '  prepareTypecheckTsconfig,',
    '  readCocosDashboardProfiles,',
    '  dashboardEditorRootCandidates,',
    '  runCocosBuild,',
    '  runTypecheck,',
    '};',
    '',
  ].join('\n');
}

function setupBaseline(projectRoot) {
  writeJson(projectRoot, 'tsconfig.json', { compilerOptions: {} });
  writeText(projectRoot, 'extensions/yzforge/editor/toolchain.js', toolchainResolverSmokeSource());
  writeText(projectRoot, 'extensions/yzforge/editor/cli.js', [
    "'use strict';",
    "const { runTypecheck } = require('./toolchain');",
    "if (process.argv[2] === 'typecheck') { runTypecheck(); }",
    '',
  ].join('\n'));
  writeText(projectRoot, 'extensions/yzforge/editor/generate.js', [
    "'use strict';",
    "const { yzforgePackageScripts } = require('./toolchain');",
    'void yzforgePackageScripts;',
    '',
  ].join('\n'));
  writeText(projectRoot, 'extensions/yzforge/editor/validate.js', [
    "'use strict';",
    "const { loadTypeScript: loadToolchainTypeScript } = require('./toolchain');",
    'void loadToolchainTypeScript;',
    '',
  ].join('\n'));
  writeText(projectRoot, 'extensions/yzforge/editor/smoke.js', [
    "'use strict';",
    "const { loadTypeScript: loadToolchainTypeScript } = require('./toolchain');",
    'void loadToolchainTypeScript;',
    '',
  ].join('\n'));
  writeRuntimeFixture(projectRoot);
  writeScriptMeta(projectRoot, 'assets/yzforge/runtime/screen-fitter.ts', SCREEN_FITTER_UUID);
  writeScriptMeta(projectRoot, 'assets/yzforge/runtime/full-screen-root.ts', FULL_SCREEN_ROOT_UUID);
  writeScriptMeta(projectRoot, 'assets/yzforge/runtime/safe-area-root.ts', SAFE_AREA_ROOT_UUID);
  writeText(projectRoot, 'assets/app/main/Main.ts', mainComponentSource());
  writeScriptMeta(projectRoot, 'assets/app/main/Main.ts', MAIN_SCRIPT_UUID);
  writeText(projectRoot, 'assets/app/main/Main.scene', serializedMainScene(MAIN_SCRIPT_UUID));
}

function createSmokeProject(projectRoot) {
  const created = [
    create(projectRoot, 'module', { name: 'Battle' }),
    create(projectRoot, 'library', { name: 'BattleCore' }),
    create(projectRoot, 'content-pack', { owner: 'Battle', name: 'Level001' }),
    create(projectRoot, 'view', { owner: 'Battle', name: 'PageBattle' }),
    create(projectRoot, 'global-view', { name: 'ToastNotice' }),
    create(projectRoot, 'part', { owner: 'Battle', name: 'PartReward' }),
    create(projectRoot, 'event-file', { owner: 'Battle', name: 'BattleStarted' }),
    create(projectRoot, 'extension-stub', { name: 'Analytics' }),
  ];

  writeText(projectRoot, 'assets/app/extensions/Analytics.ts', [
    "import { defineExtensionToken, defineModuleExtensionToken, type Extension, type ExtensionContext, type Module } from 'yzforge';",
    '',
    'export interface AnalyticsApi {',
    '    readonly name: string;',
    '}',
    '',
    'export interface AnalyticsModuleApi {',
    '    readonly moduleName: string;',
    '}',
    '',
    "export const AnalyticsToken = defineExtensionToken<AnalyticsApi>('Analytics');",
    "export const AnalyticsModuleToken = defineModuleExtensionToken<AnalyticsModuleApi>('Analytics.Module');",
    '',
    'class AnalyticsApiImpl implements AnalyticsApi {',
    "    public readonly name = 'Analytics';",
    '}',
    '',
    'class AnalyticsModuleApiImpl implements AnalyticsModuleApi {',
    '    public constructor(public readonly moduleName: string) {}',
    '}',
    '',
    'export const AnalyticsExtension: Extension = {',
    "    name: 'Analytics',",
    '    installBeforeStart(context: ExtensionContext): void {',
    '        context.provide(AnalyticsToken, new AnalyticsApiImpl());',
    '        context.provideModule(AnalyticsModuleToken, (module: Module) => new AnalyticsModuleApiImpl(module.name));',
    '    },',
    '};',
    '',
  ].join('\n'));

  updateJson(projectRoot, 'assets/modules/Battle/module.json', (descriptor) => {
    descriptor.libraries = ['BattleCore'];
  });
  updateJson(projectRoot, 'assets/content-packs/Battle/Level001/content-pack.json', (descriptor) => {
    descriptor.libraries = ['BattleCore'];
  });

  writeBundleMeta(projectRoot, 'assets/modules/Battle', 'yzforge-module-battle');
  writeBundleMeta(projectRoot, 'assets/libraries/BattleCore', 'yzforge-lib-battle-core');
  writeBundleMeta(projectRoot, 'assets/content-packs/Battle/Level001', 'yzforge-content-pack-battle-level001');

  writeText(projectRoot, 'assets/libraries/BattleCore/code/public.ts', [
    'export interface BattleRules {',
    '    readonly version: number;',
    '}',
    '',
    'export interface BattleCoreTokenMap {',
    '    readonly rules: BattleRules;',
    '}',
  ].join('\n'));
  writeText(projectRoot, 'assets/libraries/BattleCore/code/providers.ts', [
    "import { defineLibraryProviders } from 'yzforge';",
    "import type { BattleCoreTokenMap } from './public';",
    '',
    'export const providers = defineLibraryProviders<BattleCoreTokenMap>({',
    '    rules: () => ({ version: 1 }),',
    '});',
  ].join('\n'));

  writeText(projectRoot, 'assets/modules/Battle/code/runtime/LevelActor.ts', 'export class LevelActor {}');
  writeText(projectRoot, 'assets/libraries/BattleCore/code/SharedFx.ts', 'export class SharedFx {}');
  writeText(projectRoot, 'assets/libraries/BattleCore/res/runtime/Rules.json', '{"version":1}');
  writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/runtime/LevelData.json', '{"level":1}');
  writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/scene/LevelScene.scene', JSON.stringify([
    { __type__: 'cc.SceneAsset' },
  ], null, 2));
  writeXlsx(projectRoot, 'config-source/excel/BattleItems.xlsx', 'Items', [
    ['id', 'type', 'label', 'price', 'tags', 'enabled', 'serverOnly'],
    ['string', 'enum', 'string', 'number', 'string[]', 'boolean', 'string'],
    ['pk', 'client', 'client', 'client', 'client', 'optional', 'ignore'],
    ['Stable item id', 'Item category', 'Display name', 'Price', 'Tags', 'Feature switch', 'Server-only note'],
    ['sword', 'weapon', 'Sword', 10, 'sharp|metal', true, 'secret'],
    ['potion', 'consumable', 'Potion', 3, 'heal|drink', '', 'secret'],
  ]);
  writeXlsx(projectRoot, 'config-source/excel/Level001Enemies.xlsx', 'EnemyWaves', [
    ['id', 'enemy', 'count'],
    ['string', 'string', 'number'],
    ['pk', 'client', 'client'],
    undefined,
    ['wave1', 'slime', 3],
  ]);
  saveConfigPlanTable(projectRoot, {
    label: 'Battle Items',
    source: 'config-source/excel/BattleItems.xlsx',
    sheet: 'Items',
    table: 'item',
    scope: { kind: 'module', name: 'Battle' },
    format: 'json',
    generateKeys: true,
  });
  saveConfigPlanTable(projectRoot, {
    label: 'Level001 Enemy Waves',
    source: 'config-source/excel/Level001Enemies.xlsx',
    sheet: 'EnemyWaves',
    table: 'enemyWave',
    scope: { kind: 'content-pack', owner: 'Battle', name: 'Level001' },
    format: 'json',
    generateKeys: true,
  });

  const uuids = {
    pageBattle: '10000000-0000-4000-8000-000000000001',
    partReward: '10000000-0000-4000-8000-000000000002',
    levelActor: '10000000-0000-4000-8000-000000000003',
    sharedFx: '10000000-0000-4000-8000-000000000004',
    toastNotice: '10000000-0000-4000-8000-000000000005',
  };
  writeScriptMeta(projectRoot, 'assets/modules/Battle/code/view/PageBattle.ts', uuids.pageBattle);
  writeScriptMeta(projectRoot, 'assets/modules/Battle/code/part/PartReward.ts', uuids.partReward);
  writeScriptMeta(projectRoot, 'assets/modules/Battle/code/runtime/LevelActor.ts', uuids.levelActor);
  writeScriptMeta(projectRoot, 'assets/libraries/BattleCore/code/SharedFx.ts', uuids.sharedFx);
  writeScriptMeta(projectRoot, 'assets/app/global/code/view/ToastNotice.ts', uuids.toastNotice);

  writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab(uuids.pageBattle, [
    '@title:Label',
    '@confirm:Button',
  ]));
  writeText(projectRoot, 'assets/modules/Battle/res/part/PartReward.prefab', serializedPrefab(uuids.partReward, [
    '@amount:Label',
  ]));
  writeText(projectRoot, 'assets/app/global/res/view/ToastNotice.prefab', serializedPrefab(uuids.toastNotice, [
    '@message:Label',
  ]));
  writeText(projectRoot, 'assets/libraries/BattleCore/res/prefab/SharedFx.prefab', serializedPrefab(uuids.sharedFx));
  writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/prefab/LevelRoot.prefab', serializedPrefab(uuids.levelActor));

  return created;
}

function assertGeneratedOutput(projectRoot) {
  requireText(projectRoot, 'assets/modules/Battle/code/view/refs/PageBattle.refs.generated.ts', 'protected title!: Label;');
  requireText(projectRoot, 'assets/modules/Battle/code/view/refs/PageBattle.refs.generated.ts', "bindAutoRefComponent(this.node, 'confirm', Button)");
  requireText(projectRoot, 'assets/modules/Battle/code/part/refs/PartReward.refs.generated.ts', 'protected amount!: Label;');
  requireText(projectRoot, 'assets/app/global/code/view/refs/ToastNotice.refs.generated.ts', 'protected message!: Label;');
  requireText(projectRoot, 'assets/app/contracts/libraries/BattleCore.contract.generated.ts', 'export const BattleCoreTokens = defineLibraryTokens<BattleCoreTokenMap>');
  requireText(projectRoot, 'assets/libraries/BattleCore/code/generated/entry.ts', "import { providers } from '../providers';");
  requireText(projectRoot, 'assets/libraries/BattleCore/code/generated/entry.ts', 'tokens: providers,');
  requireText(projectRoot, 'assets/app/global/code/generated/assets.ts', "toastNotice: viewRef('Global', ToastNotice, 'res/view/ToastNotice'");
  requireText(projectRoot, 'assets/modules/Battle/code/generated/assets.ts', "pageBattle: viewRef('Battle', PageBattle, 'res/view/PageBattle'");
  requireText(projectRoot, 'assets/modules/Battle/code/generated/assets.ts', "partReward: partRef(PartReward, 'res/part/PartReward')");
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'export interface ItemRow {');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'export interface BattleConfigTables');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'export const BattleItemIds = {');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', "item: tableRef<ItemRow, 'id'>({ name: 'res/content/config/Item', primaryKey: 'id' })");
  requireText(projectRoot, 'assets/app/registry/modules/Battle.ref.generated.ts', 'defineModuleRef<BattleEnterParams>');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/content-packs.ts', 'export const BattleLevel001ContentPack = defineContentPack');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/content-packs.ts', "levelRoot: contentPackAssetRef(Prefab, 'res/prefab/LevelRoot')");
  requireText(projectRoot, 'assets/modules/Battle/code/generated/content-packs.ts', 'export interface EnemyWaveRow {');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/content-packs.ts', 'export const BattleLevel001EnemyWaveIds = {');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/content-packs.ts', "enemyWave: contentPackConfigRef<EnemyWaveRow>('res/content/config/EnemyWave', { primaryKey: 'id' })");
  requireText(projectRoot, 'assets/modules/Battle/code/generated/content-packs.ts', 'export interface BattleLevel001ContentPackConfigTables');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/content-packs.ts', 'defineContentPack<typeof BattleLevel001ContentPackRefs, BattleLevel001ContentPackConfigTables>');
  requireText(projectRoot, 'assets/app/bootstrap/install.generated.ts', 'AnalyticsExtension');
  requireText(projectRoot, 'assets/app/bootstrap/install.generated.ts', 'app.installExtension(AnalyticsExtension)');
  requireText(projectRoot, 'assets/app/extensions/Analytics.ts', 'AnalyticsModuleToken');

  const manifest = readJson(projectRoot, 'assets/content-packs/Battle/Level001/manifest.generated.json');
  assert(manifest.id === 'battle.level001', 'ContentPack manifest id mismatch.');
  assert(manifest.refs.levelRoot?.type === 'Prefab', 'ContentPack prefab ref missing from manifest.');
  assert(manifest.refs.levelData?.type === 'JsonAsset', 'ContentPack runtime json ref missing from manifest.');
  assert(manifest.refs.levelScene?.type === 'SceneAsset', 'ContentPack scene ref missing from manifest.');
  assert(manifest.refs.enemyWave?.kind === 'config', 'ContentPack config ref missing from manifest.');
  assert(manifest._generated?.hash, 'ContentPack manifest generated metadata missing hash.');
  assert(manifest._generated?.source === 'assets/content-packs/Battle/Level001/content-pack.json', 'ContentPack manifest generated source mismatch.');
}

function assertConfigBuildFromExcel(projectRoot) {
  const dashboard = configDashboard(projectRoot);
  assert(dashboard.sources.some((source) => source.source === 'config-source/excel/BattleItems.xlsx' && source.sheets.includes('Items')), 'Config dashboard must scan module xlsx sheets.');
  assert(dashboard.sources.some((source) => source.source === 'config-source/excel/Level001Enemies.xlsx' && source.sheets.includes('EnemyWaves')), 'Config dashboard must scan content pack xlsx sheets.');
  assert(dashboard.plan.tables.length === 2, 'Config plan must contain module and content-pack tables.');
  assert(dashboard.plan.tables.every((table) => /^cfg_[A-Za-z0-9_-]+$/.test(table.id)), 'Config plan tables must have stable ids.');
  assert(dashboard.plan.tables.some((table) => table.label === 'Battle Items'), 'Config plan tables must keep readable labels.');
  assert(dashboard.plan.tables.every((table) => table.row === undefined && table.primaryKey === undefined), 'Config plan must derive row type and primary key instead of storing editable fields.');
  const payload = readJson(projectRoot, 'assets/modules/Battle/res/content/config/Item.json');
  assert(payload._yzforgeConfig?.source === 'config-source/excel/BattleItems.xlsx', 'Generated config metadata must keep source.');
  assert(payload._yzforgeConfig?.fields.every((field) => field.name !== 'serverOnly'), 'Ignored config fields must not be exported.');
  assert(payload.rows.length === 2, 'Generated config must include data rows.');
  assert(payload.rows[0].price === 10, 'Generated config must convert numbers.');
  assert(Array.isArray(payload.rows[0].tags) && payload.rows[0].tags[1] === 'metal', 'Generated config must convert arrays.');
  assert(payload.rows[1].enabled === undefined, 'Optional empty config fields must be omitted.');
  const enemyPayload = readJson(projectRoot, 'assets/content-packs/Battle/Level001/res/content/config/EnemyWave.json');
  assert(enemyPayload._yzforgeConfig?.scope?.kind === 'content-pack', 'ContentPack config metadata must keep scope.');
  assert(enemyPayload.rows.length === 1, 'Config reader must preserve omitted physical rows instead of collapsing row numbers.');
  assert(enemyPayload.rows[0].count === 3, 'ContentPack config must convert numbers.');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'export interface ItemRow');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'readonly type: "consumable" | "weapon";');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'readonly price: number;');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'export const BattleItemIds = {');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', 'sword: "sword",');
  requireText(projectRoot, 'assets/modules/Battle/code/generated/config.ts', "item: tableRef<ItemRow, 'id'>({ name: 'res/content/config/Item', primaryKey: 'id' })");

  const moduleRule = dashboard.plan.tables.find((table) => table.scope?.kind === 'module' && table.scope?.name === 'Battle');
  assert(moduleRule?.id, 'Expected module config rule id.');
  const updatedRule = saveConfigPlanTable(projectRoot, {
    ...moduleRule,
    label: 'Battle Items Updated',
    generateKeys: false,
  });
  assert(updatedRule.table.id === moduleRule.id, 'Config rule update must preserve stable id.');
  assert(updatedRule.table.label === 'Battle Items Updated', 'Config rule update must persist readable label.');
  assert(configDashboard(projectRoot).plan.tables.length === 2, 'Config rule update by id must not duplicate plan tables.');
  saveConfigPlanTable(projectRoot, {
    ...moduleRule,
    label: 'Battle Items',
    generateKeys: true,
  });

  writeXlsx(projectRoot, 'config-source/excel/TempItems.xlsx', 'TempItems', [
    ['id', 'label'],
    ['string', 'string'],
    ['pk', 'client'],
    ['id', 'label'],
    ['temp', 'Temp'],
  ]);
  const tempRule = saveConfigPlanTable(projectRoot, {
    label: 'Temp Items',
    source: 'config-source/excel/TempItems.xlsx',
    sheet: 'TempItems',
    table: 'tempItem',
    scope: { kind: 'module', name: 'Battle' },
    format: 'json',
    generateKeys: true,
  });
  assert(tempRule.table.id, 'New config rules must receive stable ids.');
  assert(tempRule.table.label === 'Temp Items', 'New config rules must keep readable labels.');
  const deletedRule = deleteConfigPlanTable(projectRoot, { id: tempRule.table.id });
  assert(deletedRule.deleted?.id === tempRule.table.id, 'Config rule delete must report the deleted rule.');
  assert(configDashboard(projectRoot).plan.tables.length === 2, 'Config rule delete must remove exactly one plan table.');

  expectThrows(() => saveConfigPlanTable(projectRoot, {
    source: '../Bad.xlsx',
    sheet: 'Bad',
    table: 'bad',
    scope: { kind: 'module', name: 'Battle' },
    format: 'json',
    generateKeys: true,
  }), 'under config-source/excel');

  writeXlsx(projectRoot, 'config-source/excel/BadRules.xlsx', 'BadRules', [
    ['id', 'label'],
    ['string', 'string'],
    ['pk', 'server'],
    ['id', 'label'],
    ['bad', 'Bad'],
  ]);
  const badRule = saveConfigPlanTable(projectRoot, {
    source: 'config-source/excel/BadRules.xlsx',
    sheet: 'BadRules',
    table: 'badRule',
    scope: { kind: 'module', name: 'Battle' },
    format: 'json',
    generateKeys: true,
  });
  try {
    expectThrows(() => buildConfig(projectRoot), 'unsupported rule: server');
  } finally {
    deleteConfigPlanTable(projectRoot, { id: badRule.table.id });
  }

  writeXlsx(projectRoot, 'config-source/excel/BadIdRule.xlsx', 'BadIdRule', [
    ['id', 'label'],
    ['string', 'string'],
    ['client', 'client'],
    ['id', 'label'],
    ['bad', 'Bad'],
  ]);
  const badIdRule = saveConfigPlanTable(projectRoot, {
    source: 'config-source/excel/BadIdRule.xlsx',
    sheet: 'BadIdRule',
    table: 'badIdRule',
    scope: { kind: 'module', name: 'Battle' },
    format: 'json',
    generateKeys: true,
  });
  try {
    expectThrows(() => buildConfig(projectRoot), 'field id must be marked pk');
  } finally {
    deleteConfigPlanTable(projectRoot, { id: badIdRule.table.id });
  }

  writeJson(projectRoot, 'assets/modules/Battle/res/content/config/Obsolete.json', {
    _yzforgeConfig: {
      schemaVersion: 1,
      source: 'config-source/excel/Old.xlsx',
      sheet: 'Old',
      table: 'obsolete',
      row: 'ObsoleteRow',
      scope: { kind: 'module', name: 'Battle' },
      primaryKey: 'id',
      format: 'json',
      generateKeys: true,
      keyConst: 'BattleObsoleteIds',
      keyType: 'BattleObsoleteId',
      fields: [{ name: 'id', type: 'string', rules: ['pk'], comment: '' }],
    },
    rows: [],
  });
  const cleanup = buildConfig(projectRoot);
  assert(cleanup.changed.includes('assets/modules/Battle/res/content/config/Obsolete.json'), 'Config build must remove stale generated config payloads.');
  assert(!fs.existsSync(path.join(projectRoot, 'assets/modules/Battle/res/content/config/Obsolete.json')), 'Stale generated config payload must be deleted.');

  const check = buildConfig(projectRoot, { check: true });
  assert(check.ok, `Config check found stale files:\n${check.changed.join('\n')}`);
}

function assertOkValidation(projectRoot) {
  const result = validate(projectRoot, { strict: true });
  assert(result.ok, `Strict validate failed:\n${result.issues.join('\n')}`);
  return result;
}

function assertToolchainResolverInvariants() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const packageJson = readJson(projectRoot, 'package.json');
  const extensionPackage = readJson(projectRoot, 'extensions/yzforge/package.json');
  const toolchainSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/toolchain.js'), 'utf8');
  const cliSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/cli.js'), 'utf8');
  const aiSupportSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/ai-support.js'), 'utf8');
  const generateSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/generate.js'), 'utf8');
  const validateSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/validate.js'), 'utf8');
  const configPanelSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/panel/config.js'), 'utf8');
  const smokeSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/smoke.js'), 'utf8');
  const forbiddenCocosInstallPath = ['D:', '/Applications/Cocos'].join('');
  assert(packageJson.scripts?.typecheck === 'node extensions/yzforge/editor/cli.js typecheck', 'typecheck script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:config:table'] === 'node extensions/yzforge/editor/cli.js config-table', 'Config table script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:config:remove'] === 'node extensions/yzforge/editor/cli.js config-remove', 'Config remove script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:config:build'] === 'node extensions/yzforge/editor/cli.js config-build', 'Config build script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:config:check'] === 'node extensions/yzforge/editor/cli.js config-build --check', 'Config check script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:ai:context'] === 'node extensions/yzforge/editor/cli.js ai-context', 'AI context script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:ai:doctor'] === 'node extensions/yzforge/editor/cli.js ai-doctor', 'AI doctor script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:validate:build-matrix'] === 'node extensions/yzforge/editor/cli.js validate-build-matrix', 'BuildMatrixValidator script must route through YZForge CLI.');
  assert(packageJson.scripts?.['yzforge:cocos:build:web'] === 'node extensions/yzforge/editor/cli.js cocos-build --platform web-desktop --debug --output yzforge-build-matrix', 'Cocos web build script must route through YZForge CLI.');
  assert(extensionPackage.panels?.default?.main === 'editor/panel/index.js', 'YZForge Dashboard panel must stay separate.');
  assert(extensionPackage.panels?.create?.main === 'editor/panel/create.js', 'YZForge Create panel must stay separate.');
  assert(extensionPackage.panels?.config?.main === 'editor/panel/config.js', 'YZForge Config panel must stay separate.');
  assert(extensionPackage.contributions?.messages?.['open-create-panel']?.methods?.includes('openCreatePanel'), 'Create panel menu must open the Create panel.');
  assert(extensionPackage.contributions?.messages?.['open-config-panel']?.methods?.includes('openConfigPanel'), 'Config panel menu must open the Config panel.');
  assert(!configPanelSource.includes('config-format'), 'Config panel must not expose format selection before non-json export is implemented.');
  assert(toolchainSource.includes('resolveCocosEditorRoot'), 'ToolchainResolver must expose Cocos editor root resolution.');
  assert(toolchainSource.includes('resolveCocosExecutable'), 'ToolchainResolver must expose Cocos executable resolution.');
  assert(toolchainSource.includes('resolveCocosBuildOutputPath'), 'ToolchainResolver must expose Cocos build output path resolution.');
  assert(toolchainSource.includes('resolveCocosTypeScript'), 'ToolchainResolver must expose Cocos TypeScript resolution.');
  assert(toolchainSource.includes('resolveCocosEngineRoot'), 'ToolchainResolver must expose Cocos engine root resolution.');
  assert(toolchainSource.includes('resolveCocosEngineAssets'), 'ToolchainResolver must expose Cocos engine assets resolution.');
  assert(toolchainSource.includes('prepareTypecheckTsconfig'), 'ToolchainResolver must generate local typecheck tsconfig.');
  assert(toolchainSource.includes('readCocosDashboardProfiles'), 'ToolchainResolver must read Cocos Dashboard profiles.');
  assert(toolchainSource.includes('dashboardEditorRootCandidates'), 'ToolchainResolver must derive editor roots from Dashboard profiles.');
  assert(toolchainSource.includes('runCocosBuild'), 'ToolchainResolver must own Cocos build execution.');
  assert(toolchainSource.includes('runTypecheck'), 'ToolchainResolver must own typecheck execution.');
  assert(cliSource.includes("command === 'typecheck'") && cliSource.includes('runTypecheck'), 'CLI must route typecheck through ToolchainResolver.');
  assert(cliSource.includes("command === 'config-table'") && cliSource.includes('saveConfigPlanTable'), 'CLI must route config table registration through ConfigBuilder.');
  assert(cliSource.includes("'--label'"), 'CLI must support config table readable labels.');
  assert(cliSource.includes('rejectOptions') && cliSource.includes("'--primary-key'"), 'CLI must reject manually edited config primary keys.');
  assert(cliSource.includes("command === 'config-remove'") && cliSource.includes('deleteConfigPlanTable'), 'CLI must route config table deletion through ConfigBuilder.');
  assert(cliSource.includes("command === 'config-build'") && cliSource.includes('buildConfig'), 'CLI must route config build through ConfigBuilder.');
  assert(cliSource.includes("command === 'ai-context'") && cliSource.includes('writeAiContext'), 'CLI must route AI context generation.');
  assert(cliSource.includes("command === 'ai-doctor'") && cliSource.includes('runAiDoctor'), 'CLI must route AI doctor.');
  assert(aiSupportSource.includes('buildAiContext') && aiSupportSource.includes('.yzforge/ai-context.json'), 'AI support must generate machine-readable context.');
  assert(fs.existsSync(path.join(projectRoot, 'AGENTS.md')), 'AGENTS.md must exist for AI development rules.');
  assert(fs.existsSync(path.join(projectRoot, 'docs/ai/README.md')), 'docs/ai README must exist for AI task workflows.');
  assert(!generateSource.includes('resolveCocosEngineAssets') && !generateSource.includes(forbiddenCocosInstallPath), 'Generator must not write local Cocos engine paths into committed project config.');
  assert(validateSource.includes('loadToolchainTypeScript') && !validateSource.includes(forbiddenCocosInstallPath), 'Validator must load TypeScript through ToolchainResolver.');
  assert(smokeSource.includes('loadToolchainTypeScript') && !smokeSource.includes(forbiddenCocosInstallPath), 'Smoke must load TypeScript through ToolchainResolver.');
}

function assertDashboardProfileResolver() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yzforge-smoke-dashboard-profile-'));
  const previousEnv = {
    YZFORGE_COCOS_DASHBOARD_PROFILE: process.env.YZFORGE_COCOS_DASHBOARD_PROFILE,
    YZFORGE_COCOS_EDITOR_ROOT: process.env.YZFORGE_COCOS_EDITOR_ROOT,
    COCOS_EDITOR_ROOT: process.env.COCOS_EDITOR_ROOT,
    COCOS_CREATOR_ROOT: process.env.COCOS_CREATOR_ROOT,
    CREATOR_ROOT: process.env.CREATOR_ROOT,
  };
  try {
    writeJson(projectRoot, 'package.json', { creator: { version: '3.8.8' } });
    const fakeEditorRoot = path.join(projectRoot, 'dashboard-editors', 'Creator', '3.8.8');
    const fakeTypeScriptPath = [
      'resources',
      ['app.asar', 'unpacked'].join('.'),
      'node_modules',
      'typescript',
      'lib',
      'typescript.js',
    ].join('/');
    writeText(fakeEditorRoot, fakeTypeScriptPath, 'module.exports = {};');
    writeJson(projectRoot, 'profiles/dashboard.json', {
      editors: [
        {
          version: '3.8.7',
          path: path.join(projectRoot, 'dashboard-editors', 'Creator', '3.8.7'),
        },
        {
          version: '3.8.8',
          path: fakeEditorRoot,
        },
      ],
    });

    process.env.YZFORGE_COCOS_DASHBOARD_PROFILE = path.join(projectRoot, 'profiles/dashboard.json');
    process.env.YZFORGE_COCOS_EDITOR_ROOT = '';
    process.env.COCOS_EDITOR_ROOT = '';
    process.env.COCOS_CREATOR_ROOT = '';
    process.env.CREATOR_ROOT = '';

    const profiles = readCocosDashboardProfiles(projectRoot);
    assert(profiles.length === 1, 'ToolchainResolver must read the configured Dashboard profile.');
    const resolved = resolveCocosEditorRoot(projectRoot);
    assert(path.resolve(resolved) === path.resolve(fakeEditorRoot), 'ToolchainResolver must resolve Cocos editor root from Dashboard profile.');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    removeTempProject(projectRoot);
  }
}

function assertTypecheckConfigPortability(projectRoot) {
  const rootTsconfig = readJson(projectRoot, 'tsconfig.json');
  assert(rootTsconfig.extends === undefined, 'Root tsconfig must not extend Cocos temp config.');
  assert(rootTsconfig.compilerOptions?.baseUrl === undefined, 'Root tsconfig must not set deprecated baseUrl.');
  assert(rootTsconfig.compilerOptions?.moduleResolution === 'bundler', 'Root tsconfig must use bundler moduleResolution.');
  assert(rootTsconfig.compilerOptions?.paths?.['db://assets/*']?.[0] === './assets/*', 'Root tsconfig db://assets path must be explicit relative.');
  assert(rootTsconfig.compilerOptions?.paths?.['db://internal/*'] === undefined, 'Root tsconfig must not commit Cocos internal path.');

  const generatedTsconfigPath = prepareTypecheckTsconfig(projectRoot);
  const generatedRel = toPosix(path.relative(projectRoot, generatedTsconfigPath));
  assert(generatedRel === 'temp/yzforge/tsconfig.typecheck.json', 'Typecheck tsconfig must be generated under temp/yzforge.');
  const generated = JSON.parse(fs.readFileSync(generatedTsconfigPath, 'utf8'));
  assert(generated.extends === undefined, 'Generated typecheck tsconfig must be self-contained.');
  assert(generated.compilerOptions?.baseUrl === undefined, 'Generated typecheck tsconfig must not set deprecated baseUrl.');
  assert(generated.compilerOptions?.moduleResolution === 'bundler', 'Generated typecheck tsconfig must use bundler moduleResolution.');
  assert(generated.compilerOptions?.paths?.['db://assets/*']?.[0] === '../../assets/*', 'Generated typecheck config must rebase project paths relative to temp/yzforge.');
  assert(Array.isArray(generated.compilerOptions?.paths?.['db://internal/*']), 'Generated typecheck config must inject Cocos internal path at runtime.');
  assert(generated.files?.some((item) => toPosix(item).endsWith('/bin/.declarations/cc.d.ts')), 'Generated typecheck config must include Cocos cc declarations.');
  assert(generated.files?.some((item) => toPosix(item).endsWith('/@types/jsb.d.ts')), 'Generated typecheck config must include Cocos jsb declarations.');
  assert(generated.files?.some((item) => toPosix(item).endsWith('/temp/yzforge/declarations/cc.env.d.ts')), 'Generated typecheck config must include YZForge cc/env shim.');
}

function assertToolchainTemplate(projectRoot) {
  const gitignore = fs.readFileSync(path.join(projectRoot, '.yzforge/.gitignore'), 'utf8').replace(/\r\n?/g, '\n');
  assert(gitignore.includes('/toolchain.json'), '.yzforge/.gitignore must ignore local toolchain.json.');
  assert(gitignore.includes('!/toolchain.schema.json'), '.yzforge/.gitignore must keep toolchain schema tracked.');
  assert(gitignore.includes('!/toolchain.example.json'), '.yzforge/.gitignore must keep toolchain example tracked.');

  const schema = readJson(projectRoot, '.yzforge/toolchain.schema.json');
  assert(schema.additionalProperties === false, 'Toolchain schema must reject unknown top-level keys.');
  assert(schema.properties?.cocosEditorRoot?.type === 'string', 'Toolchain schema must document cocosEditorRoot.');
  assert(schema.properties?.cocosExecutable?.type === 'string', 'Toolchain schema must document cocosExecutable.');
  assert(schema.properties?.cocos?.properties?.editorRoot?.type === 'string', 'Toolchain schema must document nested cocos.editorRoot.');

  const example = readJson(projectRoot, '.yzforge/toolchain.example.json');
  assert(example.$schema === './toolchain.schema.json', 'Toolchain example must point at the local schema.');
  assert(example.cocosVersion === '3.8.8', 'Toolchain example must inherit the project Cocos version.');
  assert(example.cocosEditorRoot.includes('absolute path'), 'Toolchain example must use a placeholder, not a local machine path.');
}

function assertRuntimeLifecycleInvariants() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const appSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/app.ts'), 'utf8');
  const assetsSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/assets.ts'), 'utf8');
  const bundleSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/bundle-manager.ts'), 'utf8');
  const kernelSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/kernel.ts'), 'utf8');
  const lifecycleSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/lifecycle.ts'), 'utf8');
  const lifetimeSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/lifetime.ts'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/module.ts'), 'utf8');
  const navigatorSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/navigator.ts'), 'utf8');
  const librarySource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/library.ts'), 'utf8');
  const extensionRegistrySource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/extension-registry.ts'), 'utf8');
  const contentPackSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/content-pack.ts'), 'utf8');
  const runtimeIndexSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/index.ts'), 'utf8');
  const uiSource = fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/ui.ts'), 'utf8');
  const editorMainSource = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/editor/main.js'), 'utf8');
  const preloadBody = appSource.slice(appSource.indexOf('public async preloadModule'), appSource.indexOf('public async loadModule'));
  const enterBody = appSource.slice(appSource.indexOf('public async enterModule'), appSource.indexOf('public async unloadModule'));
  assert(appSource.includes('export enum AppState'), 'App must expose a public AppState enum.');
  assert(appSource.includes('private appState = AppState.Created'), 'App must store explicit AppState.');
  assert(appSource.includes("this.assertState('preloadModule', [AppState.Started])"), 'preloadModule must require Started App state.');
  assert(appSource.includes("this.assertState('back', [AppState.Started])"), 'back must require Started App state.');
  assert(appSource.includes("this.assertState('loadModule', [AppState.Started])"), 'loadModule must require Started App state.');
  assert(appSource.includes("this.assertState('enterModule', [AppState.Started])"), 'enterModule must require Started App state.');
  assert(appSource.includes("this.assertState('purgeResourceCache', [AppState.Started, AppState.Disposing])"), 'purgeResourceCache must require Started/Disposing App state.');
  assert(appSource.includes('purgeUnusedBundles'), 'App.purgeResourceCache must delegate to BundleManager.');
  assert(lifecycleSource.includes('Game.EVENT_SHOW') && lifecycleSource.includes('Game.EVENT_HIDE'), 'AppLifecycle must listen to Cocos Game foreground/background events.');
  assert(lifecycleSource.includes('Game.EVENT_LOW_MEMORY'), 'AppLifecycle must listen to Cocos low-memory events.');
  assert(appSource.includes("kernel.lifecycle.on('memory-warning'"), 'App must install a memory-warning cache purge policy.');
  assert(appSource.includes("type: 'memory_pressure'"), 'Memory-warning cache purge must use a structured memory_pressure reason.');
  assert(appSource.includes('memoryPressurePurgeTask'), 'Memory-warning cache purge must coalesce concurrent purge tasks.');
  assert(appSource.includes('Memory pressure cache purge failed.'), 'Memory-warning cache purge failures must be logged without breaking App state.');
  assert(appSource.includes("this.assertState('dispose', [AppState.Created, AppState.Starting, AppState.Started, AppState.Failed])"), 'dispose must accept Created/Starting/Started/Failed states.');
  assert(appSource.includes("'app.invalid_state'"), 'App state guard must report typed invalid-state errors.');
  assert(appSource.includes('state: this.appState'), 'App snapshot must expose current App state.');
  assert(appSource.includes('export interface AppFailureSnapshot'), 'App snapshot must expose structured failure diagnostics.');
  assert(appSource.includes('readonly lastFailure?: AppFailureSnapshot'), 'AppRuntimeSnapshot must include last failure diagnostics.');
  assert(appSource.includes('export interface ResourceDiagnosticsSnapshot'), 'App snapshot must expose structured resource diagnostics.');
  assert(appSource.includes('resourceDiagnostics: this.snapshotResourceDiagnostics'), 'App snapshot must include resource diagnostics.');
  assert(appSource.includes("'ownership.leak'"), 'Resource diagnostics must expose ownership leak details.');
  assert(appSource.includes("'bundle.cache_failed'"), 'Resource diagnostics must expose failed bundle cache details.');
  assert(lifetimeSource.includes('lastFailure?: ReleaseScopeFailureSnapshot'), 'ReleaseScope snapshots must expose release failure diagnostics.');
  assert(lifetimeSource.includes('scope.lastFailure'), 'OwnershipLedger must capture ReleaseScope failure diagnostics.');
  assert(editorMainSource.includes('withRuntimeResourceDetails'), 'Editor Runtime Snapshot must surface resource diagnostics as result details.');
  assert(appSource.includes('private readonly stateTransitions'), 'App must keep state transition evidence for failure diagnostics.');
  assert(appSource.includes('private setState('), 'App state transitions must go through a centralized recorder.');
  assert(appSource.includes('private recordFailure('), 'App must centralize failure snapshot recording.');
  assert(appSource.includes('transitions: this.stateTransitions.slice(transitionStart)'), 'App failure diagnostics must include state transition evidence.');
  for (const api of ['back', 'preloadModule', 'loadModule', 'enterModule', 'unloadModule', 'use', 'installExtension', 'useModuleToken', 'purgeResourceCache']) {
    assert(appSource.includes(`this.recordFailure('${api}'`), `App.${api} failures must update App failure diagnostics.`);
  }
  assert(appSource.includes('private readonly preloadTasks = new Map<string, Promise<ReleaseScope>>()'), 'App must track pending preload tasks explicitly.');
  assert(appSource.includes('const running = this.preloadTasks.get(ref.name)'), 'App.preloadModule must reuse pending preload tasks.');
  assert(appSource.indexOf('const running = this.preloadTasks.get(ref.name)') < appSource.indexOf('const existing = this.preloadScopes.get(ref.name)'), 'App.preloadModule must prefer pending preload tasks over optimistic preload scopes.');
  assert(appSource.includes('this.preloadTasks.set(ref.name, task)'), 'App.preloadModule must register pending preload tasks.');
  assert(appSource.includes('this.preloadTasks.delete(ref.name)'), 'App.preloadModule must clear completed preload tasks.');
  assert(appSource.includes('Array.from(this.preloadTasks.values())'), 'App.dispose must await pending preload tasks before runtime disposal.');
  assert(appSource.includes('Array.from(this.moduleTasks.values())'), 'App.dispose must await pending module load tasks before unloading modules.');
  assert(appSource.includes('moduleUnloadTasks'), 'App must keep module unload tasks idempotent.');
  assert(appSource.includes('module.unload_during_enter'), 'App must reject unloading a module while it is entering.');
  assert(appSource.includes('module.unload_failed'), 'App must aggregate module unload failures.');
  assert(appSource.includes('private readonly kernel: AppKernel'), 'App must keep runtime systems behind AppKernel.');
  assert(!appSource.includes('public readonly bundles') && !appSource.includes('public readonly extensions'), 'App must not expose runtime system registries as public fields.');
  assert(kernelSource.includes('export class AppKernel'), 'Runtime must define an AppKernel.');
  assert(!runtimeIndexSource.includes("export * from './kernel'"), 'Runtime public barrel must not expose AppKernel.');
  assert(lifetimeSource.includes('readonly leaks'), 'OwnershipLedger snapshot must expose leak evidence.');
  assert(lifetimeSource.includes('release.scope_failed'), 'ReleaseScope must aggregate release failures.');
  assert(assetsSource.includes('asset.release_failed'), 'AssetScope releaseAll must aggregate asset release failures.');
  assert(!assetsSource.includes('this.loaded.clear()'), 'AssetScope.releaseAll must not hide failed asset releases by clearing all loaded records.');
  assert(bundleSource.includes('BundleCachePolicy'), 'BundleManager must expose a bundle cache policy.');
  assert(bundleSource.includes('purgeUnusedBundles'), 'BundleManager must support explicit hot cache purge.');
  assert(bundleSource.includes('cacheState'), 'Bundle snapshots must expose cache state.');
  assert(preloadBody.includes('kernel.bundles.preloadBundle'), 'preloadModule must preload the module bundle through AppKernel.');
  assert(!preloadBody.includes('new entry.type') && !preloadBody.includes('__yzforgeCreate') && !preloadBody.includes('__yzforgeLoad'), 'preloadModule must not create or load Module instances.');
  assert(appSource.includes('instance = new ModuleType()'), 'loadModule/createModule must create Module instances.');
  assert(appSource.indexOf('await instance.__yzforgeCreate()') < appSource.indexOf('await instance.__yzforgeLoad()'), 'Module load must call onCreate before onLoad.');
  assert(enterBody.includes('this.kernel.navigator.enter') && !enterBody.includes('__yzforgeEnter'), 'App.enterModule must delegate enter lifecycle to ModuleNavigator through AppKernel.');
  assert(appSource.includes('public async back(): Promise<boolean>'), 'App must expose a narrow back navigation facade.');
  assert(appSource.includes('kernel.ui.installBackKeyHandler(async () => this.back())'), 'Hardware back handling must go through App.back.');
  assert(navigatorSource.includes('await target.instance.__yzforgeEnter(params)'), 'ModuleNavigator must call module onEnter.');
  assert(navigatorSource.includes('target.instance.state = ModuleState.Ready'), 'ModuleNavigator must roll back entering module state on enter failure.');
  assert(moduleSource.includes('module.lifecycle_unload_failed'), 'Module unload lifecycle must aggregate hook failures.');
  assert(moduleSource.includes('flow.onDispose'), 'Module unload must dispose flows.');
  assert(moduleSource.includes('service.onDispose'), 'Module unload must dispose services.');
  assert(moduleSource.includes('model.onDispose'), 'Module unload must dispose models.');
  assert(moduleSource.includes('module.onUnload'), 'Module unload must call onUnload after unit disposal.');
  assert(librarySource.includes('private acquireOwner'), 'LibraryRegistry must centralize owner acquisition.');
  assert(librarySource.includes('record.owners.has(ownerKey)'), 'Library owner acquisition must be idempotent per owner.');
  assert(appSource.includes('installExtension(extension: Extension)'), 'App must expose a narrow extension installation facade.');
  assert(appSource.includes('useModuleToken<TValue>'), 'App must expose a narrow module extension token facade.');
  assert(moduleSource.includes('this.app.useModuleToken(this, token)'), 'Module.use must not reach through App internals.');
  assert(!moduleSource.includes('this.app.extensions'), 'Module must not access App extension registry directly.');
  assert(extensionRegistrySource.includes('extension.phase_failed'), 'Extension phase failure must be wrapped with diagnostic context.');
  assert(extensionRegistrySource.includes('extension.dependency_missing'), 'Extension dependencies must fail when missing.');
  assert(extensionRegistrySource.includes('extension.dependency_cycle'), 'Extension dependency cycles must fail.');
  assert(extensionRegistrySource.includes('ExtensionTransaction'), 'ExtensionRegistry must use a transaction for phase side effects.');
  assert(extensionRegistrySource.includes('rollbackTransaction'), 'ExtensionRegistry must rollback phase token side effects.');
  assert(extensionRegistrySource.includes('disposeCompletedPhaseExtensions'), 'ExtensionRegistry must dispose completed phase extensions on rollback.');
  assert(extensionRegistrySource.includes('onLifecycleInTransaction'), 'ExtensionContext.onLifecycle must register lifecycle listeners through the transaction.');
  assert(extensionRegistrySource.includes('readonly lifecycleDisposers'), 'ExtensionTransaction must track lifecycle listener disposers.');
  assert(extensionRegistrySource.includes('registerConfigCodecInTransaction'), 'ExtensionContext.registerConfigCodec must register config codecs through the transaction.');
  assert(extensionRegistrySource.includes('readonly configCodecDisposers'), 'ExtensionTransaction must track config codec disposers.');
  assert(extensionRegistrySource.includes('disposeExtensionConfigCodecs'), 'ExtensionRegistry must remove config codecs during extension disposal.');
  assert(extensionRegistrySource.includes('registerAppServiceInTransaction'), 'ExtensionContext.registerAppService must register managed app services through the transaction.');
  assert(extensionRegistrySource.includes('readonly appServiceDisposers'), 'ExtensionTransaction must track app service disposers.');
  assert(extensionRegistrySource.includes('disposeExtensionAppServices'), 'ExtensionRegistry must remove app services during extension disposal.');
  assert(extensionRegistrySource.includes('registerSystemUIProviderInTransaction'), 'ExtensionContext.registerSystemUIProvider must register SystemUI providers through the transaction.');
  assert(extensionRegistrySource.includes('readonly systemUiProviderDisposers'), 'ExtensionTransaction must track SystemUI provider disposers.');
  assert(extensionRegistrySource.includes('disposeExtensionSystemUIProviders'), 'ExtensionRegistry must remove SystemUI providers during extension disposal.');
  assert(!extensionRegistrySource.includes('readonly lifecycle: App'), 'ExtensionContext must not expose raw AppLifecycle; use onLifecycle instead.');
  assert(extensionRegistrySource.includes('export interface ExtensionPhaseRollbackReason'), 'ExtensionRegistry must expose phase-specific rollback reason context.');
  assert(extensionRegistrySource.includes('rollbackBeforeStart'), 'Extension must expose a before-start phase rollback hook.');
  assert(extensionRegistrySource.includes('phaseRollbackHook'), 'ExtensionRegistry must select phase-specific rollback hooks.');
  assert(extensionRegistrySource.includes('rollbackHook.call(extension, this.createContext(phase, undefined, extension.name), rollbackReason)'), 'ExtensionRegistry must run phase-specific rollback hooks during phase rollback.');
  assert(extensionRegistrySource.includes('provideModule'), 'ExtensionContext must expose module-scoped token registration.');
  assert(extensionRegistrySource.includes('dependencyChain'), 'Extension failures must expose a dependency chain.');
  assert(contentPackSource.includes('manifest.generated'), 'ContentPack manifest.generated.json must be loaded at runtime.');
  assert(contentPackSource.includes('content_pack.manifest_mismatch'), 'ContentPack runtime must validate generated manifest identity.');
  assert(moduleSource.includes('readonly ui: ModuleUIAccess'), 'Module context must expose ModuleUI through the framework facade.');
  assert(assetsSource.includes("this.ledger?.acquire(this.owner, 'node'"), 'AssetScope must register tracked nodes in OwnershipLedger.');
  assert(assetsSource.includes("this.ledger?.release(this.owner, 'node'"), 'AssetScope must release tracked nodes from OwnershipLedger.');
  assert(fs.readFileSync(path.join(projectRoot, 'packages/yzforge-runtime/src/refs.ts'), 'utf8').includes('readonly owner: string;'), 'ViewRef must carry an owning scope.');
  assert(uiSource.includes('ui.view_owner_mismatch'), 'ModuleUI must reject opening foreign View refs.');
  assert(uiSource.includes("this.ownership?.acquire(this.owner, 'view'"), 'ModuleUI must register opened Views in OwnershipLedger.');
  assert(uiSource.includes("this.ownership?.release(this.owner, 'view'"), 'ModuleUI must release closed Views from OwnershipLedger.');
  assert(uiSource.includes('ui.view_lifecycle_close_failed'), 'View close lifecycle failures must be reported after result resolution.');
  assert(uiSource.includes('ui.view_close_failed'), 'ModuleUI.close must report close failures after cleanup.');
  assert(uiSource.includes('ui.close_owned_failed'), 'ModuleUI.closeOwned must aggregate failures and continue closing views.');
  assert(uiSource.includes('finally') && uiSource.includes('this.moduleUis.delete(moduleName)'), 'UIManager.disposeModule must remove ModuleUI even when dispose reports failures.');
  assert(uiSource.includes('this.resultResolver?.('), 'View close must resolve pending results.');
  assert(uiSource.indexOf('this.resultResolver?.(') < uiSource.indexOf("throw new YZForgeError('View close lifecycle completed with errors."), 'View close must resolve result before throwing lifecycle failures.');
  assert(!runtimeIndexSource.includes("export * from './bundle-manager'"), 'Runtime public barrel must not export every BundleManager symbol.');
  assert(!runtimeIndexSource.includes('BundleAssetAccess'), 'Runtime public barrel must not expose internal BundleAssetAccess.');
  assert(runtimeIndexSource.includes('BundleHandle'), 'Runtime public barrel must expose BundleHandle.');
}

function expectValidationIssue(projectRoot, expected) {
  const result = validate(projectRoot, { strict: true });
  assert(!result.ok, `Expected strict validate to fail with: ${expected}`);
  assert(result.issues.some((issue) => issue.includes(expected)), `Expected issue '${expected}', got:\n${result.issues.join('\n')}`);
  assert(
    result.issueDetails?.some((issue) => issue.message.includes(expected)),
    `Expected structured issue '${expected}', got:\n${JSON.stringify(result.issueDetails, null, 2)}`,
  );
  return result;
}

function removeTempProject(projectRoot) {
  const tmp = fs.realpathSync(os.tmpdir());
  const target = fs.realpathSync(projectRoot);
  assert(target.startsWith(tmp), `Refusing to remove non-temp smoke project: ${projectRoot}`);
  assert(path.basename(target).startsWith('yzforge-smoke-'), `Refusing to remove unexpected temp directory: ${projectRoot}`);
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

async function smoke(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yzforge-smoke-'));
  let completed = false;
  try {
    assertToolchainResolverInvariants();
    assertRuntimeLifecycleInvariants();
    await assertAppStateMachineBehavior();
    await assertReleaseScopeBehavior();
    await assertAssetReleasePolicyBehavior();
    await assertBundleCachePolicyBehavior();
    await assertLibraryOwnerAcquireBehavior();
    await assertExtensionRegistryBehavior();
    await assertViewResultCloseBehavior();
    assertDashboardProfileResolver();
    setupBaseline(projectRoot);
    const created = createSmokeProject(projectRoot);
    const configBuilt = buildConfig(projectRoot);
    assert(configBuilt.tables.length === 2, 'Expected config build to process two tables.');
    assert(configBuilt.changed.includes('assets/modules/Battle/res/content/config/Item.json'), 'Expected config build to write module config payload.');
    assert(configBuilt.changed.includes('assets/content-packs/Battle/Level001/res/content/config/EnemyWave.json'), 'Expected config build to write ContentPack config payload.');
    const generated = configBuilt.generated;
    assert(generated.modules === 1, 'Expected one generated module.');
    assert(generated.libraries === 1, 'Expected one generated library.');
    assert(generated.contentPacks === 1, 'Expected one generated ContentPack.');
    assert(generated.changed.length > 0, 'Expected initial generation to write files.');

    assertGeneratedOutput(projectRoot);
    assertTypecheckConfigPortability(projectRoot);
    assertToolchainTemplate(projectRoot);
    const check = generate(projectRoot, { check: true });
    assert(check.changed.length === 0, `Generate check found stale files:\n${check.changed.join('\n')}`);
    assertConfigBuildFromExcel(projectRoot);
    const validation = assertOkValidation(projectRoot);

    updateJson(projectRoot, '.yzforge/toolchain.example.json', (example) => {
      example.cocosVersion = '0.0.0';
    });
    const toolchainExampleViolation = expectValidationIssue(projectRoot, '.yzforge/toolchain.example.json must be generated from project Cocos version');
    const toolchainExampleDetail = toolchainExampleViolation.issueDetails.find((issue) => issue.message.includes('toolchain.example.json'));
    assert(toolchainExampleDetail.code === 'toolchain.template', 'Expected toolchain template issue code.');
    const toolchainExampleRepair = generate(projectRoot);
    assert(toolchainExampleRepair.changed.includes('.yzforge/toolchain.example.json'), 'Expected generate to repair toolchain example template.');
    assertOkValidation(projectRoot);

    writeAssemblyRecord(projectRoot, 'editor');
    writeAssemblyRecord(projectRoot, 'preview');
    const buildMatrix = validateBuildMatrix(projectRoot, { includeBuild: false });
    assert(buildMatrix.ok, `BuildMatrixValidator should pass valid editor/preview evidence:\n${buildMatrix.issues.join('\n')}`);
    writeAssemblyRecord(projectRoot, 'preview', {
      type: 'error',
      text: "Failed to resolve 'yzforge'",
    });
    const buildMatrixViolation = validateBuildMatrix(projectRoot, { includeBuild: false });
    assert(!buildMatrixViolation.ok, 'BuildMatrixValidator must fail unresolved preview YZForge import.');
    assert(buildMatrixViolation.issueDetails[0]?.code === 'cocos.import_resolution', 'Expected BuildMatrixValidator import resolution issue code.');
    assert(buildMatrixViolation.issueDetails[0]?.target === 'preview', 'Expected BuildMatrixValidator issue target.');
    writeAssemblyRecord(projectRoot, 'preview');
    writeText(projectRoot, 'build/web-desktop/assets/main.js', "console.log('build ok');");
    const buildArtifactMatrix = validateBuildMatrix(projectRoot);
    const buildArtifactTarget = buildArtifactMatrix.targets.find((item) => item.target === 'build:web-desktop');
    assert(buildArtifactMatrix.ok && buildArtifactTarget?.status === 'passed', 'BuildMatrixValidator must inspect clean build artifacts.');
    writeText(projectRoot, 'build/web-desktop/assets/main.js', "import { App } from 'yzforge';\nvoid App;");
    const buildArtifactViolation = validateBuildMatrix(projectRoot);
    const buildArtifactDetail = buildArtifactViolation.issueDetails.find((issue) => issue.code === 'build.bare_yzforge_import');
    assert(!buildArtifactViolation.ok, 'BuildMatrixValidator must fail build artifacts with bare YZForge imports.');
    assert(buildArtifactDetail?.target === 'build:web-desktop', 'Expected build artifact issue target.');
    writeText(projectRoot, 'build/web-desktop/assets/main.js', "console.log('build ok');");
    writeText(projectRoot, 'build/web-desktop/cocos-js/cc.js', 'exports({ MissingScript: module.dw });');
    assert(validateBuildMatrix(projectRoot).ok, 'BuildMatrixValidator must ignore Cocos engine MissingScript symbol exports.');
    writeText(projectRoot, 'build/web-desktop/assets/main/missing-script.json', '{"__type__":"cc.MissingScript"}');
    const missingScriptViolation = validateBuildMatrix(projectRoot);
    const missingScriptDetail = missingScriptViolation.issueDetails.find((issue) => issue.code === 'build.missing_script');
    assert(!missingScriptViolation.ok, 'BuildMatrixValidator must fail serialized MissingScript artifacts.');
    assert(missingScriptDetail?.target === 'build:web-desktop', 'Expected MissingScript issue target.');
    fs.unlinkSync(path.join(projectRoot, 'build/web-desktop/assets/main/missing-script.json'));

    updateJson(projectRoot, 'assets/content-packs/Battle/Level001/manifest.generated.json', (manifest) => {
      manifest._generated.hash = '0000000000000000';
    });
    const generatedJsonViolation = expectValidationIssue(projectRoot, 'manifest.generated.json generated hash mismatch');
    const generatedJsonDetail = generatedJsonViolation.issueDetails.find((issue) => issue.message.includes('manifest.generated.json generated hash mismatch'));
    assert(generatedJsonDetail.code === 'generated.hash_mismatch', 'Expected generated JSON hash issue code.');
    const manifestRepair = generate(projectRoot);
    assert(manifestRepair.changed.includes('assets/content-packs/Battle/Level001/manifest.generated.json'), 'Expected generate to repair ContentPack manifest hash.');
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/app/extensions/BadAppMutation.ts', [
      "import type { Extension, ExtensionContext } from 'yzforge';",
      '',
      'export const BadAppMutationExtension: Extension = {',
      "    name: 'BadAppMutation',",
      '    installBeforeStart(context: ExtensionContext): void {',
      '        (context.app as unknown as { audio?: unknown }).audio = {};',
      '    },',
      '};',
      '',
    ].join('\n'));
    const extensionMutationViolation = expectValidationIssue(projectRoot, 'Extension must not mutate App fields');
    const extensionMutationDetail = extensionMutationViolation.issueDetails.find((issue) => issue.message.includes('Extension must not mutate App fields'));
    assert(extensionMutationDetail.code === 'extension.app_mutation', 'Expected Extension app mutation issue code.');
    fs.unlinkSync(path.join(projectRoot, 'assets/app/extensions/BadAppMutation.ts'));
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/app/extensions/BadAppInternalAccess.ts', [
      "import type { Extension, ExtensionContext } from 'yzforge';",
      '',
      'export const BadAppInternalAccessExtension: Extension = {',
      "    name: 'BadAppInternalAccess',",
      '    installBeforeStart(context: ExtensionContext): void {',
      '        void context.app.extensions;',
      '    },',
      '};',
      '',
    ].join('\n'));
    const appInternalViolation = expectValidationIssue(projectRoot, "must not access App internal field 'extensions'");
    const appInternalDetail = appInternalViolation.issueDetails.find((issue) => issue.message.includes("App internal field 'extensions'"));
    assert(appInternalDetail.code === 'app.internal_access', 'Expected App internal access issue code.');
    assert(appInternalDetail.field === 'extensions', 'Expected App internal access field.');
    fs.unlinkSync(path.join(projectRoot, 'assets/app/extensions/BadAppInternalAccess.ts'));
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/app/extensions/BadInternalImport.ts', [
      "import { LevelActor } from '../../modules/Battle/code/runtime/LevelActor';",
      "import type { Extension } from 'yzforge';",
      '',
      'export const BadInternalImportExtension: Extension = {',
      "    name: 'BadInternalImport',",
      '    installBeforeStart(): void {',
      '        void LevelActor;',
      '    },',
      '};',
      '',
    ].join('\n'));
    const extensionImportViolation = expectValidationIssue(projectRoot, 'extension code must not import module internal path');
    const extensionImportDetail = extensionImportViolation.issueDetails.find((issue) => issue.message.includes('extension code must not import module internal path'));
    assert(extensionImportDetail.code === 'import.boundary', 'Expected Extension import boundary issue code.');
    assert(extensionImportDetail.path === 'assets/app/extensions/BadInternalImport.ts', 'Expected Extension import boundary path.');
    fs.unlinkSync(path.join(projectRoot, 'assets/app/extensions/BadInternalImport.ts'));
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/modules/Battle/module.json', (descriptor) => {
      descriptor.name = 'WrongBattle';
    });
    const modulePathViolation = expectValidationIssue(projectRoot, "descriptor path must be 'assets/modules/WrongBattle/module.json'");
    const modulePathDetail = modulePathViolation.issueDetails.find((issue) => issue.message.includes('assets/modules/WrongBattle/module.json'));
    assert(modulePathDetail.code === 'descriptor.path_mismatch', 'Expected module descriptor path issue code.');
    updateJson(projectRoot, 'assets/modules/Battle/module.json', (descriptor) => {
      descriptor.name = 'Battle';
    });
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/libraries/BattleCore/library.json', (descriptor) => {
      descriptor.name = 'WrongBattleCore';
    });
    const libraryPathViolation = expectValidationIssue(projectRoot, "descriptor path must be 'assets/libraries/WrongBattleCore/library.json'");
    const libraryPathDetail = libraryPathViolation.issueDetails.find((issue) => issue.message.includes('assets/libraries/WrongBattleCore/library.json'));
    assert(libraryPathDetail.code === 'descriptor.path_mismatch', 'Expected library descriptor path issue code.');
    updateJson(projectRoot, 'assets/libraries/BattleCore/library.json', (descriptor) => {
      descriptor.name = 'BattleCore';
    });
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/content-packs/Battle/Level001/content-pack.json', (descriptor) => {
      descriptor.owner = 'WrongBattle';
    });
    const packPathViolation = expectValidationIssue(projectRoot, "descriptor path must be 'assets/content-packs/WrongBattle/Level001/content-pack.json'");
    const packPathDetail = packPathViolation.issueDetails.find((issue) => issue.message.includes('assets/content-packs/WrongBattle/Level001/content-pack.json'));
    assert(packPathDetail.code === 'descriptor.path_mismatch', 'Expected ContentPack descriptor path issue code.');
    updateJson(projectRoot, 'assets/content-packs/Battle/Level001/content-pack.json', (descriptor) => {
      descriptor.owner = 'Battle';
    });
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'tsconfig.json', (tsconfig) => {
      tsconfig.compilerOptions.paths.yzforge = ['extensions/yzforge/runtime-template/index.ts'];
    });
    const tsconfigPathViolation = expectValidationIssue(projectRoot, 'tsconfig.json paths.yzforge must be ["./packages/yzforge-runtime/src/index.ts"]');
    const tsconfigPathDetail = tsconfigPathViolation.issueDetails.find((issue) => issue.message.includes('paths.yzforge'));
    assert(tsconfigPathDetail.code === 'path_map.tsconfig', 'Expected tsconfig path map issue code.');
    const tsconfigRepair = generate(projectRoot);
    assert(tsconfigRepair.changed.includes('tsconfig.json'), 'Expected generate to repair tsconfig path map.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'tsconfig.json', (tsconfig) => {
      tsconfig.extends = './temp/tsconfig.cocos.json';
      tsconfig.compilerOptions.types = ['./temp/declarations/cc'];
      tsconfig.compilerOptions.moduleResolution = 'node';
    });
    const tempTsconfigViolation = expectValidationIssue(projectRoot, 'tsconfig.json must not extend Cocos temp config');
    const tempTsconfigDetail = tempTsconfigViolation.issueDetails.find((issue) => issue.message.includes('must not extend Cocos temp config'));
    assert(tempTsconfigDetail.code === 'path_map.tsconfig_portability', 'Expected tsconfig portability issue code.');
    const moduleResolutionDetail = tempTsconfigViolation.issueDetails.find((issue) => issue.message.includes("compilerOptions.moduleResolution must be 'bundler'"));
    assert(moduleResolutionDetail.code === 'path_map.tsconfig_module_resolution', 'Expected moduleResolution issue code.');
    const tempTsconfigRepair = generate(projectRoot);
    assert(tempTsconfigRepair.changed.includes('tsconfig.json'), 'Expected generate to remove Cocos temp tsconfig dependency.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'tsconfig.json', (tsconfig) => {
      tsconfig.compilerOptions.paths['db://assets/*'] = [`${toPosix(projectRoot)}/assets/*`];
    });
    const absoluteAssetsPathViolation = expectValidationIssue(projectRoot, 'tsconfig.json paths.db://assets/* must be ["./assets/*"]');
    const absoluteAssetsPathDetail = absoluteAssetsPathViolation.issueDetails.find((issue) => issue.message.includes('paths.db://assets/* must be'));
    assert(absoluteAssetsPathDetail.code === 'path_map.tsconfig', 'Expected project-relative db://assets path map issue code.');
    const absoluteAssetsPathRepair = generate(projectRoot);
    assert(absoluteAssetsPathRepair.changed.includes('tsconfig.json'), 'Expected generate to repair absolute db://assets path.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'tsconfig.json', (tsconfig) => {
      tsconfig.compilerOptions.paths['db://internal/*'] = [[
        'D:',
        '/Applications/Cocos/Editor/Creator/0.0.0/',
        'resources',
        '/resources/3d/engine/editor/assets/*',
      ].join('')];
    });
    const cocosInternalPathViolation = expectValidationIssue(projectRoot, 'tsconfig.json must not commit paths.db://internal/*');
    const cocosInternalPathDetail = cocosInternalPathViolation.issueDetails.find((issue) => issue.message.includes('must not commit paths.db://internal/*'));
    assert(cocosInternalPathDetail.code === 'path_map.tsconfig_portability', 'Expected Cocos internal portability issue code.');
    assert(cocosInternalPathDetail.target === 'db://internal/*', 'Expected Cocos internal path map target.');
    const cocosInternalPathRepair = generate(projectRoot);
    assert(cocosInternalPathRepair.changed.includes('tsconfig.json'), 'Expected generate to remove Cocos internal path map.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'import-map.json', (importMap) => {
      importMap.imports.yzforge = './extensions/yzforge/runtime-template/index';
    });
    const importMapViolation = expectValidationIssue(projectRoot, "import-map.json imports.yzforge must be './assets/yzforge/runtime/index.ts'");
    const importMapDetail = importMapViolation.issueDetails.find((issue) => issue.message.includes('imports.yzforge'));
    assert(importMapDetail.code === 'path_map.import_map', 'Expected import-map path issue code.');
    const importMapRepair = generate(projectRoot);
    assert(importMapRepair.changed.includes('import-map.json'), 'Expected generate to repair import-map path.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'package.json', (packageJson) => {
      packageJson.name = 'yzforge';
      packageJson.exports = { '.': './assets/yzforge/runtime/index.ts' };
    });
    const packageJsonViolation = expectValidationIssue(projectRoot, "package.json name must not be 'yzforge'");
    const packageJsonDetail = packageJsonViolation.issueDetails.find((issue) => issue.message.includes("name must not be 'yzforge'"));
    assert(packageJsonDetail.code === 'path_map.package_json', 'Expected package.json path map issue code.');
    const packageJsonExportDetail = packageJsonViolation.issueDetails.find((issue) => issue.message.includes('must not export YZForge runtime paths'));
    assert(packageJsonExportDetail.code === 'path_map.package_json', 'Expected package.json exports issue code.');
    const packageJsonRepair = generate(projectRoot);
    assert(packageJsonRepair.changed.includes('package.json'), 'Expected generate to repair package.json package boundary.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'package.json', (packageJson) => {
      packageJson.scripts.typecheck = ['node ', 'D:', '/Applications/Cocos/tsc.js'].join('');
    });
    const typecheckScriptViolation = expectValidationIssue(projectRoot, "package.json scripts.typecheck must be 'node extensions/yzforge/editor/cli.js typecheck'");
    const typecheckScriptDetail = typecheckScriptViolation.issueDetails.find((issue) => issue.message.includes('scripts.typecheck'));
    assert(typecheckScriptDetail.code === 'toolchain.script', 'Expected ToolchainResolver script issue code.');
    const typecheckScriptRepair = generate(projectRoot);
    assert(typecheckScriptRepair.changed.includes('package.json'), 'Expected generate to repair typecheck script.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'settings/v2/packages/project.json', (settings) => {
      settings.script.importMap = 'import-map.json';
    });
    const projectSettingsViolation = expectValidationIssue(projectRoot, "settings/v2/packages/project.json script.importMap must be 'project://import-map.json'");
    const projectSettingsDetail = projectSettingsViolation.issueDetails.find((issue) => issue.message.includes('script.importMap'));
    assert(projectSettingsDetail.code === 'path_map.project_settings', 'Expected Cocos project import-map setting issue code.');
    const projectSettingsRepair = generate(projectRoot);
    assert(projectSettingsRepair.changed.includes('settings/v2/packages/project.json'), 'Expected generate to repair Cocos project import-map setting.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'tsconfig.json', (tsconfig) => {
      tsconfig.compilerOptions.paths['yzforge/*'] = ['assets/yzforge/runtime/*'];
    });
    const tsconfigDeepAliasViolation = expectValidationIssue(projectRoot, 'tsconfig.json must not expose runtime deep path alias yzforge/*');
    const tsconfigDeepAliasDetail = tsconfigDeepAliasViolation.issueDetails.find((issue) => issue.message.includes('runtime deep path alias yzforge/*'));
    assert(tsconfigDeepAliasDetail.code === 'path_map.runtime_deep_alias', 'Expected tsconfig runtime deep alias issue code.');
    const tsconfigDeepAliasRepair = generate(projectRoot);
    assert(tsconfigDeepAliasRepair.changed.includes('tsconfig.json'), 'Expected generate to remove runtime deep tsconfig alias.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'tsconfig.json', (tsconfig) => {
      tsconfig.compilerOptions.paths['yzforge-contracts/modules/*'] = ['assets/app/contracts/modules/*.contract.generated.ts'];
    });
    const legacyTsAliasViolation = expectValidationIssue(projectRoot, 'tsconfig.json must not expose legacy alias yzforge-contracts/modules/*');
    const legacyTsAliasDetail = legacyTsAliasViolation.issueDetails.find((issue) => issue.message.includes('legacy alias yzforge-contracts/modules/*'));
    assert(legacyTsAliasDetail.code === 'path_map.legacy_alias', 'Expected legacy tsconfig alias issue code.');
    const legacyTsAliasRepair = generate(projectRoot);
    assert(legacyTsAliasRepair.changed.includes('tsconfig.json'), 'Expected generate to remove legacy tsconfig alias.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'import-map.json', (importMap) => {
      importMap.imports['yzforge/'] = './assets/yzforge/runtime/';
    });
    const importMapDeepAliasViolation = expectValidationIssue(projectRoot, 'import-map.json must not expose runtime deep path prefix yzforge/');
    const importMapDeepAliasDetail = importMapDeepAliasViolation.issueDetails.find((issue) => issue.message.includes('runtime deep path prefix yzforge/'));
    assert(importMapDeepAliasDetail.code === 'path_map.runtime_deep_alias', 'Expected import-map runtime deep alias issue code.');
    const importMapDeepAliasRepair = generate(projectRoot);
    assert(importMapDeepAliasRepair.changed.includes('import-map.json'), 'Expected generate to remove runtime deep import-map prefix.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'import-map.json', (importMap) => {
      importMap.imports['yzforge-contracts/'] = './assets/app/contracts/';
    });
    const legacyImportMapAliasViolation = expectValidationIssue(projectRoot, 'import-map.json must not expose legacy alias yzforge-contracts/');
    const legacyImportMapAliasDetail = legacyImportMapAliasViolation.issueDetails.find((issue) => issue.message.includes('legacy alias yzforge-contracts/'));
    assert(legacyImportMapAliasDetail.code === 'path_map.legacy_alias', 'Expected legacy import-map alias issue code.');
    const legacyImportMapAliasRepair = generate(projectRoot);
    assert(legacyImportMapAliasRepair.changed.includes('import-map.json'), 'Expected generate to remove legacy import-map alias.');
    assertOkValidation(projectRoot);

    writeJson(projectRoot, 'temp/programming/packer-driver/targets/editor/assembly-record.json', {
      chunks: {
        brokenChunk: {
          imports: {
            yzforge: {
              resolved: {
                type: 'error',
                text: "Failed to resolve 'yzforge'",
              },
              messages: [],
            },
          },
        },
      },
    });
    const cocosResolutionViolation = expectValidationIssue(projectRoot, 'Cocos editor assembly cannot resolve YZForge import');
    const cocosResolutionDetail = cocosResolutionViolation.issueDetails.find((issue) => issue.message.includes('Cocos editor assembly'));
    assert(cocosResolutionDetail.code === 'cocos.import_resolution', 'Expected Cocos import resolution issue code.');
    assert(cocosResolutionDetail.path === 'temp/programming/packer-driver/targets/editor/assembly-record.json', 'Expected Cocos import resolution path.');
    fs.rmSync(path.join(projectRoot, 'temp'), { recursive: true, force: true });
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/modules/Battle/code/BadRuntimeDeepImport.ts', [
      "import type { BundleAssetAccess } from 'yzforge/bundle-manager';",
      '',
      'export interface BadRuntimeDeepImport {',
      '    readonly bundle: BundleAssetAccess;',
      '}',
      '',
    ].join('\n'));
    const runtimeDeepImportViolation = expectValidationIssue(projectRoot, "must import YZForge runtime through 'yzforge'");
    const runtimeDeepImportDetail = runtimeDeepImportViolation.issueDetails.find((issue) => issue.message.includes("must import YZForge runtime through 'yzforge'"));
    assert(runtimeDeepImportDetail.code === 'import.boundary', 'Expected runtime deep import issue code.');
    assert(runtimeDeepImportDetail.specifier === 'yzforge/bundle-manager', 'Expected runtime deep import specifier.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/BadRuntimeDeepImport.ts'));
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/modules/Battle/code/BadRuntimePhysicalImport.ts', [
      "import { Module } from '../../../yzforge/runtime';",
      '',
      'export class BadRuntimePhysicalImport extends Module {}',
      '',
    ].join('\n'));
    const runtimePhysicalImportViolation = expectValidationIssue(projectRoot, "must import YZForge runtime through 'yzforge'");
    const runtimePhysicalImportDetail = runtimePhysicalImportViolation.issueDetails.find((issue) => issue.message.includes("must import YZForge runtime through 'yzforge'"));
    assert(runtimePhysicalImportDetail.code === 'import.boundary', 'Expected runtime physical import issue code.');
    assert(runtimePhysicalImportDetail.specifier === '../../../yzforge/runtime', 'Expected runtime physical import specifier.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/BadRuntimePhysicalImport.ts'));
    assertOkValidation(projectRoot);

    fs.mkdirSync(path.join(projectRoot, 'assets/modules/Orphan/res'), { recursive: true });
    const orphanViolation = expectValidationIssue(projectRoot, 'module:Orphan scope directory is missing module.json');
    const orphanDetail = orphanViolation.issueDetails.find((issue) => issue.message.includes('module:Orphan'));
    assert(orphanDetail.code === 'scope.descriptor_missing', 'Expected orphan scope issue code.');
    fs.rmSync(path.join(projectRoot, 'assets/modules/Orphan'), { recursive: true, force: true });
    assertOkValidation(projectRoot);

    const runtimeTemplateIndexOriginal = fs.readFileSync(path.join(projectRoot, 'extensions/yzforge/runtime-template/index.ts'), 'utf8');
    writeText(projectRoot, 'extensions/yzforge/runtime-template/index.ts', 'export const drift = true;');
    const runtimeDriftViolation = expectValidationIssue(projectRoot, 'Runtime template file differs from runtime source package');
    const runtimeDriftDetail = runtimeDriftViolation.issueDetails.find((issue) => issue.message.includes('Runtime template file differs from runtime source package'));
    assert(runtimeDriftDetail.code === 'runtime.package_drift', 'Expected runtime package drift issue code.');
    writeText(projectRoot, 'extensions/yzforge/runtime-template/index.ts', runtimeTemplateIndexOriginal);
    assertOkValidation(projectRoot);

    const extensionRegistryRels = [
      'packages/yzforge-runtime/src/extension-registry.ts',
      'assets/yzforge/runtime/extension-registry.ts',
      'extensions/yzforge/runtime-template/extension-registry.ts',
    ];
    const extensionRegistryOriginals = new Map(extensionRegistryRels.map((rel) => [
      rel,
      fs.readFileSync(path.join(projectRoot, rel), 'utf8'),
    ]));
    for (const rel of extensionRegistryRels) {
      updateText(projectRoot, rel, (content) => {
        const updated = content.replace(
          '? this.provideInTransaction(transaction, token, value)',
          '? this.provide(token, value)',
        );
        assert(updated !== content, `Expected to mutate ${rel} ExtensionContext.provide transaction route.`);
        return updated;
      });
    }
    const extensionTransactionRouteViolation = expectValidationIssue(projectRoot, 'ExtensionContext.provide must route through provideInTransaction');
    const extensionTransactionRouteDetail = extensionTransactionRouteViolation.issueDetails.find((issue) => issue.message.includes('ExtensionContext.provide must route through provideInTransaction'));
    assert(extensionTransactionRouteDetail.code === 'extension.transaction', 'Expected ExtensionContext transaction route issue code.');
    for (const [rel, content] of extensionRegistryOriginals) {
      writeText(projectRoot, rel, content);
    }
    assertOkValidation(projectRoot);

    for (const rel of extensionRegistryRels) {
      updateText(projectRoot, rel, (content) => {
        const updated = content.replace(
          '? this.registerAppServiceInTransaction(transaction, extensionName, token, value, options)',
          '? this.registerAppServiceForExtension(extensionName, token, value, options)',
        );
        assert(updated !== content, `Expected to mutate ${rel} ExtensionContext.registerAppService transaction route.`);
        return updated;
      });
    }
    const extensionServiceRouteViolation = expectValidationIssue(projectRoot, 'ExtensionContext.registerAppService must route through registerAppServiceInTransaction');
    const extensionServiceRouteDetail = extensionServiceRouteViolation.issueDetails.find((issue) => issue.message.includes('ExtensionContext.registerAppService must route through registerAppServiceInTransaction'));
    assert(extensionServiceRouteDetail.code === 'extension.transaction', 'Expected ExtensionContext service transaction route issue code.');
    for (const [rel, content] of extensionRegistryOriginals) {
      writeText(projectRoot, rel, content);
    }
    assertOkValidation(projectRoot);

    for (const rel of extensionRegistryRels) {
      updateText(projectRoot, rel, (content) => {
        const updated = content.replace(
          '? this.registerSystemUIProviderInTransaction(transaction, extensionName, provider)',
          '? this.registerSystemUIProviderForExtension(extensionName, provider)',
        );
        assert(updated !== content, `Expected to mutate ${rel} ExtensionContext.registerSystemUIProvider transaction route.`);
        return updated;
      });
    }
    const extensionSystemUIRouteViolation = expectValidationIssue(projectRoot, 'ExtensionContext.registerSystemUIProvider must route through registerSystemUIProviderInTransaction');
    const extensionSystemUIRouteDetail = extensionSystemUIRouteViolation.issueDetails.find((issue) => issue.message.includes('ExtensionContext.registerSystemUIProvider must route through registerSystemUIProviderInTransaction'));
    assert(extensionSystemUIRouteDetail.code === 'extension.transaction', 'Expected ExtensionContext SystemUI provider transaction route issue code.');
    for (const [rel, content] of extensionRegistryOriginals) {
      writeText(projectRoot, rel, content);
    }
    assertOkValidation(projectRoot);

    for (const rel of extensionRegistryRels) {
      updateText(projectRoot, rel, (content) => {
        const updated = content.replace(
          '? this.onLifecycleInTransaction(transaction, extensionName, event, handler)',
          '? this.app.lifecycle.on(event, handler)',
        );
        assert(updated !== content, `Expected to mutate ${rel} ExtensionContext.onLifecycle transaction route.`);
        return updated;
      });
    }
    const extensionLifecycleRouteViolation = expectValidationIssue(projectRoot, 'ExtensionContext.onLifecycle must route through onLifecycleInTransaction');
    const extensionLifecycleRouteDetail = extensionLifecycleRouteViolation.issueDetails.find((issue) => issue.message.includes('ExtensionContext.onLifecycle must route through onLifecycleInTransaction'));
    assert(extensionLifecycleRouteDetail.code === 'extension.transaction', 'Expected ExtensionContext lifecycle transaction route issue code.');
    for (const [rel, content] of extensionRegistryOriginals) {
      writeText(projectRoot, rel, content);
    }
    assertOkValidation(projectRoot);

    for (const rel of extensionRegistryRels) {
      updateText(projectRoot, rel, (content) => {
        const updated = content.replace(
          '? this.registerConfigCodecInTransaction(transaction, extensionName, codec)',
          '? configCodecs.register(codec)',
        );
        assert(updated !== content, `Expected to mutate ${rel} ExtensionContext.registerConfigCodec transaction route.`);
        return updated;
      });
    }
    const extensionConfigCodecRouteViolation = expectValidationIssue(projectRoot, 'ExtensionContext.registerConfigCodec must route through registerConfigCodecInTransaction');
    const extensionConfigCodecRouteDetail = extensionConfigCodecRouteViolation.issueDetails.find((issue) => issue.message.includes('ExtensionContext.registerConfigCodec must route through registerConfigCodecInTransaction'));
    assert(extensionConfigCodecRouteDetail.code === 'extension.transaction', 'Expected ExtensionContext config codec transaction route issue code.');
    for (const [rel, content] of extensionRegistryOriginals) {
      writeText(projectRoot, rel, content);
    }
    assertOkValidation(projectRoot);

    for (const rel of extensionRegistryRels) {
      updateText(projectRoot, rel, (content) => {
        const updated = content.replace(
          "    readonly viewport: App['viewport'];",
          "    readonly lifecycle: App['lifecycle'];\n    readonly viewport: App['viewport'];",
        );
        assert(updated !== content, `Expected to mutate ${rel} ExtensionContext raw lifecycle exposure.`);
        return updated;
      });
    }
    const extensionLifecycleExposureViolation = expectValidationIssue(projectRoot, 'ExtensionContext.lifecycle must not expose raw AppLifecycle');
    const extensionLifecycleExposureDetail = extensionLifecycleExposureViolation.issueDetails.find((issue) => issue.message.includes('ExtensionContext.lifecycle must not expose raw AppLifecycle'));
    assert(extensionLifecycleExposureDetail.code === 'extension.transaction', 'Expected ExtensionContext lifecycle exposure issue code.');
    for (const [rel, content] of extensionRegistryOriginals) {
      writeText(projectRoot, rel, content);
    }
    assertOkValidation(projectRoot);

    updateText(projectRoot, 'packages/yzforge-runtime/src/app.ts', (content) => {
      return content.replace(
        "        this.assertState('enterModule', [AppState.Started]);",
        '        void AppState.Started;',
      );
    });
    const appStateViolation = expectValidationIssue(projectRoot, 'App.enterModule must declare AppState guard AppState.Started');
    const appStateDetail = appStateViolation.issueDetails.find((issue) => issue.message.includes('App.enterModule must declare AppState guard'));
    assert(appStateDetail.code === 'app.state_machine', 'Expected App state machine issue code.');
    for (const root of ['packages/yzforge-runtime/src', 'assets/yzforge/runtime', 'extensions/yzforge/runtime-template']) {
      writeText(projectRoot, `${root}/app.ts`, appStateMachineRuntimeSource());
    }
    assertOkValidation(projectRoot);

    for (const root of ['packages/yzforge-runtime/src', 'assets/yzforge/runtime', 'extensions/yzforge/runtime-template']) {
      updateText(projectRoot, `${root}/app.ts`, (content) => content.replace(
        '    public snapshot(): AppRuntimeSnapshot {',
        [
          '    public async debugUnsafe(): Promise<void> {',
          "        await Promise.resolve('unguarded');",
          '    }',
          '',
          '    public snapshot(): AppRuntimeSnapshot {',
        ].join('\n'),
      ));
    }
    const appPublicApiViolation = expectValidationIssue(projectRoot, 'App.debugUnsafe must declare an AppState guard');
    const appPublicApiDetail = appPublicApiViolation.issueDetails.find((issue) => issue.message.includes('App.debugUnsafe must declare an AppState guard'));
    assert(appPublicApiDetail.code === 'app.state_machine', 'Expected unguarded App public API issue code.');
    for (const root of ['packages/yzforge-runtime/src', 'assets/yzforge/runtime', 'extensions/yzforge/runtime-template']) {
      writeText(projectRoot, `${root}/app.ts`, appStateMachineRuntimeSource());
    }
    assertOkValidation(projectRoot);

    const badRuntimeBundleSource = [
      "import { assetManager } from 'cc';",
      '',
      'export function badRuntimeBundleLoad(): void {',
      "    assetManager.loadBundle('bad-runtime-bundle', () => undefined);",
      '}',
      '',
    ].join('\n');
    writeText(projectRoot, 'packages/yzforge-runtime/src/BadBundle.ts', badRuntimeBundleSource);
    const runtimeBundleViolation = expectValidationIssue(projectRoot, 'Only BundleManager may call assetManager.loadBundle directly');
    const runtimeBundleDetail = runtimeBundleViolation.issueDetails.find((issue) => issue.message.includes('Only BundleManager'));
    assert(runtimeBundleDetail.code === 'runtime.bundle_boundary', 'Expected runtime bundle boundary issue code.');
    assert(runtimeBundleDetail.path === 'packages/yzforge-runtime/src/BadBundle.ts', 'Expected runtime bundle boundary issue path.');
    fs.unlinkSync(path.join(projectRoot, 'packages/yzforge-runtime/src/BadBundle.ts'));
    assertOkValidation(projectRoot);

    const badRuntimeBundleTypeSource = [
      "import type { AssetManager } from 'cc';",
      '',
      'export interface BadBundleExposure {',
      '    readonly bundle: AssetManager.Bundle;',
      '}',
      '',
    ].join('\n');
    writeText(projectRoot, 'packages/yzforge-runtime/src/BadBundleType.ts', badRuntimeBundleTypeSource);
    const runtimeBundleTypeViolation = expectValidationIssue(projectRoot, 'Only BundleManager may reference AssetManager.Bundle directly');
    const runtimeBundleTypeDetail = runtimeBundleTypeViolation.issueDetails.find((issue) => issue.message.includes('AssetManager.Bundle'));
    assert(runtimeBundleTypeDetail.code === 'runtime.bundle_boundary', 'Expected runtime bundle type boundary issue code.');
    assert(runtimeBundleTypeDetail.path === 'packages/yzforge-runtime/src/BadBundleType.ts', 'Expected runtime bundle type boundary issue path.');
    fs.unlinkSync(path.join(projectRoot, 'packages/yzforge-runtime/src/BadBundleType.ts'));
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/modules/Battle/res/content/config/Item.json', (payload) => {
      payload.rows = [
        { ...payload.rows[0] },
        { ...payload.rows[0], label: 'Duplicate Sword' },
      ];
    });
    const duplicateConfigViolation = expectValidationIssue(projectRoot, "duplicate config primary key 'sword'");
    const duplicateConfigDetail = duplicateConfigViolation.issueDetails.find((issue) => issue.message.includes('duplicate config primary key'));
    assert(duplicateConfigDetail.code === 'config.duplicate_key', 'Expected duplicate config key issue code.');
    buildConfig(projectRoot);
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/libraries/BattleCore/code/providers.ts', [
      "import { defineLibraryProviders } from 'yzforge';",
      "import type { BattleCoreTokenMap } from './public';",
      '',
      'export const providers = defineLibraryProviders<BattleCoreTokenMap>({',
      '});',
    ].join('\n'));
    const providerViolation = expectValidationIssue(projectRoot, 'provider keys must match BattleCoreTokenMap keys');
    const providerDetail = providerViolation.issueDetails.find((issue) => issue.message.includes('provider keys must match'));
    assert(providerDetail.code === 'library.providers_mismatch', 'Expected provider mismatch issue code.');
    writeText(projectRoot, 'assets/libraries/BattleCore/code/providers.ts', [
      "import { defineLibraryProviders } from 'yzforge';",
      "import type { BattleCoreTokenMap } from './public';",
      '',
      'export const providers = defineLibraryProviders<BattleCoreTokenMap>({',
      '    rules: () => ({ version: 1 }),',
      '});',
    ].join('\n'));
    assertOkValidation(projectRoot);

    fs.rmSync(path.join(projectRoot, 'assets/modules/Battle/res/content/config/Item.json'), { force: true });
    const missingConfigViolation = expectValidationIssue(projectRoot, 'references missing config payload');
    const missingConfigDetail = missingConfigViolation.issueDetails.find((issue) => issue.message.includes('missing config payload'));
    assert(missingConfigDetail.code === 'config.payload_missing', 'Expected missing config payload issue code.');
    buildConfig(projectRoot);
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/app/main/Main.scene', (records) => {
      const idsByName = new Map(records.map((record, index) => [record?._name, index]));
      const uiRootId = idsByName.get('UIRoot');
      const canvasId = idsByName.get('Canvas');
      const pageLayerId = idsByName.get('PageLayer');
      records[uiRootId]._children = records[uiRootId]._children.filter((ref) => ref.__id__ !== pageLayerId);
      records[canvasId]._children.push({ __id__: pageLayerId });
      records[pageLayerId]._parent = { __id__: canvasId };
    });
    const mainSceneViolation = expectValidationIssue(projectRoot, 'Main scene node PageLayer must be a direct child of UIRoot');
    const mainSceneDetail = mainSceneViolation.issueDetails.find((issue) => issue.message.includes('PageLayer'));
    assert(mainSceneDetail.code === 'main.scene', 'Expected main scene hierarchy issue code.');
    writeText(projectRoot, 'assets/app/main/Main.scene', serializedMainScene(MAIN_SCRIPT_UUID));
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/app/main/Main.scene', (records) => {
      const idsByName = new Map(records.map((record, index) => [record?._name, index]));
      const paperLayerId = idsByName.get('PaperLayer');
      records[paperLayerId]._components = [];
    });
    const fullScreenComponentViolation = expectValidationIssue(projectRoot, 'Main scene PaperLayer must mount YZFullScreenRoot component');
    const fullScreenComponentDetail = fullScreenComponentViolation.issueDetails.find((issue) => issue.message.includes('YZFullScreenRoot'));
    assert(fullScreenComponentDetail.code === 'main.scene', 'Expected Main scene full screen component issue code.');
    writeText(projectRoot, 'assets/app/main/Main.scene', serializedMainScene(MAIN_SCRIPT_UUID));
    assertOkValidation(projectRoot);

    updateText(projectRoot, 'assets/app/main/Main.ts', (content) => {
      return content.replace("        void this.app?.dispose({ type: 'main_destroy' });\n", '');
    });
    const mainLifecycleViolation = expectValidationIssue(projectRoot, 'Main component must dispose App in onDestroy');
    const mainLifecycleDetail = mainLifecycleViolation.issueDetails.find((issue) => issue.message.includes('dispose App in onDestroy'));
    assert(mainLifecycleDetail.code === 'main.lifecycle', 'Expected Main lifecycle issue code.');
    writeText(projectRoot, 'assets/app/main/Main.ts', mainComponentSource());
    assertOkValidation(projectRoot);

    updateText(projectRoot, 'assets/app/main/Main.ts', (content) => {
      return content.replace('        await this.app.start({ mainRoot: this.node });', '        await this.app.start();');
    });
    const mainRootViolation = expectValidationIssue(projectRoot, 'Main component must start App with mainRoot: this.node');
    const mainRootDetail = mainRootViolation.issueDetails.find((issue) => issue.message.includes('mainRoot: this.node'));
    assert(mainRootDetail.code === 'main.lifecycle', 'Expected Main mainRoot lifecycle issue code.');
    writeText(projectRoot, 'assets/app/main/Main.ts', mainComponentSource());
    assertOkValidation(projectRoot);

    updateText(projectRoot, 'assets/app/main/Main.ts', (content) => {
      return content.replace('        clearYZForgeApp(this.app);\n', '');
    });
    const mainClearViolation = expectValidationIssue(projectRoot, 'Main component must clear the exposed App reference on destroy/dispose');
    const mainClearDetail = mainClearViolation.issueDetails.find((issue) => issue.message.includes('clear the exposed App reference'));
    assert(mainClearDetail.code === 'main.lifecycle', 'Expected Main clear lifecycle issue code.');
    writeText(projectRoot, 'assets/app/main/Main.ts', mainComponentSource());
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', (records) => {
      records[1]._prefab = null;
    });
    const prefabInfoViolation = expectValidationIssue(projectRoot, 'prefab root must contain cc.PrefabInfo');
    const prefabInfoDetail = prefabInfoViolation.issueDetails.find((issue) => issue.message.includes('cc.PrefabInfo'));
    assert(prefabInfoDetail.code === 'prefab.info_missing', 'Expected PrefabInfo issue code.');
    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000001', [
      '@title:Label',
      '@confirm:Button',
    ]));
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', (records) => {
      records[2]._contentSize.width = 2;
      records[2]._contentSize.height = 2;
    });
    const sizeViolation = expectValidationIssue(projectRoot, 'prefab root UITransform size is too small');
    const sizeDetail = sizeViolation.issueDetails.find((issue) => issue.message.includes('root UITransform size is too small'));
    assert(sizeDetail.code === 'ui.root_transform_too_small', 'Expected root UITransform size issue code.');
    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000001', [
      '@title:Label',
      '@confirm:Button',
    ]));
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', (records) => {
      const nodeId = records.length;
      records.push({
        __type__: 'cc.Node',
        _name: 'PopupMask',
        _parent: { __id__: 1 },
        _children: [],
        _components: [],
        _prefab: null,
      });
      records[1]._children.push({ __id__: nodeId });
    });
    const systemMaskViolation = expectValidationIssue(projectRoot, "must not contain SystemUI mask node 'PopupMask'");
    const systemMaskDetail = systemMaskViolation.issueDetails.find((issue) => issue.message.includes('SystemUI mask node'));
    assert(systemMaskDetail.code === 'ui.system_mask_prefab', 'Expected SystemUI mask prefab issue code.');
    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000001', [
      '@title:Label',
      '@confirm:Button',
    ]));
    assertOkValidation(projectRoot);

    updateText(projectRoot, 'assets/modules/Battle/code/generated/assets.ts', (content) => {
      return content.replace(
        "pageBattle: viewRef('Battle', PageBattle, 'res/view/PageBattle', { kind: ViewKind.Page })",
        "pageBattle: viewRef('Battle', PageBattle, 'res/view/PageBattle', { kind: ViewKind.Popup })",
      );
    });
    const policyViolation = expectValidationIssue(projectRoot, 'ViewKind for PageBattle conflicts with prefab name');
    const policyDetail = policyViolation.issueDetails.find((issue) => issue.message.includes('ViewKind for PageBattle'));
    assert(policyDetail.code === 'ui.policy_kind_mismatch', 'Expected ViewPolicy mismatch issue code.');
    assert(policyDetail.target === 'assets/modules/Battle/res/view/PageBattle.prefab', 'Expected ViewPolicy mismatch target prefab.');
    const policyRepair = generate(projectRoot);
    assert(policyRepair.changed.includes('assets/modules/Battle/code/generated/assets.ts'), 'Expected generate to repair stale ViewPolicy.');
    assertOkValidation(projectRoot);

    updateText(projectRoot, 'assets/modules/Battle/code/generated/assets.ts', (content) => {
      return content.replace(
        "pageBattle: viewRef('Battle', PageBattle, 'res/view/PageBattle', { kind: ViewKind.Page })",
        "pageBattle: viewRef('OtherModule', PageBattle, 'res/view/PageBattle', { kind: ViewKind.Page })",
      );
    });
    const ownerViolation = expectValidationIssue(projectRoot, "ViewRef owner for PageBattle must be 'Battle'");
    const ownerDetail = ownerViolation.issueDetails.find((issue) => issue.message.includes('ViewRef owner for PageBattle'));
    assert(ownerDetail.code === 'ui.policy_owner_mismatch', 'Expected ViewRef owner mismatch issue code.');
    const ownerRepair = generate(projectRoot);
    assert(ownerRepair.changed.includes('assets/modules/Battle/code/generated/assets.ts'), 'Expected generate to repair stale View owner.');
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/prefab/PageInjected.prefab', serializedPrefab('10000000-0000-4000-8000-000000000003'));
    const contentPackUiViolation = expectValidationIssue(projectRoot, 'ContentPack must not provide UIManager View prefab');
    const contentPackUiDetail = contentPackUiViolation.issueDetails.find((issue) => issue.message.includes('ContentPack must not provide UIManager View prefab'));
    assert(contentPackUiDetail.code === 'content_pack.ui_view_prefab', 'Expected ContentPack UI prefab issue code.');
    fs.unlinkSync(path.join(projectRoot, 'assets/content-packs/Battle/Level001/res/prefab/PageInjected.prefab'));
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/app/global/code/view/BadToastResult.ts', [
      "import { assets } from '../generated/assets';",
      '',
      'export class BadToastResult {',
      '    public async run(): Promise<void> {',
      '        await this.ui.openForResult(assets.views.toastNotice);',
      '    }',
      '}',
      '',
    ].join('\n'));
    const toastResultViolation = expectValidationIssue(projectRoot, 'must not call openForResult with Toast View');
    const toastResultDetail = toastResultViolation.issueDetails.find((issue) => issue.message.includes('openForResult with Toast View'));
    assert(toastResultDetail.code === 'ui.open_for_result_toast', 'Expected Toast openForResult issue code.');
    assert(toastResultDetail.path === 'assets/app/global/code/view/BadToastResult.ts', 'Expected Toast openForResult issue path.');
    fs.unlinkSync(path.join(projectRoot, 'assets/app/global/code/view/BadToastResult.ts'));
    assertOkValidation(projectRoot);

    const cleanPreview = cleanGenerated(projectRoot, { dryRun: true });
    assert(cleanPreview.files.includes('assets/app/global/code/generated/assets.ts'), 'Expected clean preview to include Global assets.');
    assert(cleanPreview.files.includes('assets/modules/Battle/code/generated/assets.ts'), 'Expected clean preview to include Module assets.');
    assert(cleanPreview.files.includes('assets/content-packs/Battle/Level001/manifest.generated.json'), 'Expected clean preview to include ContentPack manifest.');
    const clean = cleanGenerated(projectRoot);
    assert(clean.ok, `Clean generated failed:\n${JSON.stringify(clean.failed, null, 2)}`);
    assert(!fs.existsSync(path.join(projectRoot, 'assets/modules/Battle/code/generated/assets.ts')), 'Expected generated module assets to be removed.');
    assert(!fs.existsSync(path.join(projectRoot, 'assets/content-packs/Battle/Level001/manifest.generated.json')), 'Expected generated ContentPack manifest to be removed.');
    const regenerated = generate(projectRoot);
    assert(regenerated.changed.includes('assets/modules/Battle/code/generated/assets.ts'), 'Expected regenerate to restore cleaned module assets.');
    assert(regenerated.changed.includes('assets/content-packs/Battle/Level001/manifest.generated.json'), 'Expected regenerate to restore cleaned ContentPack manifest.');
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/modules/Battle/code/service/BadImport.ts', [
      'import {',
      '    SharedFx,',
      "} from '../../../libraries/BattleCore/code/SharedFx';",
      '',
      'export const value = SharedFx;',
      '',
    ].join('\n'));
    const importViolation = expectValidationIssue(projectRoot, 'imports library internal path');
    const importDetail = importViolation.issueDetails.find((issue) => issue.message.includes('imports library internal path'));
    assert(importDetail.path === 'assets/modules/Battle/code/service/BadImport.ts', 'Expected import issue path to point at BadImport.ts.');
    assert(importDetail.line === 1, 'Expected import issue to include line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/service/BadImport.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/service/BadGlobalImport.ts', [
      "import { assets as globalAssets } from '../../../../app/global/code/generated/assets';",
      '',
      'export const badGlobalView = globalAssets.views.toastNotice;',
      '',
    ].join('\n'));
    const globalImportViolation = expectValidationIssue(projectRoot, 'imports global internal path');
    const globalImportDetail = globalImportViolation.issueDetails.find((issue) => issue.message.includes('imports global internal path'));
    assert(globalImportDetail.code === 'import.boundary', 'Expected Global import boundary issue code.');
    assert(globalImportDetail.target === 'assets/app/global/code/generated/assets.ts', 'Expected Global import boundary target.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/service/BadGlobalImport.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/model/BadModel.ts', [
      "import { Node } from 'cc';",
      '',
      'export interface BadModel {',
      '    readonly node?: Node;',
      '}',
      '',
    ].join('\n'));
    const modelViolation = expectValidationIssue(projectRoot, 'model must not import cc');
    const modelDetail = modelViolation.issueDetails.find((issue) => issue.message.includes('model must not import cc'));
    assert(modelDetail.code === 'model.cc_import', 'Expected model import issue code.');
    assert(modelDetail.line === 1, 'Expected model import issue to include line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/model/BadModel.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/service/BadServiceUi.ts', [
      "import { Service } from 'yzforge';",
      '',
      'export class BadServiceUi extends Service {',
      '    public open(): void {',
      '        void this.module.ui.open(undefined as never);',
      '    }',
      '}',
      '',
    ].join('\n'));
    const uiViolation = expectValidationIssue(projectRoot, 'service must not directly operate UI');
    const uiDetail = uiViolation.issueDetails.find((issue) => issue.message.includes('service must not directly operate UI'));
    assert(uiDetail.code === 'service.ui_direct', 'Expected service UI issue code.');
    assert(uiDetail.line === 5, 'Expected service UI issue to include call line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/service/BadServiceUi.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/service/BadServiceNode.ts', [
      "import { Node } from 'cc';",
      "import { Service } from 'yzforge';",
      '',
      'export class BadServiceNode extends Service {',
      '    private target?: Node;',
      '}',
      '',
    ].join('\n'));
    const nodeViolation = expectValidationIssue(projectRoot, 'service must not keep long-lived Node or Component fields');
    const nodeDetail = nodeViolation.issueDetails.find((issue) => issue.message.includes('long-lived Node or Component'));
    assert(nodeDetail.code === 'service.node_field', 'Expected service node field issue code.');
    assert(nodeDetail.line === 5, 'Expected service node field issue to include field line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/service/BadServiceNode.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/service/BadSafeArea.ts', [
      "import { sys } from 'cc';",
      '',
      'export class BadSafeArea {',
      '    public read(): void {',
      '        sys.getSafeAreaRect();',
      '    }',
      '}',
      '',
    ].join('\n'));
    const safeAreaViolation = expectValidationIssue(projectRoot, 'business code must read safe area through app.viewport.profile');
    const safeAreaDetail = safeAreaViolation.issueDetails.find((issue) => issue.message.includes('app.viewport.profile'));
    assert(safeAreaDetail.code === 'viewport.safe_area_direct', 'Expected safe area viewport issue code.');
    assert(safeAreaDetail.line === 5, 'Expected safe area viewport issue to include call line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/service/BadSafeArea.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/service/BadDesignResolution.ts', [
      "import { view } from 'cc';",
      '',
      'export class BadDesignResolution {',
      '    public resize(): void {',
      '        view.setDesignResolutionSize(720, 1280, 0);',
      '    }',
      '}',
      '',
    ].join('\n'));
    const designResolutionViolation = expectValidationIssue(projectRoot, 'business code must not change design resolution directly');
    const designResolutionDetail = designResolutionViolation.issueDetails.find((issue) => issue.message.includes('design resolution'));
    assert(designResolutionDetail.code === 'viewport.design_resolution_direct', 'Expected design resolution viewport issue code.');
    assert(designResolutionDetail.line === 5, 'Expected design resolution viewport issue to include call line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/service/BadDesignResolution.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/view/BadViewListener.ts', [
      'export class BadViewListener {',
      '    public bind(): void {',
      "        this.node.on('touch-end', () => undefined);",
      '    }',
      '}',
      '',
    ].join('\n'));
    const listenerViolation = expectValidationIssue(projectRoot, 'view must use this.listen');
    const listenerDetail = listenerViolation.issueDetails.find((issue) => issue.message.includes('view must use this.listen'));
    assert(listenerDetail.code === 'view.listener_unmanaged', 'Expected view listener issue code.');
    assert(listenerDetail.line === 3, 'Expected view listener issue to include call line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/view/BadViewListener.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/view/BadViewTimer.ts', [
      'export class BadViewTimer {',
      '    public start(): void {',
      '        setInterval(() => undefined, 1000);',
      '    }',
      '}',
      '',
    ].join('\n'));
    const timerViolation = expectValidationIssue(projectRoot, 'view timers must be cleaned');
    const timerDetail = timerViolation.issueDetails.find((issue) => issue.message.includes('view timers must be cleaned'));
    assert(timerDetail.code === 'view.timer_unmanaged', 'Expected view timer issue code.');
    assert(timerDetail.line === 3, 'Expected view timer issue to include call line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/view/BadViewTimer.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/view/GoodViewTimer.ts', [
      'export class GoodViewTimer {',
      '    public start(): void {',
      '        const timer = setInterval(() => undefined, 1000);',
      '        this.addDisposer(() => clearInterval(timer));',
      '    }',
      '}',
      '',
    ].join('\n'));
    assertOkValidation(projectRoot);
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/view/GoodViewTimer.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/view/BadViewSchedule.ts', [
      'export class BadViewSchedule {',
      '    public start(): void {',
      '        this.schedule(() => undefined, 1);',
      '    }',
      '}',
      '',
    ].join('\n'));
    const scheduleViolation = expectValidationIssue(projectRoot, 'view schedules must be cleaned');
    const scheduleDetail = scheduleViolation.issueDetails.find((issue) => issue.message.includes('view schedules must be cleaned'));
    assert(scheduleDetail.code === 'view.schedule_unmanaged', 'Expected view schedule issue code.');
    assert(scheduleDetail.line === 3, 'Expected view schedule issue to include call line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/view/BadViewSchedule.ts'));

    writeText(projectRoot, 'assets/modules/Battle/code/view/BadViewTween.ts', [
      "import { tween } from 'cc';",
      'export class BadViewTween {',
      '    public start(): void {',
      '        tween(this.node).start();',
      '    }',
      '}',
      '',
    ].join('\n'));
    const tweenViolation = expectValidationIssue(projectRoot, 'view tween must be cleaned');
    const tweenDetail = tweenViolation.issueDetails.find((issue) => issue.message.includes('view tween must be cleaned'));
    assert(tweenDetail.code === 'view.tween_unmanaged', 'Expected view tween issue code.');
    assert(tweenDetail.line === 4, 'Expected view tween issue to include call line number.');
    fs.unlinkSync(path.join(projectRoot, 'assets/modules/Battle/code/view/BadViewTween.ts'));

    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000001', [
      '@title:Label',
    ], { omitMarkerComponents: true }));
    const componentViolation = expectValidationIssue(projectRoot, 'requires Label component on the same node');
    const componentDetail = componentViolation.issueDetails.find((issue) => issue.message.includes('requires Label component'));
    assert(componentDetail.code === 'ui.autoref_component_missing', 'Expected AutoRef component issue code.');
    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000001', [
      '@title:Label',
      '@confirm:Button',
    ]));

    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000001', [
      '@title:Label',
    ]));
    const staleRefsViolation = expectValidationIssue(projectRoot, 'is stale for assets/modules/Battle/res/view/PageBattle.prefab');
    const staleRefsDetail = staleRefsViolation.issueDetails.find((issue) => issue.message.includes('is stale for assets/modules/Battle/res/view/PageBattle.prefab'));
    assert(staleRefsDetail.code === 'ui.autoref_stale', 'Expected stale AutoRefs issue code.');
    assert(staleRefsDetail.target === 'assets/modules/Battle/res/view/PageBattle.prefab', 'Expected stale AutoRefs target prefab.');
    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000001', [
      '@title:Label',
      '@confirm:Button',
    ]));
    assertOkValidation(projectRoot);

    fs.appendFileSync(path.join(projectRoot, 'assets/modules/Battle/code/view/refs/PageBattle.refs.generated.ts'), '// tampered\n', 'utf8');
    expectValidationIssue(projectRoot, 'generated hash mismatch');
    const refs = generate(projectRoot);
    assert(refs.changed.includes('assets/modules/Battle/code/view/refs/PageBattle.refs.generated.ts'), 'Expected regenerate to repair tampered AutoRefs.');

    writeText(projectRoot, 'assets/modules/Battle/res/view/PageBattle.prefab', serializedPrefab('10000000-0000-4000-8000-000000000003'));
    expectValidationIssue(projectRoot, 'must mount View script');

    completed = true;
    return {
      ok: true,
      projectRoot: options.keep ? toPosix(projectRoot) : undefined,
      created: created.map((item) => item.kind),
      generated: generated.changed.length,
      checked: check.changed.length,
      strictIssues: validation.issues.length,
    };
  } catch (error) {
    error.message = `${error.message}\nSmoke project kept at: ${toPosix(projectRoot)}`;
    throw error;
  } finally {
    if (completed && !options.keep) {
      removeTempProject(projectRoot);
    }
  }
}

if (require.main === module) {
  smoke({ keep: process.argv.includes('--keep') })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  smoke,
};
