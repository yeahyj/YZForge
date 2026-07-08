'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonc, toPosix } = require('./fs-utils');

const TOOLCHAIN_CONFIG_PATH = '.yzforge/toolchain.json';
const EDITOR_ROOT_ENV_VARS = [
  'YZFORGE_COCOS_EDITOR_ROOT',
  'COCOS_EDITOR_ROOT',
  'COCOS_CREATOR_ROOT',
  'CREATOR_ROOT',
];
const COCOS_EXECUTABLE_ENV_VARS = [
  'YZFORGE_COCOS_EXECUTABLE',
  'COCOS_CREATOR_EXECUTABLE',
  'COCOS_EXECUTABLE',
];
const TYPECHECK_TSCONFIG_PATH = path.join('temp', 'yzforge', 'tsconfig.typecheck.json');
const COCOS_ENV_CONSTANTS = [
  ['HTML5', 'boolean'],
  ['NATIVE', 'boolean'],
  ['ANDROID', 'boolean'],
  ['IOS', 'boolean'],
  ['MAC', 'boolean'],
  ['WINDOWS', 'boolean'],
  ['LINUX', 'boolean'],
  ['OHOS', 'boolean'],
  ['OPEN_HARMONY', 'boolean'],
  ['WECHAT', 'boolean'],
  ['WECHAT_MINI_PROGRAM', 'boolean'],
  ['XIAOMI', 'boolean'],
  ['ALIPAY', 'boolean'],
  ['TAOBAO', 'boolean'],
  ['TAOBAO_MINIGAME', 'boolean'],
  ['BYTEDANCE', 'boolean'],
  ['OPPO', 'boolean'],
  ['VIVO', 'boolean'],
  ['HUAWEI', 'boolean'],
  ['MIGU', 'boolean'],
  ['HONOR', 'boolean'],
  ['COCOS_RUNTIME', 'boolean'],
  ['EDITOR', 'boolean'],
  ['EDITOR_NOT_IN_PREVIEW', 'boolean'],
  ['PREVIEW', 'boolean'],
  ['BUILD', 'boolean'],
  ['TEST', 'boolean'],
  ['DEBUG', 'boolean'],
  ['DEV', 'boolean'],
  ['MINIGAME', 'boolean'],
  ['RUNTIME_BASED', 'boolean'],
  ['SUPPORT_JIT', 'boolean'],
  ['JSB', 'boolean'],
  ['NET_MODE', 'number'],
];

let cachedTypeScript;
let typeScriptLoaded = false;

function yzforgePackageScripts() {
  return {
    'yzforge:create': 'node extensions/yzforge/editor/cli.js create',
    'yzforge:generate': 'node extensions/yzforge/editor/cli.js generate',
    'yzforge:generate:check': 'node extensions/yzforge/editor/cli.js generate --check',
    'yzforge:clean:generated': 'node extensions/yzforge/editor/cli.js clean-generated',
    'yzforge:clean:generated:check': 'node extensions/yzforge/editor/cli.js clean-generated --dry-run',
    'yzforge:validate': 'node extensions/yzforge/editor/cli.js validate',
    'yzforge:validate:strict': 'node extensions/yzforge/editor/cli.js validate --strict',
    'yzforge:validate:build-matrix': 'node extensions/yzforge/editor/cli.js validate-build-matrix',
    'yzforge:cocos:build:web': 'node extensions/yzforge/editor/cli.js cocos-build --platform web-desktop --debug --output yzforge-build-matrix',
    'yzforge:smoke': 'node extensions/yzforge/editor/cli.js smoke',
    typecheck: 'node extensions/yzforge/editor/cli.js typecheck',
  };
}

function readOptionalJsonc(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return readJsonc(filePath);
}

