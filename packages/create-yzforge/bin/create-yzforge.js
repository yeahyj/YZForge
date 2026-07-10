#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_REPO = process.env.YZFORGE_TEMPLATE_REPO || 'https://github.com/yeahyj/YZForge.git';
const DEFAULT_REF = process.env.YZFORGE_TEMPLATE_REF || 'main';

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  '.idea',
  '.vscode',
  'build',
  'coverage',
  'crash',
  'library',
  'local',
  'logs',
  'native',
  'node_modules',
  'profiles',
  'temp',
]);

const EXCLUDED_PATHS = new Set([
  '.creator/asset-template',
  'packages/create-yzforge',
]);

const EXCLUDED_FILE_NAMES = new Set([
  'npm-debug.log',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'yarn-error.log',
]);

const EXCLUDED_FILES = new Set([
  '.yzforge/ai-context.json',
  '.yzforge/ai-summary.md',
]);

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.version) {
    const pkg = await readJson(path.resolve(__dirname, '../package.json'));
    console.log(pkg.version);
    return;
  }

  if (!options.projectName) {
    printHelp();
    throw new Error('Missing project name.');
  }

  const targetDir = path.resolve(process.cwd(), options.projectName);
  const projectName = path.basename(targetDir);
  const packageName = toPackageName(projectName);

  await ensureTargetDirectory(targetDir);

  let tempRoot = '';
  let templateRoot = '';

  try {
    if (options.template) {
      templateRoot = path.resolve(process.cwd(), options.template);
      await assertTemplateRoot(templateRoot);
    } else {
      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yzforge-template-'));
      await cloneTemplate({
        repo: options.repo || DEFAULT_REPO,
        ref: options.ref || DEFAULT_REF,
        cwd: tempRoot,
      });
      templateRoot = tempRoot;
    }

    await copyTemplate(templateRoot, targetDir);
    await rewriteProjectIdentity(targetDir, {
      projectName,
      packageName,
      uuid: crypto.randomUUID(),
    });
    await ensureFrameworkLock(targetDir);

    if (options.git) {
      run('git', ['init'], { cwd: targetDir });
    }

    if (!options.skipInstall) {
      run(options.packageManager, ['install'], { cwd: targetDir });
    }

    printSuccess({
      targetDir,
      projectName,
      packageName,
      installed: !options.skipInstall,
      packageManager: options.packageManager,
    });
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

function parseArgs(args) {
  const options = {
    projectName: '',
    repo: DEFAULT_REPO,
    ref: DEFAULT_REF,
    template: '',
    packageManager: 'npm',
    skipInstall: false,
    git: false,
    help: false,
    version: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }
    if (arg === '--skip-install') {
      options.skipInstall = true;
      continue;
    }
    if (arg === '--git') {
      options.git = true;
      continue;
    }
    if (arg === '--repo') {
      options.repo = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--ref') {
      options.ref = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--template') {
      options.template = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--package-manager') {
      options.packageManager = parsePackageManager(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.projectName) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    options.projectName = arg;
  }

  options.packageManager = parsePackageManager(options.packageManager);
  return options;
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parsePackageManager(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!['npm', 'pnpm', 'yarn'].includes(normalized)) {
    throw new Error(`Unsupported package manager: ${value}`);
  }
  return normalized;
}

async function ensureTargetDirectory(targetDir) {
  const parentDir = path.dirname(targetDir);
  await fs.mkdir(parentDir, { recursive: true });

  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      throw new Error(`Target exists and is not a directory: ${targetDir}`);
    }
    const entries = await fs.readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await fs.mkdir(targetDir, { recursive: true });
      return;
    }
    throw error;
  }
}

async function assertTemplateRoot(templateRoot) {
  await assertFile(path.join(templateRoot, 'package.json'));
  await assertFile(path.join(templateRoot, 'extensions/yzforge/package.json'));
  await assertFile(path.join(templateRoot, 'assets/app/main/Main.scene'));
}

