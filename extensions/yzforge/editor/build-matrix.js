'use strict';

const fs = require('fs');
const path = require('path');
const { toPosix } = require('./fs-utils');
const { resolveCocosTempAssembly } = require('./toolchain');

const BUILD_SCAN_EXTENSIONS = new Set(['.js', '.json', '.html', '.txt', '.log']);
const MAX_SCAN_BYTES = 5 * 1024 * 1024;
const MISSING_SCRIPT_DIAGNOSTIC = /\bmissing script\b|cc\.MissingScript|["']__type__["']\s*:\s*["'][^"']*MissingScript/i;

function parseAssemblyRecord(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const sanitized = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    return JSON.parse(sanitized);
  }
}

function analyzeAssemblyRecord(raw, target, rel) {
  const unresolved = [];
  let record;
  try {
    record = parseAssemblyRecord(raw);
  } catch (_error) {
    if (/"type"\s*:\s*"error"/.test(raw) && /\byzforge\b/.test(raw)) {
      unresolved.push({
        target,
        path: rel,
        code: 'cocos.import_resolution',
        message: `Cocos ${target} assembly contains an unresolved YZForge import.`,
      });
    }
    return {
      target,
      path: rel,
      status: unresolved.length > 0 ? 'failed' : 'unreadable',
      chunks: 0,
      yzforgeImports: 0,
      unresolved,
    };
  }

  const chunks = record?.chunks || {};
  let yzforgeImports = 0;
  for (const [chunkId, chunk] of Object.entries(chunks)) {
    const imports = chunk?.imports || {};
    for (const [specifier, importRecord] of Object.entries(imports)) {
      const resolved = importRecord?.resolved;
      const messages = Array.isArray(importRecord?.messages)
        ? importRecord.messages.map((message) => String(message))
        : [];
      const diagnostic = [
        specifier,
        resolved?.id,
        resolved?.specifier,
        resolved?.text,
        resolved?.message,
        ...messages,
      ].filter(Boolean).join(' ');
      if (specifier === 'yzforge' || /\byzforge\b/.test(diagnostic)) {
        yzforgeImports += 1;
      }
      if (resolved?.type !== 'error' || !/\byzforge\b/.test(diagnostic)) {
        continue;
      }
      unresolved.push({
        target,
        path: rel,
        code: 'cocos.import_resolution',
        specifier,
        chunkId,
        message: `Cocos ${target} assembly cannot resolve YZForge import '${specifier}' in chunk ${chunkId}: ${diagnostic}.`,
      });
    }
  }

  return {
    target,
    path: rel,
    status: unresolved.length > 0 ? 'failed' : 'passed',
    chunks: Object.keys(chunks).length,
    yzforgeImports,
    unresolved,
  };
}

function inspectAssemblyTarget(projectRoot, target, options = {}) {
  const filePath = resolveCocosTempAssembly(projectRoot, target);
  const rel = toPosix(path.relative(projectRoot, filePath));
  if (!fs.existsSync(filePath)) {
    const evidence = {
      target,
      path: rel,
      status: 'missing',
      required: options.required !== false,
      chunks: 0,
      yzforgeImports: 0,
      unresolved: [],
    };
    if (evidence.required) {
      evidence.unresolved.push({
        target,
        path: rel,
        code: 'cocos.assembly_missing',
        message: `Cocos ${target} assembly evidence is missing: ${rel}. Restart Cocos or run the target before validating the build matrix.`,
      });
    }
    return evidence;
  }
  try {
    return analyzeAssemblyRecord(fs.readFileSync(filePath, 'utf8'), target, rel);
  } catch (error) {
    return {
      target,
      path: rel,
      status: 'unreadable',
      required: options.required !== false,
      chunks: 0,
      yzforgeImports: 0,
      unresolved: [{
        target,
        path: rel,
        code: 'cocos.assembly_unreadable',
        message: `${rel} cannot be read: ${error.message}.`,
      }],
    };
  }
}

function inspectBuildOutputs(projectRoot) {
  const buildRoot = path.join(projectRoot, 'build');
  if (!fs.existsSync(buildRoot)) {
    return [{
      target: 'build',
      path: 'build',
      status: 'not_collected',
      required: false,
      message: 'No Cocos build output directory was found. Run a build target and rerun BuildMatrixValidator for build evidence.',
    }];
  }
  return fs.readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => inspectBuildOutput(projectRoot, entry.name));
}

function walkFiles(root, results = []) {
  if (!fs.existsSync(root)) {
    return results;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function inspectBuildOutput(projectRoot, targetName) {
  const target = `build:${targetName}`;
  const root = path.join(projectRoot, 'build', targetName);
  const relRoot = toPosix(path.relative(projectRoot, root));
  const files = walkFiles(root);
  const scannable = files.filter((filePath) => BUILD_SCAN_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  const unresolved = [];
  let scannedFiles = 0;
  let skippedLargeFiles = 0;
  let yzforgeBareImports = 0;
  let missingScriptMarkers = 0;
  let unresolvedMarkers = 0;

  for (const filePath of scannable) {
    const stat = fs.statSync(filePath);
    const rel = toPosix(path.relative(projectRoot, filePath));
    if (stat.size > MAX_SCAN_BYTES) {
      skippedLargeFiles += 1;
      continue;
    }
    scannedFiles += 1;
    const content = fs.readFileSync(filePath, 'utf8');
    const bareMatches = content.match(/\b(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]yzforge(?:\/[^'"]*)?['"]|\brequire\s*\(\s*['"]yzforge(?:\/[^'"]*)?['"]\s*\)/g) || [];
    if (bareMatches.length > 0) {
      yzforgeBareImports += bareMatches.length;
      unresolved.push({
        target,
        path: rel,
        code: 'build.bare_yzforge_import',
        message: `${rel} still contains bare YZForge runtime imports after build.`,
      });
    }
    if (/Failed to resolve ['"]?yzforge|Cannot find module ['"]yzforge|unresolved[^.\n\r]*yzforge/i.test(content)) {
      unresolvedMarkers += 1;
      unresolved.push({
        target,
        path: rel,
        code: 'build.unresolved_yzforge',
        message: `${rel} contains unresolved YZForge resolver diagnostics.`,
      });
    }
    if (MISSING_SCRIPT_DIAGNOSTIC.test(content)) {
      missingScriptMarkers += 1;
      unresolved.push({
        target,
        path: rel,
        code: 'build.missing_script',
        message: `${rel} contains MissingScript diagnostics.`,
      });
    }
  }

  return {
    target,
    path: relRoot,
    status: unresolved.length > 0 ? 'failed' : scannedFiles > 0 ? 'passed' : 'no_scannable_artifacts',
    required: false,
    files: files.length,
    scannedFiles,
    skippedLargeFiles,
    yzforgeBareImports,
    unresolvedMarkers,
    missingScriptMarkers,
    unresolved,
  };
}

function validateBuildMatrix(projectRoot, options = {}) {
  const targets = options.targets || ['editor', 'preview'];
  const assembly = targets.map((target) => inspectAssemblyTarget(projectRoot, target, { required: options.required !== false }));
  const build = options.includeBuild === false ? [] : inspectBuildOutputs(projectRoot);
  const issues = assembly.concat(build).flatMap((item) => item.unresolved || []);
  return {
    ok: issues.length === 0,
    targets: assembly.concat(build),
    issues: issues.map((issue) => issue.message),
    issueDetails: issues,
  };
}

module.exports = {
  analyzeAssemblyRecord,
  inspectAssemblyTarget,
  inspectBuildOutput,
  validateBuildMatrix,
};