function expandUser(value) {
  const text = String(value || '').trim();
  if (!text) {
    return undefined;
  }
  if (text === '~') {
    return os.homedir();
  }
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function normalizeEditorRootCandidate(value) {
  const expanded = expandUser(value);
  if (!expanded) {
    return undefined;
  }
  const resolved = path.resolve(expanded);
  const baseName = path.basename(resolved).toLowerCase();
  if (baseName === 'cocoscreator.exe') {
    return path.dirname(resolved);
  }
  if (baseName === 'resources') {
    return path.dirname(resolved);
  }
  if (baseName === 'app.asar.unpacked') {
    return path.resolve(resolved, '..', '..');
  }
  return resolved;
}

function uniqueExistingCandidates(candidates) {
  const seen = new Set();
  const results = [];
  for (const candidate of candidates) {
    const normalized = normalizeEditorRootCandidate(candidate);
    if (!normalized) {
      continue;
    }
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(normalized);
  }
  return results;
}

function readToolchainConfig(projectRoot) {
  const configPath = path.join(projectRoot, TOOLCHAIN_CONFIG_PATH);
  try {
    return readOptionalJsonc(configPath) || {};
  } catch (error) {
    error.message = `${TOOLCHAIN_CONFIG_PATH} cannot be read: ${error.message}`;
    throw error;
  }
}

function readProjectCocosVersion(projectRoot) {
  try {
    const packageJson = readOptionalJsonc(path.join(projectRoot, 'package.json'));
    return packageJson?.creator?.version;
  } catch (error) {
    return undefined;
  }
}

function addVersionedCandidates(candidates, root, version) {
  if (!root) {
    return;
  }
  if (version) {
    candidates.push(path.join(root, version));
  }
  if (!fs.existsSync(root)) {
    return;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && (!version || entry.name === version)) {
      candidates.push(path.join(root, entry.name));
    }
  }
}

function candidateEditorRoots(projectRoot) {
  const config = readToolchainConfig(projectRoot);
  const version = config.cocosVersion || readProjectCocosVersion(projectRoot);
  const candidates = [];

  candidates.push(config.cocosEditorRoot);
  candidates.push(config.cocos?.editorRoot);
  candidates.push(config.editorRoot);
  candidates.push(config.creatorRoot);

  for (const envVar of EDITOR_ROOT_ENV_VARS) {
    candidates.push(process.env[envVar]);
  }

  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const userHome = os.homedir();
  const versionedRoots = [
    'D:/Applications/Cocos/Editor/Creator',
    'C:/Applications/Cocos/Editor/Creator',
    programFiles ? path.join(programFiles, 'Cocos', 'Creator') : undefined,
    programFilesX86 ? path.join(programFilesX86, 'Cocos', 'Creator') : undefined,
    localAppData ? path.join(localAppData, 'CocosDashboard', 'editors', 'Creator') : undefined,
    localAppData ? path.join(localAppData, 'Cocos', 'Creator') : undefined,
    userHome ? path.join(userHome, 'AppData', 'Local', 'CocosDashboard', 'editors', 'Creator') : undefined,
  ];

  for (const root of versionedRoots) {
    addVersionedCandidates(candidates, root, version);
  }

  return uniqueExistingCandidates(candidates);
}

function typeScriptModulePathForRoot(editorRoot) {
  return path.join(editorRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'typescript', 'lib', 'typescript.js');
}

function typeScriptCliPathForRoot(editorRoot) {
  return path.join(editorRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'typescript', 'lib', 'tsc.js');
}

function isCocosEditorRoot(editorRoot) {
  return Boolean(editorRoot && fs.existsSync(typeScriptModulePathForRoot(editorRoot)));
}

function executableName() {
  if (process.platform === 'darwin') {
    return path.join('CocosCreator.app', 'Contents', 'MacOS', 'CocosCreator');
  }
  return process.platform === 'win32' ? 'CocosCreator.exe' : 'CocosCreator';
}

