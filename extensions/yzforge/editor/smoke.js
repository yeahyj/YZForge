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

function serializedPrefab(scriptUuid, markers = []) {
  return `${JSON.stringify([
    { __type__: 'cc.Prefab', _name: 'Prefab' },
    { __type__: 'cc.Node', _name: 'Root' },
    { __type__: compressScriptUuid(scriptUuid) },
    ...markers.map((name) => ({ __type__: 'cc.Node', _name: name })),
  ], null, 2)}\n`;
}

function setupBaseline(projectRoot) {
  writeJson(projectRoot, 'tsconfig.json', { compilerOptions: {} });
  writeText(projectRoot, 'assets/yzforge/runtime/index.ts', 'export {};');
  writeText(projectRoot, 'assets/app/main/Main.ts', 'export class Main {}');
  writeText(projectRoot, 'assets/app/main/Main.scene', JSON.stringify([
    'MainRoot',
    'Canvas',
    'UIRoot',
    'PageLayer',
    'PaperLayer',
    'PopupLayer',
    'ToastLayer',
    'TopLayer',
    'SystemLayer',
  ].map((name) => ({ _name: name })), null, 2));
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

  updateJson(projectRoot, 'assets/modules/Battle/module.json', (descriptor) => {
    descriptor.libraries = ['BattleCore'];
  });
  updateJson(projectRoot, 'assets/content-packs/Battle/Level001/content-pack.json', (descriptor) => {
    descriptor.libraries = ['BattleCore'];
  });

  writeBundleMeta(projectRoot, 'assets/modules/Battle', 'yzforge-module-battle');
  writeBundleMeta(projectRoot, 'assets/libraries/BattleCore', 'yzforge-lib-battle-core');
  writeBundleMeta(projectRoot, 'assets/content-packs/Battle/Level001', 'yzforge-content-pack-battle-level001');

  writeText(projectRoot, 'assets/modules/Battle/code/runtime/LevelActor.ts', 'export class LevelActor {}');
  writeText(projectRoot, 'assets/libraries/BattleCore/code/SharedFx.ts', 'export class SharedFx {}');
  writeText(projectRoot, 'assets/libraries/BattleCore/res/runtime/Rules.json', '{"version":1}');
  writeText(projectRoot, 'assets/content-packs/Battle/Level001/res/runtime/LevelData.json', '{"level":1}');
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
  requireText(projectRoot, 'assets/app/global/code/assets.generated.ts', "toastNotice: viewRef(ToastNotice, 'res/view/ToastNotice'");
  requireText(projectRoot, 'assets/modules/Battle/code/assets.generated.ts', "pageBattle: viewRef(PageBattle, 'res/view/PageBattle'");
  requireText(projectRoot, 'assets/modules/Battle/code/assets.generated.ts', "partReward: partRef(PartReward, 'res/part/PartReward')");
  requireText(projectRoot, 'assets/modules/Battle/code/content-packs.generated.ts', 'export const BattleLevel001ContentPack = defineContentPack');
  requireText(projectRoot, 'assets/modules/Battle/code/content-packs.generated.ts', "levelRoot: contentPackAssetRef(Prefab, 'res/prefab/LevelRoot')");
  requireText(projectRoot, 'assets/app/bootstrap/install.generated.ts', 'AnalyticsExtension');

  const manifest = readJson(projectRoot, 'assets/content-packs/Battle/Level001/manifest.generated.json');
  assert(manifest.id === 'battle.level001', 'ContentPack manifest id mismatch.');
  assert(manifest.refs.levelRoot?.type === 'Prefab', 'ContentPack prefab ref missing from manifest.');
  assert(manifest.refs.levelData?.type === 'JsonAsset', 'ContentPack runtime json ref missing from manifest.');
  assert(manifest.refs.levelScene?.type === 'SceneAsset', 'ContentPack scene ref missing from manifest.');
}

function assertOkValidation(projectRoot) {
  const result = validate(projectRoot, { strict: true });
  assert(result.ok, `Strict validate failed:\n${result.issues.join('\n')}`);
  return result;
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

    const cleanPreview = cleanGenerated(projectRoot, { dryRun: true });
    assert(cleanPreview.files.includes('assets/app/global/code/assets.generated.ts'), 'Expected clean preview to include Global assets.');
    assert(cleanPreview.files.includes('assets/modules/Battle/code/assets.generated.ts'), 'Expected clean preview to include Module assets.');
    const clean = cleanGenerated(projectRoot);
    assert(clean.ok, `Clean generated failed:\n${JSON.stringify(clean.failed, null, 2)}`);
    assert(!fs.existsSync(path.join(projectRoot, 'assets/modules/Battle/code/assets.generated.ts')), 'Expected generated module assets to be removed.');
    const regenerated = generate(projectRoot);
    assert(regenerated.changed.includes('assets/modules/Battle/code/assets.generated.ts'), 'Expected regenerate to restore cleaned module assets.');
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
