'use strict';

const fs = require('fs');
const path = require('path');

const FRAMEWORK_NAME = 'YZForge';
const FALLBACK_FRAMEWORK_VERSION = '0.2.0';

function readPackageVersion(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return typeof value.version === 'string' && value.version.trim()
      ? value.version.trim()
      : undefined;
  } catch (_error) {
    return undefined;
  }
}

function bundledFrameworkVersion() {
  return readPackageVersion(path.join(__dirname, '..', 'package.json')) || FALLBACK_FRAMEWORK_VERSION;
}

function installedFrameworkVersion(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  return readPackageVersion(path.join(root, 'extensions', 'yzforge', 'package.json'))
    || readPackageVersion(path.join(root, 'packages', 'yzforge-runtime', 'package.json'))
    || bundledFrameworkVersion();
}

const FRAMEWORK_VERSION = bundledFrameworkVersion();

module.exports = {
  FALLBACK_FRAMEWORK_VERSION,
  FRAMEWORK_NAME,
  FRAMEWORK_VERSION,
  installedFrameworkVersion,
};