function createResolveError(projectRoot, kind, attempts) {
  const version = readProjectCocosVersion(projectRoot) || 'unknown';
  const details = attempts.length > 0
    ? attempts.map((candidate) => `  - ${toPosix(candidate)}`).join('\n')
    : '  - no candidates';
  const error = new Error([
    `Cannot resolve ${kind}.`,
    `Project Cocos version: ${version}.`,
    `Set ${EDITOR_ROOT_ENV_VARS[0]} or configure ${TOOLCHAIN_CONFIG_PATH}.`,
    `Example ${TOOLCHAIN_CONFIG_PATH}:`,
    '{ "cocosEditorRoot": "C:/Program Files/Cocos/Creator/3.8.8" }',
    'Checked candidates:',
    details,
  ].join('\n'));
  error.code = 'YZFORGE_TOOLCHAIN_UNRESOLVED';
  return error;
}

function resolveCocosEditorRoot(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const attempts = candidateEditorRoots(root);
  for (const candidate of attempts) {
    if (isCocosEditorRoot(candidate)) {
      return candidate;
    }
  }
  if (options.required === false) {
    return undefined;
  }
  throw createResolveError(root, 'Cocos Editor root', attempts);
}

function resolveCocosExecutable(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const config = readToolchainConfig(root);
  const candidates = [
    config.cocosExecutable,
    config.cocos?.executable,
    config.creatorExecutable,
  ];
  for (const envVar of COCOS_EXECUTABLE_ENV_VARS) {
    candidates.push(process.env[envVar]);
  }
  const editorRoot = resolveCocosEditorRoot(root, { required: false });
  if (editorRoot) {
    candidates.push(path.join(editorRoot, executableName()));
  }
  for (const candidate of candidates) {
    const expanded = expandUser(candidate);
    if (!expanded) {
      continue;
    }
    const executable = path.resolve(expanded);
    if (fs.existsSync(executable)) {
      return executable;
    }
  }
  if (options.required === false) {
    return undefined;
  }
  throw createResolveError(root, 'Cocos executable', candidates.filter(Boolean).concat(candidateEditorRoots(root)));
}

function resolveCocosTypeScript(projectRoot, options = {}) {
  const editorRoot = resolveCocosEditorRoot(projectRoot, options);
  if (!editorRoot) {
    return undefined;
  }
  const modulePath = typeScriptModulePathForRoot(editorRoot);
  if (fs.existsSync(modulePath)) {
    return modulePath;
  }
  if (options.required === false) {
    return undefined;
  }
  throw createResolveError(path.resolve(projectRoot || process.cwd()), 'Cocos TypeScript module', [modulePath]);
}

function resolveCocosTypeScriptCli(projectRoot, options = {}) {
  const editorRoot = resolveCocosEditorRoot(projectRoot, options);
  if (!editorRoot) {
    return undefined;
  }
  const cliPath = typeScriptCliPathForRoot(editorRoot);
  if (fs.existsSync(cliPath)) {
    return cliPath;
  }
  if (options.required === false) {
    return undefined;
  }
  throw createResolveError(path.resolve(projectRoot || process.cwd()), 'Cocos TypeScript CLI', [cliPath]);
}

