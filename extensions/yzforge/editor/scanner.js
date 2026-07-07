'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, toPosix } = require('./fs-utils');

function readDescriptor(filePath, projectRoot) {
  const data = readJson(filePath);
  return {
    ...data,
    filePath,
    projectPath: toPosix(path.relative(projectRoot, filePath)),
    dir: path.dirname(filePath),
  };
}

function scanModules(projectRoot) {
  const root = path.join(projectRoot, 'assets', 'modules');
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'module.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => readDescriptor(filePath, projectRoot))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanLibraries(projectRoot) {
  const root = path.join(projectRoot, 'assets', 'libraries');
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'library.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => readDescriptor(filePath, projectRoot))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanContentPacks(projectRoot) {
  const root = path.join(projectRoot, 'assets', 'content-packs');
  const packs = [];
  if (!fs.existsSync(root)) {
    return packs;
  }
  for (const owner of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const ownerRoot = path.join(root, owner.name);
    for (const pack of fs.readdirSync(ownerRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const filePath = path.join(ownerRoot, pack.name, 'content-pack.json');
      if (fs.existsSync(filePath)) {
        packs.push(readDescriptor(filePath, projectRoot));
      }
    }
  }
  return packs.sort((a, b) => `${a.owner}.${a.name}`.localeCompare(`${b.owner}.${b.name}`));
}

function scanOrphanScopes(projectRoot) {
  const orphans = [];
  const modulesRoot = path.join(projectRoot, 'assets', 'modules');
  if (fs.existsSync(modulesRoot)) {
    for (const entry of fs.readdirSync(modulesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const descriptor = path.join(modulesRoot, entry.name, 'module.json');
      if (!fs.existsSync(descriptor)) {
        const dir = path.join(modulesRoot, entry.name);
        orphans.push({
          kind: 'module',
          name: entry.name,
          dir,
          projectPath: toPosix(path.relative(projectRoot, dir)),
          expectedDescriptor: 'module.json',
        });
      }
    }
  }

  const librariesRoot = path.join(projectRoot, 'assets', 'libraries');
  if (fs.existsSync(librariesRoot)) {
    for (const entry of fs.readdirSync(librariesRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const descriptor = path.join(librariesRoot, entry.name, 'library.json');
      if (!fs.existsSync(descriptor)) {
        const dir = path.join(librariesRoot, entry.name);
        orphans.push({
          kind: 'library',
          name: entry.name,
          dir,
          projectPath: toPosix(path.relative(projectRoot, dir)),
          expectedDescriptor: 'library.json',
        });
      }
    }
  }

  const packsRoot = path.join(projectRoot, 'assets', 'content-packs');
  if (fs.existsSync(packsRoot)) {
    for (const owner of fs.readdirSync(packsRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const ownerRoot = path.join(packsRoot, owner.name);
      for (const pack of fs.readdirSync(ownerRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
        const descriptor = path.join(ownerRoot, pack.name, 'content-pack.json');
        if (!fs.existsSync(descriptor)) {
          const dir = path.join(ownerRoot, pack.name);
          orphans.push({
            kind: 'content-pack',
            owner: owner.name,
            name: pack.name,
            dir,
            projectPath: toPosix(path.relative(projectRoot, dir)),
            expectedDescriptor: 'content-pack.json',
          });
        }
      }
    }
  }

  return orphans.sort((a, b) => a.projectPath.localeCompare(b.projectPath));
}

function hasAnyFile(dir) {
  if (!fs.existsSync(dir)) {
    return false;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isFile()) {
      if (entry.name.endsWith('.meta') || entry.name === '.DS_Store') {
        continue;
      }
      return true;
    }
    if (entry.isDirectory() && hasAnyFile(child)) {
      return true;
    }
  }
  return false;
}

function scanGlobal(projectRoot) {
  const dir = path.join(projectRoot, 'assets', 'app', 'global');
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  if (!hasAnyFile(path.join(dir, 'code')) && !hasAnyFile(path.join(dir, 'res'))) {
    return undefined;
  }
  return {
    kind: 'global',
    name: 'Global',
    filePath: path.join(dir, 'code'),
    projectPath: 'assets/app/global',
    dir,
  };
}

function scanProject(projectRoot) {
  return {
    global: scanGlobal(projectRoot),
    modules: scanModules(projectRoot),
    libraries: scanLibraries(projectRoot),
    contentPacks: scanContentPacks(projectRoot),
    orphanScopes: scanOrphanScopes(projectRoot),
  };
}

module.exports = {
  scanContentPacks,
  scanGlobal,
  scanLibraries,
  scanModules,
  scanOrphanScopes,
  scanProject,
};
