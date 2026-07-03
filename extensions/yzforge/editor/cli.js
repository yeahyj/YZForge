'use strict';

const path = require('path');
const { create } = require('./create');
const { generate } = require('./generate');
const { validate } = require('./validate');

async function main() {
  const command = process.argv[2] || 'validate';
  const projectRoot = path.resolve(process.cwd());

  if (command === 'generate') {
    const result = generate(projectRoot);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'create') {
    const kind = process.argv[3];
    const name = process.argv[4];
    const ownerIndex = process.argv.indexOf('--owner');
    const owner = ownerIndex >= 0 ? process.argv[ownerIndex + 1] : process.argv[5];
    const result = create(projectRoot, kind, { name, owner });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'validate') {
    const result = validate(projectRoot);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
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
