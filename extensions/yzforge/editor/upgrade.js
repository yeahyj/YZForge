'use strict';

const fs = require('fs');
const path = require('path');
const { runAiDoctor } = require('./ai-support');
const { generate } = require('./generate');
const { isTextChanged, readJsonc, toPosix, writeTextIfChanged } = require('./fs-utils');
const { FRAMEWORK_NAME, installedFrameworkVersion } = require('./version');

const FRAMEWORK_LOCK_PATH = '.yzforge/framework-lock.json';
const MIGRATIONS_ROOT = 'extensions/yzforge/migrations';

function lockPath(projectRoot) {
  return path.join(projectRoot, FRAMEWORK_LOCK_PATH);
}

function resolveProjectPath(projectRoot, relativePath) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, String(relativePath || ''));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Framework migration path must stay inside the project: ${relativePath}`);
  }
  return target;
}

function readFrameworkLock(projectRoot) {
  const filePath = lockPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return readJsonc(filePath);
}

function normalizeVersion(value) {
  return String(value || '').trim();
}

function parseVersion(value) {
  const version = normalizeVersion(value);
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) {
    throw new Error(`Invalid framework version '${version}'. Expected semantic version x.y.z.`);
  }
  return {
    parts: match.slice(1, 4).map((part) => Number.parseInt(part, 10)),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : (left.length === 0 ? 1 : -1);
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined || right[index] === undefined) {
      return left[index] === right[index] ? 0 : (left[index] === undefined ? -1 : 1);
    }
    if (left[index] === right[index]) {
      continue;
    }
    const leftNumber = /^\d+$/.test(left[index]);
    const rightNumber = /^\d+$/.test(right[index]);
    if (leftNumber && rightNumber) {
      return Number.parseInt(left[index], 10) > Number.parseInt(right[index], 10) ? 1 : -1;
    }
    if (leftNumber !== rightNumber) {
      return leftNumber ? -1 : 1;
    }
    return left[index].localeCompare(right[index]);
  }
  return 0;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) {
      return a.parts[index] > b.parts[index] ? 1 : -1;
    }
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function writeJson(projectRoot, relativePath, value, options, changed) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const filePath = resolveProjectPath(projectRoot, relativePath);
  const didChange = options.check
    ? isTextChanged(filePath, content)
    : writeTextIfChanged(filePath, content);
  if (didChange) {
    changed.push(toPosix(relativePath));
  }
}

function writeText(projectRoot, relativePath, content, options, changed) {
  const filePath = resolveProjectPath(projectRoot, relativePath);
  const didChange = options.check
    ? isTextChanged(filePath, content)
    : writeTextIfChanged(filePath, content);
  if (didChange) {
    changed.push(toPosix(relativePath));
  }
}

function removePath(projectRoot, relativePath, options, changed) {
  const filePath = resolveProjectPath(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    return;
  }
  changed.push(toPosix(relativePath));
  if (!options.check) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

function defaultFrameworkLock(version) {
  return {
    schemaVersion: 1,
    framework: FRAMEWORK_NAME,
    version,
    channel: 'development',
    source: {
      kind: 'local-extension',
      package: 'extensions/yzforge/package.json',
    },
    note: 'YZForge is still in active development. Minor versions may include breaking migrations.',
  };
}

function loadMigrations(projectRoot) {
  const root = path.join(projectRoot, MIGRATIONS_ROOT);
  if (!fs.existsSync(root)) {
    return [];
  }
  const migrations = fs.readdirSync(root)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const filePath = path.join(root, name);
      const migration = require(filePath);
      if (!migration || typeof migration !== 'object') {
        throw new Error(`${toPosix(path.relative(projectRoot, filePath))} must export a migration object.`);
      }
      if (!migration.from || !migration.to || typeof migration.run !== 'function') {
        throw new Error(`${toPosix(path.relative(projectRoot, filePath))} must export from, to, and run(context).`);
      }
      const from = normalizeVersion(migration.from);
      const to = normalizeVersion(migration.to);
      if (compareVersions(from, to) >= 0) {
        throw new Error(`${toPosix(path.relative(projectRoot, filePath))} must migrate to a newer semantic version.`);
      }
      return {
        id: migration.id || `${migration.from}-to-${migration.to}`,
        description: migration.description || '',
        from,
        to,
        run: migration.run,
        path: toPosix(path.relative(projectRoot, filePath)),
      };
    });
  const ids = new Set();
  const edges = new Set();
  for (const migration of migrations) {
    const edge = `${migration.from}->${migration.to}`;
    if (ids.has(migration.id)) {
      throw new Error(`Duplicate framework migration id: ${migration.id}`);
    }
    if (edges.has(edge)) {
      throw new Error(`Duplicate framework migration edge: ${edge}`);
    }
    ids.add(migration.id);
    edges.add(edge);
  }
  return migrations;
}

function resolveMigrationPath(migrations, fromVersion, toVersion) {
  const from = normalizeVersion(fromVersion);
  const to = normalizeVersion(toVersion);
  if (!from || from === to) {
    return [];
  }

  const queue = [{ version: from, path: [] }];
  const visited = new Set([from]);

  while (queue.length > 0) {
    const current = queue.shift();
    const nextMigrations = migrations
      .filter((migration) => migration.from === current.version
        && compareVersions(migration.to, current.version) > 0
        && compareVersions(migration.to, to) <= 0)
      .sort((a, b) => compareVersions(a.to, b.to));

    for (const migration of nextMigrations) {
      const nextPath = current.path.concat(migration);
      if (migration.to === to) {
        return nextPath;
      }
      if (!visited.has(migration.to)) {
        visited.add(migration.to);
        queue.push({ version: migration.to, path: nextPath });
      }
    }
  }

  return undefined;
}

function createMigrationContext(projectRoot, options, changed) {
  return {
    projectRoot,
    check: Boolean(options.check),
    readJson(relativePath, fallback = undefined) {
      const filePath = resolveProjectPath(projectRoot, relativePath);
      return fs.existsSync(filePath) ? readJsonc(filePath) : fallback;
    },
    readText(relativePath, fallback = undefined) {
      const filePath = resolveProjectPath(projectRoot, relativePath);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback;
    },
    exists(relativePath) {
      return fs.existsSync(resolveProjectPath(projectRoot, relativePath));
    },
    writeJson(relativePath, value) {
      writeJson(projectRoot, relativePath, value, options, changed);
    },
    writeText(relativePath, content) {
      writeText(projectRoot, relativePath, content, options, changed);
    },
    remove(relativePath) {
      removePath(projectRoot, relativePath, options, changed);
    },
  };
}

function runMigrations(projectRoot, migrations, options, changed) {
  const context = createMigrationContext(projectRoot, options, changed);
  const applied = [];
  for (const migration of migrations) {
    migration.run(context);
    applied.push({
      id: migration.id,
      from: migration.from,
      to: migration.to,
      description: migration.description,
      path: migration.path,
    });
  }
  return applied;
}

function upgradeFramework(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const targetVersion = installedFrameworkVersion(root);
  const currentLock = readFrameworkLock(root);
  const fromVersion = normalizeVersion(currentLock?.version);
  const changed = [];
  const migrations = loadMigrations(root);
  let migrationPlan = [];

  compareVersions(targetVersion, targetVersion);

  if (fromVersion && compareVersions(fromVersion, targetVersion) > 0) {
    throw new Error(`Cannot downgrade ${FRAMEWORK_NAME} from ${fromVersion} to ${targetVersion}.`);
  }

  if (fromVersion && compareVersions(fromVersion, targetVersion) < 0) {
    migrationPlan = resolveMigrationPath(migrations, fromVersion, targetVersion);
    if (!migrationPlan) {
      throw new Error(`No ${FRAMEWORK_NAME} migration path from ${fromVersion} to ${targetVersion}.`);
    }
  }

  const appliedMigrations = runMigrations(root, migrationPlan, options, changed);
  const nextLock = defaultFrameworkLock(targetVersion);
  const generated = generate(root, { check: Boolean(options.check) });
  const doctor = options.check || options.noDoctor
    ? undefined
    : runAiDoctor(root, { typecheck: options.typecheck !== false });
  const healthOk = doctor ? doctor.ok : true;

  if (options.check || healthOk) {
    writeJson(root, FRAMEWORK_LOCK_PATH, nextLock, options, changed);
  }
  const allChanged = Array.from(new Set(changed.concat(generated.changed || []))).sort((a, b) => a.localeCompare(b));
  const ok = healthOk && (!options.check || allChanged.length === 0);

  return {
    ok,
    check: Boolean(options.check),
    framework: FRAMEWORK_NAME,
    fromVersion: fromVersion || null,
    toVersion: targetVersion,
    alreadyCurrent: Boolean(fromVersion && fromVersion === targetVersion && allChanged.length === 0),
    developmentWarning: `${FRAMEWORK_NAME} is still in active development. Upgrades may include breaking changes; commit or back up your project before running them.`,
    lock: {
      path: FRAMEWORK_LOCK_PATH,
      changed: allChanged.includes(FRAMEWORK_LOCK_PATH),
      committed: !options.check && healthOk,
      value: nextLock,
    },
    migrations: {
      root: MIGRATIONS_ROOT,
      available: migrations.map((migration) => ({
        id: migration.id,
        from: migration.from,
        to: migration.to,
        description: migration.description,
        path: migration.path,
      })),
      applied: appliedMigrations,
    },
    changed: allChanged,
    generated,
    ...(doctor ? { doctor } : {}),
  };
}

module.exports = {
  FRAMEWORK_LOCK_PATH,
  MIGRATIONS_ROOT,
  compareVersions,
  readFrameworkLock,
  upgradeFramework,
};
