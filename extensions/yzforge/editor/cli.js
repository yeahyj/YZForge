'use strict';

const path = require('path');
const { validateBuildMatrix } = require('./build-matrix');
const { cleanGenerated } = require('./cleanup');
const { buildConfig, saveConfigPlanTable } = require('./config-builder');
const { create } = require('./create');
const { generate } = require('./generate');
const { smoke } = require('./smoke');
const { runCocosBuild, runTypecheck } = require('./toolchain');
const { validate } = require('./validate');

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

function parseConfigScope(value) {
  const text = String(value || '').trim();
  if (text === 'global') {
    return { kind: 'global' };
  }
  const match = text.match(/^(module|library|content-pack):(.+)$/);
  if (!match) {
    throw new Error(`Invalid config scope: ${text}. Use global, module:Name, library:Name, or content-pack:Owner/Name.`);
  }
  if (match[1] === 'content-pack') {
    const [owner, name] = match[2].split('/');
    if (!owner || !name) {
      throw new Error(`Invalid content-pack config scope: ${text}. Use content-pack:Owner/Name.`);
    }
    return { kind: 'content-pack', owner, name };
  }
  return { kind: match[1], name: match[2] };
}

async function main() {
  const command = process.argv[2] || 'validate';
  const projectRoot = path.resolve(process.cwd());

  if (command === 'generate') {
    const check = process.argv.includes('--check');
    const result = generate(projectRoot, { check });
    console.log(JSON.stringify(result, null, 2));
    if (check && result.changed.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'create') {
    const kind = process.argv[3];
    const name = process.argv[4];
    const ownerIndex = process.argv.indexOf('--owner');
    const owner = ownerIndex >= 0 ? process.argv[ownerIndex + 1] : process.argv[5];
    const options = kind === 'global-view'
      ? { name, owner: undefined }
      : { name, owner };
    const result = create(projectRoot, kind, options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'clean-generated') {
    const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--check');
    const result = cleanGenerated(projectRoot, { dryRun });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'config-build') {
    const check = process.argv.includes('--check');
    const result = buildConfig(projectRoot, { check });
    console.log(JSON.stringify(result, null, 2));
    if (check && !result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'config-table') {
    const args = process.argv.slice(3);
    const result = saveConfigPlanTable(projectRoot, {
      source: readOption(args, '--source', ''),
      sheet: readOption(args, '--sheet', ''),
      scope: parseConfigScope(readOption(args, '--scope', '')),
      table: readOption(args, '--table', undefined),
      row: readOption(args, '--row', undefined),
      primaryKey: readOption(args, '--primary-key', 'id'),
      format: readOption(args, '--format', 'json'),
      generateKeys: !args.includes('--no-keys'),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'validate') {
    const strict = process.argv.includes('--strict');
    const result = validate(projectRoot, { strict });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'validate-build-matrix') {
    const result = validateBuildMatrix(projectRoot);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'smoke') {
    const result = await smoke({ keep: process.argv.includes('--keep') });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'typecheck') {
    const result = runTypecheck(projectRoot, { args: process.argv.slice(3) });
    if (!result.ok) {
      process.exitCode = typeof result.status === 'number' ? result.status : 1;
    }
    return;
  }

  if (command === 'cocos-build') {
    const args = process.argv.slice(3);
    const result = runCocosBuild(projectRoot, {
      platform: readOption(args, '--platform', 'web-desktop'),
      outputName: readOption(args, '--output', 'yzforge-build-matrix'),
      buildPath: readOption(args, '--build-path', 'project://build'),
      logDest: readOption(args, '--log', undefined),
      debug: args.includes('--release') ? false : args.includes('--debug') ? true : true,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = typeof result.status === 'number' && result.status !== 0 ? result.status : 1;
    }
    return;
  }

  console.error(`Unknown YZForge command: ${command}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