async function assertFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Required template file is missing: ${filePath}`);
  }
}

async function cloneTemplate({ repo, ref, cwd }) {
  const args = ['clone', '--depth', '1'];
  if (ref) {
    args.push('--branch', ref);
  }
  args.push(repo, cwd);
  run('git', args, { cwd: process.cwd() });
}

async function copyTemplate(sourceRoot, targetRoot) {
  await copyDirectory(sourceRoot, targetRoot, '');
}

async function copyDirectory(sourceDir, targetDir, relativeDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (shouldExclude(relativePath, entry)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, relativePath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

function shouldExclude(relativePath, entry) {
  const posixPath = toPosix(relativePath);
  const segments = posixPath.split('/');

  if (entry.isDirectory()) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) {
      return true;
    }
    return EXCLUDED_PATHS.has(posixPath);
  }

  if (EXCLUDED_FILE_NAMES.has(entry.name)) {
    return true;
  }
  if (entry.name.endsWith('.log')) {
    return true;
  }
  if (EXCLUDED_FILES.has(posixPath)) {
    return true;
  }
  return segments.some((segment) => segment === 'node_modules');
}

async function rewriteProjectIdentity(targetDir, identity) {
  const packagePath = path.join(targetDir, 'package.json');
  const pkg = await readJson(packagePath);
  pkg.name = identity.packageName;
  pkg.uuid = identity.uuid;
  if (pkg.private !== true) {
    pkg.private = true;
  }
  await writeJson(packagePath, pkg);
}

async function ensureFrameworkLock(targetDir) {
  const lockPath = path.join(targetDir, '.yzforge/framework-lock.json');
  const extensionPackagePath = path.join(targetDir, 'extensions/yzforge/package.json');
  const extensionPackage = await readJson(extensionPackagePath);

  const lock = {
    schemaVersion: 1,
    framework: 'YZForge',
    version: extensionPackage.version || '0.0.0',
    channel: 'development',
    source: {
      kind: 'local-extension',
      package: 'extensions/yzforge/package.json',
    },
    note: 'YZForge is still in active development. Minor versions may include breaking migrations.',
  };

  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await writeJson(lockPath, lock);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toPackageName(projectName) {
  const baseName = path.basename(projectName).trim();
  const normalized = baseName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9._~-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (!normalized) {
    return 'yzforge-game';
  }
  if (/^[a-z0-9~][a-z0-9._~-]*$/.test(normalized)) {
    return normalized;
  }
  return `yzforge-${normalized.replace(/^[^a-z0-9~]+/, '') || 'game'}`;
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function run(command, args, options) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.`);
  }
}

function printHelp() {
  console.log(`create-yzforge

Usage:
  create-yzforge <project-name> [options]

Options:
  --repo <git-url>              Git repository used as the project template.
  --ref <git-ref>               Git branch or tag to clone. Default: ${DEFAULT_REF}
  --template <path>             Use a local YZForge template directory.
  --package-manager <pm>        npm, pnpm, or yarn. Default: npm
  --skip-install                Create files without running package install.
  --git                         Run git init in the created project.
  --version                     Print CLI version.
  --help                        Show this help.

Examples:
  npx create-yzforge@latest MyGame
  create-yzforge MyGame --ref main
  create-yzforge ../MyGame --template . --skip-install
`);
}

function printSuccess({ targetDir, projectName, packageName, installed, packageManager }) {
  const installHint = installed ? '' : `\n  ${packageManager} install`;
  console.log(`
Created YZForge project: ${projectName}
Package name: ${packageName}
Location: ${targetDir}

Next steps:
  cd ${targetDir}${installHint}
  ${packageManager} run yzforge:ai:doctor

Then open the project root with Cocos Creator 3.8.8.
`);
}

main().catch((error) => {
  console.error(`\ncreate-yzforge failed: ${error.message}`);
  process.exitCode = 1;
});