function resolveCocosEngineRoot(projectRoot, options = {}) {
  const editorRoot = resolveCocosEditorRoot(projectRoot, options);
  if (!editorRoot) {
    return undefined;
  }
  const candidates = [
    path.join(editorRoot, 'resources', 'resources', '3d', 'engine'),
    path.join(editorRoot, 'resources', '3d', 'engine'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (options.required === false) {
    return undefined;
  }
  throw createResolveError(path.resolve(projectRoot || process.cwd()), 'Cocos engine root', candidates);
}

function loadTypeScript(projectRoot, options = {}) {
  if (typeScriptLoaded) {
    if (!cachedTypeScript && options.required) {
      throw createResolveError(path.resolve(projectRoot || process.cwd()), 'TypeScript module', candidateEditorRoots(path.resolve(projectRoot || process.cwd())));
    }
    return cachedTypeScript;
  }
  typeScriptLoaded = true;
  try {
    cachedTypeScript = require('typescript');
    return cachedTypeScript;
  } catch (error) {
    // Prefer a project-local TypeScript when it exists, then fall back to Cocos.
  }
  const cocosTypeScript = resolveCocosTypeScript(projectRoot, { required: false });
  if (cocosTypeScript) {
    cachedTypeScript = require(cocosTypeScript);
    return cachedTypeScript;
  }
  if (options.required) {
    throw createResolveError(path.resolve(projectRoot || process.cwd()), 'TypeScript module', candidateEditorRoots(path.resolve(projectRoot || process.cwd())));
  }
  return undefined;
}

function resolveCocosEngineAssets(projectRoot, options = {}) {
  const engineRoot = resolveCocosEngineRoot(projectRoot, options);
  if (!engineRoot) {
    return undefined;
  }
  const candidates = [
    path.join(engineRoot, 'editor', 'assets'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (options.required === false) {
    return undefined;
  }
  throw createResolveError(path.resolve(projectRoot || process.cwd()), 'Cocos engine editor assets', candidates);
}

function renderCocosEnvDeclarations() {
  return [
    "declare module 'cc/env' {",
    ...COCOS_ENV_CONSTANTS.map(([name, type]) => `  export const ${name}: ${type};`),
    '}',
    '',
  ].join('\n');
}

function writeGeneratedToolchainFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = content.endsWith('\n') ? content : `${content}\n`;
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === next) {
    return false;
  }
  fs.writeFileSync(filePath, next, 'utf8');
  return true;
}

function prepareTypecheckTsconfig(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const rootTsconfig = readJsonc(path.join(root, 'tsconfig.json'));
  const outputPath = path.join(root, TYPECHECK_TSCONFIG_PATH);
  const outputDir = path.dirname(outputPath);
  const baseUrl = toPosix(path.relative(outputDir, root)) || '.';
  const engineRoot = resolveCocosEngineRoot(root);
  const cocosEngineAssets = resolveCocosEngineAssets(root);
  const ccDeclaration = path.join(engineRoot, 'bin', '.declarations', 'cc.d.ts');
  const jsbDeclaration = path.join(engineRoot, '@types', 'jsb.d.ts');
  const envDeclaration = path.join(outputDir, 'declarations', 'cc.env.d.ts');
  const macroDeclaration = path.join(outputDir, 'declarations', 'cc.custom-macro.d.ts');

  for (const filePath of [ccDeclaration, jsbDeclaration]) {
    if (!fs.existsSync(filePath)) {
      throw createResolveError(root, `Cocos declaration ${path.basename(filePath)}`, [filePath]);
    }
  }

  writeGeneratedToolchainFile(envDeclaration, renderCocosEnvDeclarations());
  writeGeneratedToolchainFile(macroDeclaration, [
    'declare module "cc/userland/macro" {',
    '}',
    '',
  ].join('\n'));

  const rootCompilerOptions = rootTsconfig.compilerOptions || {};
  const rootPaths = rootCompilerOptions.paths || {};
  const compilerOptions = {
    ...rootCompilerOptions,
    baseUrl,
    paths: {
      ...rootPaths,
      'db://internal/*': [`${toPosix(cocosEngineAssets)}/*`],
    },
    types: [],
  };
  delete compilerOptions.composite;
  delete compilerOptions.declaration;
  delete compilerOptions.declarationMap;
  delete compilerOptions.emitDeclarationOnly;

  const config = {
    $schema: rootTsconfig.$schema || 'https://json.schemastore.org/tsconfig',
    compilerOptions,
    files: [
      toPosix(ccDeclaration),
      toPosix(jsbDeclaration),
      toPosix(envDeclaration),
      toPosix(macroDeclaration),
    ],
    include: [
      `${baseUrl}/assets/**/*.ts`,
      `${baseUrl}/packages/yzforge-runtime/src/**/*.ts`,
      `${baseUrl}/extensions/yzforge/runtime-template/**/*.ts`,
    ],
    exclude: [
      `${baseUrl}/build/**`,
      `${baseUrl}/library/**`,
      `${baseUrl}/node_modules/**`,
      `${baseUrl}/temp/**`,
    ],
  };

  writeGeneratedToolchainFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
  return outputPath;
}

function resolveCocosProjectSettings(projectRoot) {
  return path.join(path.resolve(projectRoot || process.cwd()), 'settings', 'v2', 'packages', 'project.json');
}

function resolveCocosTempAssembly(projectRoot, target) {
  return path.join(
    path.resolve(projectRoot || process.cwd()),
    'temp',
    'programming',
    'packer-driver',
    'targets',
    target,
    'assembly-record.json',
  );
}

function runTypecheck(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const tscPath = resolveCocosTypeScriptCli(root);
  const tsconfigPath = options.args && options.args.length > 0
    ? undefined
    : prepareTypecheckTsconfig(root);
  const args = options.args && options.args.length > 0
    ? options.args
    : ['-p', tsconfigPath, '--noEmit', '--pretty', 'false'];
  const result = childProcess.spawnSync(process.execPath, [tscPath, ...args], {
    cwd: root,
    env: process.env,
    stdio: options.stdio || 'inherit',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error,
    command: `node ${toPosix(tscPath)} ${args.join(' ')}`,
    tsconfig: tsconfigPath ? toPosix(tsconfigPath) : undefined,
  };
}

function formatBuildValue(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function formatCocosBuildOptions(options) {
  return Object.entries(options)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatBuildValue(value)}`)
    .join(';');
}

function resolveCocosBuildOutputPath(projectRoot, buildPath, outputName) {
  const root = path.resolve(projectRoot || process.cwd());
  let basePath = buildPath || 'project://build';
  if (String(basePath).startsWith('project://')) {
    basePath = path.join(root, String(basePath).slice('project://'.length));
  } else if (!path.isAbsolute(String(basePath))) {
    basePath = path.join(root, String(basePath));
  }
  return path.join(basePath, outputName || 'web-desktop');
}

function runCocosBuild(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const executable = resolveCocosExecutable(root);
  const logDest = options.logDest || path.join(root, 'temp', 'yzforge-cocos-build.log');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const buildOptions = {
    platform: options.platform || 'web-desktop',
    debug: options.debug ?? true,
    buildPath: options.buildPath || 'project://build',
    outputName: options.outputName || 'yzforge-build-matrix',
    md5Cache: options.md5Cache ?? false,
    logDest: toPosix(logDest),
    ...(options.extra || {}),
  };
  const expectedOutputPath = resolveCocosBuildOutputPath(root, buildOptions.buildPath, buildOptions.outputName);
  const buildArg = formatCocosBuildOptions(buildOptions);
  const result = childProcess.spawnSync(executable, ['--project', root, '--build', buildArg], {
    cwd: root,
    env,
    stdio: options.stdio || 'inherit',
  });
  const processOk = result.status === 0 || result.status === 36;
  const outputExists = fs.existsSync(expectedOutputPath);
  return {
    ok: processOk && outputExists,
    processOk,
    outputExists,
    status: result.status,
    signal: result.signal,
    error: result.error,
    executable: toPosix(executable),
    command: `${toPosix(executable)} --project ${toPosix(root)} --build "${buildArg}"`,
    buildOptions,
    expectedOutputPath: toPosix(expectedOutputPath),
    logDest: toPosix(logDest),
  };
}

module.exports = {
  TOOLCHAIN_CONFIG_PATH,
  COCOS_EXECUTABLE_ENV_VARS,
  EDITOR_ROOT_ENV_VARS,
  loadTypeScript,
  prepareTypecheckTsconfig,
  resolveCocosExecutable,
  resolveCocosEditorRoot,
  resolveCocosEngineRoot,
  resolveCocosEngineAssets,
  resolveCocosProjectSettings,
  resolveCocosTempAssembly,
  resolveCocosTypeScript,
  resolveCocosTypeScriptCli,
  resolveCocosBuildOutputPath,
  runCocosBuild,
  runTypecheck,
  yzforgePackageScripts,
};
