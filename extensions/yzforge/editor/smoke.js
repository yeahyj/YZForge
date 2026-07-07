'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanGenerated } = require('./cleanup');
const { create } = require('./create');
const { generate } = require('./generate');
const { kebabCase, toPosix } = require('./fs-utils');
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
    node('MainRoot', 1, [3, 5], [15]),
    node('WorldRoot', 2, [4]),
    node('SceneHost', 3, []),
    node('Canvas', 2, [6], [16]),
    node('UIRoot', 5, [7, 8, 14]),
    node('FullscreenLayer', 6, [], [17]),
    node('SafeAreaRoot', 6, [9, 10, 11, 12, 13], [18]),
    node('PageLayer', 8, []),
    node('PaperLayer', 8, []),
    node('PopupLayer', 8, []),
    node('ToastLayer', 8, []),
    node('TopLayer', 8, []),
    node('SystemLayer', 6, [], [19]),
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
      __type__: compressScriptUuid(SAFE_AREA_ROOT_UUID),
      node: { __id__: 8 },
      _enabled: true,
    },
    {
      __type__: compressScriptUuid(FULL_SCREEN_ROOT_UUID),
      node: { __id__: 14 },
      _enabled: true,
    },
  ];

  return `${JSON.stringify(records, null, 2)}\n`;
}

function setupBaseline(projectRoot) {
  writeJson(projectRoot, 'tsconfig.json', { compilerOptions: {} });
  writeText(projectRoot, 'extensions/yzforge/runtime-template/index.ts', 'export {};');
  writeText(projectRoot, 'assets/yzforge/runtime/index.ts', 'export {};');
  for (const root of ['extensions/yzforge/runtime-template', 'assets/yzforge/runtime']) {
    writeText(projectRoot, `${root}/screen-fitter.ts`, 'export class YZScreenFitter {}');
    writeText(projectRoot, `${root}/full-screen-root.ts`, 'export class YZFullScreenRoot extends YZScreenFitter {}');
    writeText(projectRoot, `${root}/safe-area-root.ts`, 'export class YZSafeAreaRoot extends YZScreenFitter {}');
  }
  writeScriptMeta(projectRoot, 'assets/yzforge/runtime/screen-fitter.ts', SCREEN_FITTER_UUID);
  writeScriptMeta(projectRoot, 'assets/yzforge/runtime/full-screen-root.ts', FULL_SCREEN_ROOT_UUID);
  writeScriptMeta(projectRoot, 'assets/yzforge/runtime/safe-area-root.ts', SAFE_AREA_ROOT_UUID);
  writeText(projectRoot, 'assets/app/main/Main.ts', 'export class Main {}');
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
    "import { defineExtensionToken, defineModuleExtensionToken, type Extension, type ExtensionContext, type Module } from '../../yzforge/runtime';",
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
    "import { defineLibraryProviders } from '../../../yzforge/runtime';",
    "import type { BattleCoreTokenMap } from './public';",
    '',
    'export const providers = defineLibraryProviders<BattleCoreTokenMap>({',
    '    rules: () => ({ version: 1 }),',
    '});',
  ].join('\n'));

  writeText(projectRoot, 'assets/modules/Battle/code/runtime/LevelActor.ts', 'export class LevelActor {}');
  writeText(projectRoot, 'assets/libraries/BattleCore/code/SharedFx.ts', 'export class SharedFx {}');
  writeText(projectRoot, 'assets/libraries/BattleCore/res/runtime/Rules.json', '{"version":1}');
  writeText(projectRoot, 'assets/modules/Battle/res/content/config/BattleItems.json', JSON.stringify({
    primaryKey: 'id',
    rows: [
      { id: 'sword', label: 'Sword' },
    ],
  }, null, 2));
  writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/runtime/LevelData.json', '{"level":1}');
  writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/content/config/EnemyWaves.json', JSON.stringify({
    primaryKey: 'id',
    rows: [
      { id: 'wave-1', enemy: 'slime', count: 3 },
    ],
  }, null, 2));
  writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/scene/LevelScene.scene', JSON.stringify([
    { __type__: 'cc.SceneAsset' },
  ], null, 2));

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
  requireText(projectRoot, 'assets/libraries/BattleCore/code/entry.generated.ts', "import { providers } from './providers';");
  requireText(projectRoot, 'assets/libraries/BattleCore/code/entry.generated.ts', 'tokens: providers,');
  requireText(projectRoot, 'assets/app/global/code/assets.generated.ts', "toastNotice: viewRef('Global', ToastNotice, 'res/view/ToastNotice'");
  requireText(projectRoot, 'assets/modules/Battle/code/assets.generated.ts', "pageBattle: viewRef('Battle', PageBattle, 'res/view/PageBattle'");
  requireText(projectRoot, 'assets/modules/Battle/code/assets.generated.ts', "partReward: partRef(PartReward, 'res/part/PartReward')");
  requireText(projectRoot, 'assets/modules/Battle/code/config.generated.ts', "battleItems: tableRef({ name: 'res/content/config/BattleItems', primaryKey: 'id' })");
  requireText(projectRoot, 'assets/modules/Battle/code/content-packs.generated.ts', 'export const BattleLevel001ContentPack = defineContentPack');
  requireText(projectRoot, 'assets/modules/Battle/code/content-packs.generated.ts', "levelRoot: contentPackAssetRef(Prefab, 'res/prefab/LevelRoot')");
  requireText(projectRoot, 'assets/modules/Battle/code/content-packs.generated.ts', "enemyWaves: contentPackConfigRef('res/content/config/EnemyWaves', { primaryKey: 'id' })");
  requireText(projectRoot, 'assets/app/bootstrap/install.generated.ts', 'AnalyticsExtension');
  requireText(projectRoot, 'assets/app/extensions/Analytics.ts', 'AnalyticsModuleToken');

  const manifest = readJson(projectRoot, 'assets/content-packs/Battle/Level001/manifest.generated.json');
  assert(manifest.id === 'battle.level001', 'ContentPack manifest id mismatch.');
  assert(manifest.refs.levelRoot?.type === 'Prefab', 'ContentPack prefab ref missing from manifest.');
  assert(manifest.refs.levelData?.type === 'JsonAsset', 'ContentPack runtime json ref missing from manifest.');
  assert(manifest.refs.levelScene?.type === 'SceneAsset', 'ContentPack scene ref missing from manifest.');
  assert(manifest.refs.enemyWaves?.kind === 'config', 'ContentPack config ref missing from manifest.');
  assert(manifest._generated?.hash, 'ContentPack manifest generated metadata missing hash.');
  assert(manifest._generated?.source === 'assets/content-packs/Battle/Level001/content-pack.json', 'ContentPack manifest generated source mismatch.');
}

