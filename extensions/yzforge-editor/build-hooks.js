'use strict';
const { execFile } = require('child_process');
const path = require('path');
exports.onBeforeBuild = async function () {
  await new Promise((resolve, reject) => execFile('node', [path.join(Editor.Project.path, 'tools/yzforge/cli.mjs'), 'check'],
    { cwd: Editor.Project.path, windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => error ? reject(Error(stderr || stdout)) : resolve()));
  await new Promise((resolve, reject) => execFile('node', [path.join(Editor.Project.path, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', path.join(Editor.Project.path, 'tsconfig.json')],
    { cwd: Editor.Project.path, windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => error ? reject(Error(stderr || stdout)) : resolve()));
};
