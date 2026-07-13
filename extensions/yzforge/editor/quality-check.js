'use strict';

const path = require('path');
const { runAiDoctor } = require('./ai-support');
const { smoke } = require('./smoke');

const CHECK_IDS = {
  'config check': 'config',
  'generate check': 'generate',
  'strict validate': 'validate',
  typecheck: 'typecheck',
};

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

async function runSmokeCheck(options = {}) {
  try {
    const result = await smoke({
      keep: options.keep === true,
    });
    return {
      id: 'smoke',
      name: 'smoke test',
      command: 'npm run yzforge:smoke',
      ok: result?.ok === true,
      result,
      ...(result?.ok === true ? {} : { advice: 'Fix smoke-test failures before submitting.' }),
    };
  } catch (error) {
    return {
      id: 'smoke',
      name: 'smoke test',
      command: 'npm run yzforge:smoke',
      ok: false,
      error: messageOf(error),
      advice: 'Fix smoke-test failures before submitting.',
    };
  }
}

async function runProjectCheck(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const includeSmoke = options.smoke === true || options.full === true;
  const doctor = runAiDoctor(root, { typecheck: true });
  const checks = doctor.checks.map((check) => ({
    ...check,
    id: CHECK_IDS[check.name] || check.name,
  }));
  const recommendations = [...doctor.recommendations];

  if (includeSmoke) {
    const smokeCheck = await runSmokeCheck(options);
    checks.push(smokeCheck);
    if (!smokeCheck.ok) {
      recommendations.push({
        check: smokeCheck.name,
        message: smokeCheck.error || 'Smoke test failed.',
        action: smokeCheck.advice,
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    mode: includeSmoke ? 'full' : 'standard',
    checks,
    recommendations,
  };
}

module.exports = {
  runProjectCheck,
};