function assertOkValidation(projectRoot) {
  const result = validate(projectRoot, { strict: true });
  assert(result.ok, `Strict validate failed:\n${result.issues.join('\n')}`);
  return result;
}

function assertRuntimeLifecycleInvariants() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const appSource = fs.readFileSync(path.join(projectRoot, 'assets/yzforge/runtime/app.ts'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(projectRoot, 'assets/yzforge/runtime/module.ts'), 'utf8');
  const navigatorSource = fs.readFileSync(path.join(projectRoot, 'assets/yzforge/runtime/navigator.ts'), 'utf8');
  const extensionRegistrySource = fs.readFileSync(path.join(projectRoot, 'assets/yzforge/runtime/extension-registry.ts'), 'utf8');
  const contentPackSource = fs.readFileSync(path.join(projectRoot, 'assets/yzforge/runtime/content-pack.ts'), 'utf8');
  const preloadBody = appSource.slice(appSource.indexOf('public async preloadModule'), appSource.indexOf('public async loadModule'));
  const enterBody = appSource.slice(appSource.indexOf('public async enterModule'), appSource.indexOf('public async unloadModule'));
  assert(appSource.includes('moduleUnloadTasks'), 'App must keep module unload tasks idempotent.');
  assert(appSource.includes('module.unload_during_enter'), 'App must reject unloading a module while it is entering.');
  assert(appSource.includes('module.unload_failed'), 'App must aggregate module unload failures.');
  assert(preloadBody.includes('this.bundles.preloadBundle'), 'preloadModule must preload the module bundle.');
  assert(!preloadBody.includes('new entry.type') && !preloadBody.includes('__yzforgeCreate') && !preloadBody.includes('__yzforgeLoad'), 'preloadModule must not create or load Module instances.');
  assert(appSource.includes('instance = new entry.type()'), 'loadModule/createModule must create Module instances.');
  assert(appSource.indexOf('await instance.__yzforgeCreate()') < appSource.indexOf('await instance.__yzforgeLoad()'), 'Module load must call onCreate before onLoad.');
  assert(enterBody.includes('this.navigator.enter') && !enterBody.includes('__yzforgeEnter'), 'App.enterModule must delegate enter lifecycle to ModuleNavigator.');
  assert(navigatorSource.includes('await target.instance.__yzforgeEnter(params)'), 'ModuleNavigator must call module onEnter.');
  assert(navigatorSource.includes('target.instance.state = ModuleState.Ready'), 'ModuleNavigator must roll back entering module state on enter failure.');
  assert(moduleSource.includes('module.lifecycle_unload_failed'), 'Module unload lifecycle must aggregate hook failures.');
  assert(moduleSource.includes('flow.onDispose'), 'Module unload must dispose flows.');
  assert(moduleSource.includes('service.onDispose'), 'Module unload must dispose services.');
  assert(moduleSource.includes('model.onDispose'), 'Module unload must dispose models.');
  assert(moduleSource.includes('module.onUnload'), 'Module unload must call onUnload after unit disposal.');
  assert(extensionRegistrySource.includes('extension.phase_failed'), 'Extension phase failure must be wrapped with diagnostic context.');
  assert(extensionRegistrySource.includes('dependencyChain'), 'Extension failures must expose a dependency chain.');
  assert(contentPackSource.includes('manifest.generated'), 'ContentPack manifest.generated.json must be loaded at runtime.');
  assert(contentPackSource.includes('content_pack.manifest_mismatch'), 'ContentPack runtime must validate generated manifest identity.');
  assert(moduleSource.includes('readonly ui: ModuleUIAccess'), 'Module context must expose ModuleUI through the framework facade.');
  assert(fs.readFileSync(path.join(projectRoot, 'assets/yzforge/runtime/refs.ts'), 'utf8').includes('readonly owner: string;'), 'ViewRef must carry an owning scope.');
  assert(fs.readFileSync(path.join(projectRoot, 'assets/yzforge/runtime/ui.ts'), 'utf8').includes('ui.view_owner_mismatch'), 'ModuleUI must reject opening foreign View refs.');
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

function smoke(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yzforge-smoke-'));
  let completed = false;
  try {
    assertRuntimeLifecycleInvariants();
    setupBaseline(projectRoot);
    const created = createSmokeProject(projectRoot);
    const generated = generate(projectRoot);
    assert(generated.modules === 1, 'Expected one generated module.');
    assert(generated.libraries === 1, 'Expected one generated library.');
    assert(generated.contentPacks === 1, 'Expected one generated ContentPack.');
    assert(generated.changed.length > 0, 'Expected initial generation to write files.');

    assertGeneratedOutput(projectRoot);
    const check = generate(projectRoot, { check: true });
    assert(check.changed.length === 0, `Generate check found stale files:\n${check.changed.join('\n')}`);
    const validation = assertOkValidation(projectRoot);

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
      "import type { Extension, ExtensionContext } from '../../yzforge/runtime';",
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

    writeText(projectRoot, 'assets/app/extensions/BadInternalImport.ts', [
      "import { LevelActor } from '../../modules/Battle/code/runtime/LevelActor';",
      "import type { Extension } from '../../yzforge/runtime';",
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
    const tsconfigPathViolation = expectValidationIssue(projectRoot, 'tsconfig.json paths.yzforge must be ["assets/yzforge/runtime/index.ts"]');
    const tsconfigPathDetail = tsconfigPathViolation.issueDetails.find((issue) => issue.message.includes('paths.yzforge'));
    assert(tsconfigPathDetail.code === 'path_map.tsconfig', 'Expected tsconfig path map issue code.');
    const tsconfigRepair = generate(projectRoot);
    assert(tsconfigRepair.changed.includes('tsconfig.json'), 'Expected generate to repair tsconfig path map.');
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'import-map.json', (importMap) => {
      importMap.imports.yzforge = './extensions/yzforge/runtime-template/index';
    });
    const importMapViolation = expectValidationIssue(projectRoot, "import-map.json imports.yzforge must be './assets/yzforge/runtime/index'");
    const importMapDetail = importMapViolation.issueDetails.find((issue) => issue.message.includes('imports.yzforge'));
    assert(importMapDetail.code === 'path_map.import_map', 'Expected import-map path issue code.');
    const importMapRepair = generate(projectRoot);
    assert(importMapRepair.changed.includes('import-map.json'), 'Expected generate to repair import-map path.');
    assertOkValidation(projectRoot);

    fs.mkdirSync(path.join(projectRoot, 'assets/modules/Orphan/res'), { recursive: true });
    const orphanViolation = expectValidationIssue(projectRoot, 'module:Orphan scope directory is missing module.json');
    const orphanDetail = orphanViolation.issueDetails.find((issue) => issue.message.includes('module:Orphan'));
    assert(orphanDetail.code === 'scope.descriptor_missing', 'Expected orphan scope issue code.');
    fs.rmSync(path.join(projectRoot, 'assets/modules/Orphan'), { recursive: true, force: true });
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'extensions/yzforge/runtime-template/index.ts', 'export const drift = true;');
    const runtimeDriftViolation = expectValidationIssue(projectRoot, 'Project runtime file differs from template');
    const runtimeDriftDetail = runtimeDriftViolation.issueDetails.find((issue) => issue.message.includes('Project runtime file differs from template'));
    assert(runtimeDriftDetail.code === 'runtime.template_drift', 'Expected runtime template drift issue code.');
    writeText(projectRoot, 'extensions/yzforge/runtime-template/index.ts', 'export {};');
    assertOkValidation(projectRoot);

    const badRuntimeBundleSource = [
      "import { assetManager } from 'cc';",
      '',
      'export function badRuntimeBundleLoad(): void {',
      "    assetManager.loadBundle('bad-runtime-bundle', () => undefined);",
      '}',
      '',
    ].join('\n');
    writeText(projectRoot, 'assets/yzforge/runtime/BadBundle.ts', badRuntimeBundleSource);
    writeText(projectRoot, 'extensions/yzforge/runtime-template/BadBundle.ts', badRuntimeBundleSource);
    const runtimeBundleViolation = expectValidationIssue(projectRoot, 'Only BundleManager may call assetManager.loadBundle directly');
    const runtimeBundleDetail = runtimeBundleViolation.issueDetails.find((issue) => issue.message.includes('Only BundleManager'));
    assert(runtimeBundleDetail.code === 'runtime.bundle_boundary', 'Expected runtime bundle boundary issue code.');
    assert(runtimeBundleDetail.path === 'assets/yzforge/runtime/BadBundle.ts', 'Expected runtime bundle boundary issue path.');
    fs.unlinkSync(path.join(projectRoot, 'assets/yzforge/runtime/BadBundle.ts'));
    fs.unlinkSync(path.join(projectRoot, 'extensions/yzforge/runtime-template/BadBundle.ts'));
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/modules/Battle/res/content/config/BattleItems.json', JSON.stringify({
      primaryKey: 'id',
      rows: [
        { id: 'sword', label: 'Sword' },
        { id: 'sword', label: 'Duplicate Sword' },
      ],
    }, null, 2));
    const duplicateConfigViolation = expectValidationIssue(projectRoot, "duplicate config primary key 'sword'");
    const duplicateConfigDetail = duplicateConfigViolation.issueDetails.find((issue) => issue.message.includes('duplicate config primary key'));
    assert(duplicateConfigDetail.code === 'config.duplicate_key', 'Expected duplicate config key issue code.');
    writeText(projectRoot, 'assets/modules/Battle/res/content/config/BattleItems.json', JSON.stringify({
      primaryKey: 'id',
      rows: [
        { id: 'sword', label: 'Sword' },
      ],
    }, null, 2));
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/libraries/BattleCore/code/providers.ts', [
      "import { defineLibraryProviders } from '../../../yzforge/runtime';",
      "import type { BattleCoreTokenMap } from './public';",
      '',
      'export const providers = defineLibraryProviders<BattleCoreTokenMap>({',
      '});',
    ].join('\n'));
    const providerViolation = expectValidationIssue(projectRoot, 'provider keys must match BattleCoreTokenMap keys');
    const providerDetail = providerViolation.issueDetails.find((issue) => issue.message.includes('provider keys must match'));
    assert(providerDetail.code === 'library.providers_mismatch', 'Expected provider mismatch issue code.');
    writeText(projectRoot, 'assets/libraries/BattleCore/code/providers.ts', [
      "import { defineLibraryProviders } from '../../../yzforge/runtime';",
      "import type { BattleCoreTokenMap } from './public';",
      '',
      'export const providers = defineLibraryProviders<BattleCoreTokenMap>({',
      '    rules: () => ({ version: 1 }),',
      '});',
    ].join('\n'));
    assertOkValidation(projectRoot);

    fs.rmSync(path.join(projectRoot, 'assets/modules/Battle/res/content/config/BattleItems.json'), { force: true });
    const missingConfigViolation = expectValidationIssue(projectRoot, 'references missing config payload');
    const missingConfigDetail = missingConfigViolation.issueDetails.find((issue) => issue.message.includes('missing config payload'));
    assert(missingConfigDetail.code === 'config.payload_missing', 'Expected missing config payload issue code.');
    writeText(projectRoot, 'assets/modules/Battle/res/content/config/BattleItems.json', JSON.stringify({
      primaryKey: 'id',
      rows: [
        { id: 'sword', label: 'Sword' },
      ],
    }, null, 2));
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/app/main/Main.scene', (records) => {
      const idsByName = new Map(records.map((record, index) => [record?._name, index]));
      const uiRootId = idsByName.get('UIRoot');
      const safeAreaRootId = idsByName.get('SafeAreaRoot');
      const pageLayerId = idsByName.get('PageLayer');
      records[safeAreaRootId]._children = records[safeAreaRootId]._children.filter((ref) => ref.__id__ !== pageLayerId);
      records[uiRootId]._children.push({ __id__: pageLayerId });
      records[pageLayerId]._parent = { __id__: uiRootId };
    });
    const mainSceneViolation = expectValidationIssue(projectRoot, 'Main scene node PageLayer must be a direct child of SafeAreaRoot');
    const mainSceneDetail = mainSceneViolation.issueDetails.find((issue) => issue.message.includes('PageLayer'));
    assert(mainSceneDetail.code === 'main.scene', 'Expected main scene hierarchy issue code.');
    writeText(projectRoot, 'assets/app/main/Main.scene', serializedMainScene(MAIN_SCRIPT_UUID));
    assertOkValidation(projectRoot);

    updateJson(projectRoot, 'assets/app/main/Main.scene', (records) => {
      const idsByName = new Map(records.map((record, index) => [record?._name, index]));
      const safeAreaRootId = idsByName.get('SafeAreaRoot');
      records[safeAreaRootId]._components = [];
    });
    const safeAreaComponentViolation = expectValidationIssue(projectRoot, 'Main scene SafeAreaRoot must mount YZSafeAreaRoot component');
    const safeAreaComponentDetail = safeAreaComponentViolation.issueDetails.find((issue) => issue.message.includes('YZSafeAreaRoot'));
    assert(safeAreaComponentDetail.code === 'main.scene', 'Expected Main scene safe area component issue code.');
    writeText(projectRoot, 'assets/app/main/Main.scene', serializedMainScene(MAIN_SCRIPT_UUID));
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

    updateText(projectRoot, 'assets/modules/Battle/code/assets.generated.ts', (content) => {
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
    assert(policyRepair.changed.includes('assets/modules/Battle/code/assets.generated.ts'), 'Expected generate to repair stale ViewPolicy.');
    assertOkValidation(projectRoot);

    updateText(projectRoot, 'assets/modules/Battle/code/assets.generated.ts', (content) => {
      return content.replace(
        "pageBattle: viewRef('Battle', PageBattle, 'res/view/PageBattle', { kind: ViewKind.Page })",
        "pageBattle: viewRef('OtherModule', PageBattle, 'res/view/PageBattle', { kind: ViewKind.Page })",
      );
    });
    const ownerViolation = expectValidationIssue(projectRoot, "ViewRef owner for PageBattle must be 'Battle'");
    const ownerDetail = ownerViolation.issueDetails.find((issue) => issue.message.includes('ViewRef owner for PageBattle'));
    assert(ownerDetail.code === 'ui.policy_owner_mismatch', 'Expected ViewRef owner mismatch issue code.');
    const ownerRepair = generate(projectRoot);
    assert(ownerRepair.changed.includes('assets/modules/Battle/code/assets.generated.ts'), 'Expected generate to repair stale View owner.');
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/prefab/PageInjected.prefab', serializedPrefab('10000000-0000-4000-8000-000000000003'));
    const contentPackUiViolation = expectValidationIssue(projectRoot, 'ContentPack must not provide UIManager View prefab');
    const contentPackUiDetail = contentPackUiViolation.issueDetails.find((issue) => issue.message.includes('ContentPack must not provide UIManager View prefab'));
    assert(contentPackUiDetail.code === 'content_pack.ui_view_prefab', 'Expected ContentPack UI prefab issue code.');
    fs.unlinkSync(path.join(projectRoot, 'assets/content-packs/Battle/Level001/res/prefab/PageInjected.prefab'));
    assertOkValidation(projectRoot);

    writeText(projectRoot, 'assets/app/global/code/view/BadToastResult.ts', [
      "import { assets } from '../assets.generated';",
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
    assert(cleanPreview.files.includes('assets/app/global/code/assets.generated.ts'), 'Expected clean preview to include Global assets.');
    assert(cleanPreview.files.includes('assets/modules/Battle/code/assets.generated.ts'), 'Expected clean preview to include Module assets.');
    assert(cleanPreview.files.includes('assets/content-packs/Battle/Level001/manifest.generated.json'), 'Expected clean preview to include ContentPack manifest.');
    const clean = cleanGenerated(projectRoot);
    assert(clean.ok, `Clean generated failed:\n${JSON.stringify(clean.failed, null, 2)}`);
    assert(!fs.existsSync(path.join(projectRoot, 'assets/modules/Battle/code/assets.generated.ts')), 'Expected generated module assets to be removed.');
    assert(!fs.existsSync(path.join(projectRoot, 'assets/content-packs/Battle/Level001/manifest.generated.json')), 'Expected generated ContentPack manifest to be removed.');
    const regenerated = generate(projectRoot);
    assert(regenerated.changed.includes('assets/modules/Battle/code/assets.generated.ts'), 'Expected regenerate to restore cleaned module assets.');
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
      "import { assets as globalAssets } from '../../../../app/global/code/assets.generated';",
      '',
      'export const badGlobalView = globalAssets.views.toastNotice;',
      '',
    ].join('\n'));
    const globalImportViolation = expectValidationIssue(projectRoot, 'imports global internal path');
    const globalImportDetail = globalImportViolation.issueDetails.find((issue) => issue.message.includes('imports global internal path'));
    assert(globalImportDetail.code === 'import.boundary', 'Expected Global import boundary issue code.');
    assert(globalImportDetail.target === 'assets/app/global/code/assets.generated.ts', 'Expected Global import boundary target.');
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
      "import { Service } from '../../../../yzforge/runtime';",
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
      "import { Service } from '../../../../yzforge/runtime';",
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
  try {
    const result = smoke({ keep: process.argv.includes('--keep') });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  smoke,
};
