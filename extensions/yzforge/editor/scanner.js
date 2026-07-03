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

function scanProject(projectRoot) {
  return {
    modules: scanModules(projectRoot),
    libraries: scanLibraries(projectRoot),
    contentPacks: scanContentPacks(projectRoot),
  };
}

module.exports = {
  scanContentPacks,
  scanLibraries,
  scanModules,
  scanProject,
};
