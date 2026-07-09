'use strict';

const fs = require('fs');
const path = require('path');
const { buildConfig, configDashboard, CONFIG_PLAN_PATH } = require('./config-builder');
const { generate } = require('./generate');
const { readJson, readJsonc, toPosix, writeJsonIfChanged, writeTextIfChanged } = require('./fs-utils');
const { scanProject } = require('./scanner');
const { runTypecheck } = require('./toolchain');
const { validate } = require('./validate');

const AI_CONTEXT_PATH = '.yzforge/ai-context.json';
const AI_SUMMARY_PATH = '.yzforge/ai-summary.md';

function lowerCamelCase(value) {
  const words = String(value || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  const [first, ...rest] = words;
  return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')}`;
}

function pascalCase(value) {
  const name = lowerCamelCase(value);
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : '';
}

function scopeLabel(scope = {}) {
  if (scope.kind === 'content-pack') {
    return `content-pack:${scope.owner}/${scope.name}`;
  }
  if (scope.kind === 'global') {
    return 'global';
  }
  return `${scope.kind || 'unknown'}:${scope.name || ''}`;
}

function configOutputDir(scope = {}) {
  if (scope.kind === 'global') {
    return 'assets/app/global/res/content/config';
  }
  if (scope.kind === 'module') {
    return `assets/modules/${scope.name}/res/content/config`;
  }
  if (scope.kind === 'library') {
    return `assets/libraries/${scope.name}/res/content/config`;
  }
  if (scope.kind === 'content-pack') {
    return `assets/content-packs/${scope.owner}/${scope.name}/res/content/config`;
  }
  return undefined;
}

function configGeneratedTsPath(scope = {}) {
  if (scope.kind === 'global') {
    return 'assets/app/global/code/generated/config.ts';
  }
  if (scope.kind === 'module') {
    return `assets/modules/${scope.name}/code/generated/config.ts`;
  }
  if (scope.kind === 'library') {
    return `assets/libraries/${scope.name}/code/generated/config.ts`;
  }
  if (scope.kind === 'content-pack') {
    return `assets/modules/${scope.owner}/code/generated/content-packs.ts`;
  }
  return undefined;
}

function configPayloadPath(table) {
  const dir = configOutputDir(table.scope);
  return dir ? `${dir}/${pascalCase(table.table)}.json` : undefined;
}

function readConfigMeta(projectRoot, table) {
  const rel = configPayloadPath(table);
  if (!rel) {
    return undefined;
  }
  const filePath = path.join(projectRoot, rel);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const payload = readJsonc(filePath);
    return payload && typeof payload === 'object' ? payload._yzforgeConfig : undefined;
  } catch (_error) {
    return undefined;
  }
}

function descriptorSummary(kind, descriptor) {
  return {
    kind,
    name: descriptor.name,
    ...(descriptor.owner ? { owner: descriptor.owner } : {}),
    ...(descriptor.id ? { id: descriptor.id } : {}),
    bundle: descriptor.bundle,
    path: descriptor.projectPath,
    libraries: descriptor.libraries || [],
  };
}

function readPackage(projectRoot) {
  const filePath = path.join(projectRoot, 'package.json');
  return fs.existsSync(filePath) ? readJson(filePath) : {};
}

function buildAiContext(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const project = scanProject(root);
  const dashboard = configDashboard(root);
  const packageJson = readPackage(root);
  const planTables = dashboard.plan && Array.isArray(dashboard.plan.tables) ? dashboard.plan.tables : [];
  const configTables = planTables.map((table) => {
    const meta = readConfigMeta(root, table);
    const output = configPayloadPath(table);
    return {
      id: table.id,
      label: table.label,
      scope: scopeLabel(table.scope),
      source: table.source,
      sheet: table.sheet,
      tableKey: table.table,
      rowType: meta?.row || `${pascalCase(table.table)}Row`,
      primaryKey: meta?.primaryKey || '<from Excel pk>',
      output,
      generatedApi: configGeneratedTsPath(table.scope),
      generateKeys: table.generateKeys !== false,
    };
  });

  return {
    schemaVersion: 1,
    project: {
      name: packageJson.name || 'yzforge-project',
      uuid: packageJson.uuid,
      cocosCreator: packageJson.creator?.version,
    },
    commands: {
      create: 'npm run yzforge:create -- <kind> <name> [--owner Owner]',
      generate: 'npm run yzforge:generate',
      generateCheck: 'npm run yzforge:generate:check',
      configBuild: 'npm run yzforge:config:build',
      configCheck: 'npm run yzforge:config:check',
      validateStrict: 'npm run yzforge:validate:strict',
      typecheck: 'npm run typecheck',
      aiContext: 'npm run yzforge:ai:context',
      aiDoctor: 'npm run yzforge:ai:doctor',
    },
    rules: {
      neverEdit: [
        'assets/**/code/generated/**',
        'assets/**/res/content/config/*.json',
        'assets/content-packs/**/manifest.generated.json',
      ],
      createWith: 'YZForge create commands or the YZForge Create panel.',
      assets: 'Use generated asset refs; do not handwrite resources.load, bundle.load, or cross-scope paths.',
      config: 'Edit Excel under config-source/excel and export-plan rules; build with yzforge:config:build.',
      configPrimaryKey: 'Excel header rule pk is the only primary-key source; an id field must be marked pk.',
      validation: 'Before finishing, run ai-doctor or the check commands listed above.',
    },
    scopes: {
      global: project.global ? descriptorSummary('global', project.global) : undefined,
      modules: project.modules.map((item) => descriptorSummary('module', item)),
      libraries: project.libraries.map((item) => descriptorSummary('library', item)),
      contentPacks: project.contentPacks.map((item) => descriptorSummary('content-pack', item)),
    },
    config: {
      excelRoot: 'config-source/excel',
      plan: CONFIG_PLAN_PATH,
      tables: configTables,
    },
    docs: {
      ai: 'docs/ai/README.md',
      developer: 'docs/dev/README.md',
      config: 'docs/dev/04-assets-and-config.md',
      validation: 'docs/dev/08-validation-and-build.md',
      troubleshooting: 'docs/dev/09-troubleshooting.md',
    },
  };
}

function renderAiSummary(context) {
  const lines = [
    '# YZForge AI Context',
    '',
    'This file is generated by `npm run yzforge:ai:context`.',
    '',
    '## Project',
    '',
    `- Name: ${context.project.name}`,
    `- Cocos Creator: ${context.project.cocosCreator || 'unknown'}`,
    '',
    '## Hard Rules',
    '',
    '- Do not edit generated files.',
    '- Do not handwrite dynamic resource paths.',
    '- Do not handwrite config JSON.',
    '- Config primary keys come from Excel `pk` rules only.',
    '- Run `npm run yzforge:ai:doctor` before finishing framework changes.',
    '',
    '## Scopes',
    '',
    `- Modules: ${context.scopes.modules.map((item) => item.name).join(', ') || 'none'}`,
    `- Libraries: ${context.scopes.libraries.map((item) => item.name).join(', ') || 'none'}`,
    `- Content Packs: ${context.scopes.contentPacks.map((item) => `${item.owner}/${item.name}`).join(', ') || 'none'}`,
    '',
    '## Config Tables',
    '',
  ];

  if (context.config.tables.length === 0) {
    lines.push('- none');
  } else {
    for (const table of context.config.tables) {
      lines.push(`- ${table.scope} / ${table.tableKey}: ${table.rowType}, pk ${table.primaryKey}`);
    }
  }

  lines.push(
    '',
    '## Commands',
    '',
    `- Generate check: \`${context.commands.generateCheck}\``,
    `- Config check: \`${context.commands.configCheck}\``,
    `- Strict validate: \`${context.commands.validateStrict}\``,
    `- Typecheck: \`${context.commands.typecheck}\``,
    `- AI doctor: \`${context.commands.aiDoctor}\``,
    '',
  );
  return lines.join('\n');
}

function writeAiContext(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const context = buildAiContext(root);
  const contextPath = path.join(root, AI_CONTEXT_PATH);
  const summaryPath = path.join(root, AI_SUMMARY_PATH);
  const changed = [];
  if (writeJsonIfChanged(contextPath, context)) {
    changed.push(AI_CONTEXT_PATH);
  }
  if (writeTextIfChanged(summaryPath, renderAiSummary(context))) {
    changed.push(AI_SUMMARY_PATH);
  }
  return {
    ok: true,
    context: AI_CONTEXT_PATH,
    summary: AI_SUMMARY_PATH,
    changed,
  };
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

function runCheck(name, command, task, advice) {
  try {
    const result = task();
    const ok = result && typeof result.ok === 'boolean'
      ? result.ok
      : true;
    return {
      name,
      command,
      ok,
      result,
      ...(ok ? {} : { advice }),
    };
  } catch (error) {
    return {
      name,
      command,
      ok: false,
      error: messageOf(error),
      advice,
    };
  }
}

function adviceForIssue(issue) {
  const code = issue.code || '';
  const message = issue.message || '';
  if (code.startsWith('generated.') || /generated/.test(message)) {
    return 'Do not edit generated files; change source inputs and run npm run yzforge:generate or npm run yzforge:config:build.';
  }
  if (code.startsWith('config.') || /config/i.test(message)) {
    return 'Fix config-source/excel or config-source/export-plan.json, then run npm run yzforge:config:build.';
  }
  if (code.startsWith('import.') || /import|boundary/.test(message)) {
    return 'Respect Scope boundaries; use public contracts, generated refs, Library, or ContentPack APIs.';
  }
  if (code.startsWith('ui.') || /AutoRef|View/.test(message)) {
    return 'Use generated UI refs and rerun npm run yzforge:generate.';
  }
  if (code.startsWith('prefab.')) {
    return 'Fix the prefab/script owner mismatch in Cocos or recreate via YZForge tools.';
  }
  return 'Read the referenced file, fix the source of truth, then rerun npm run yzforge:ai:doctor.';
}

function collectRecommendations(checks) {
  const recommendations = [];
  for (const check of checks) {
    if (check.ok) {
      continue;
    }
    if (check.name === 'strict validate' && Array.isArray(check.result?.issueDetails)) {
      for (const issue of check.result.issueDetails.slice(0, 12)) {
        recommendations.push({
          check: check.name,
          path: issue.path,
          code: issue.code,
          message: issue.message,
          action: adviceForIssue(issue),
        });
      }
      continue;
    }
    if (Array.isArray(check.result?.changed) && check.result.changed.length > 0) {
      recommendations.push({
        check: check.name,
        message: `${check.result.changed.length} generated file(s) are stale.`,
        changed: check.result.changed,
        action: check.advice,
      });
      continue;
    }
    recommendations.push({
      check: check.name,
      message: check.error || 'Check failed.',
      action: check.advice,
    });
  }
  return recommendations;
}

function runAiDoctor(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const checks = [
    runCheck(
      'config check',
      'npm run yzforge:config:check',
      () => buildConfig(root, { check: true }),
      'Run npm run yzforge:config:build and commit the generated config outputs.',
    ),
    runCheck(
      'generate check',
      'npm run yzforge:generate:check',
      () => {
        const result = generate(root, { check: true });
        return { ...result, ok: result.changed.length === 0 };
      },
      'Run npm run yzforge:generate and commit the generated outputs.',
    ),
    runCheck(
      'strict validate',
      'npm run yzforge:validate:strict',
      () => validate(root, { strict: true }),
      'Fix validator issues before continuing.',
    ),
  ];

  if (options.typecheck !== false) {
    checks.push(runCheck(
      'typecheck',
      'npm run typecheck',
      () => runTypecheck(root, { stdio: 'pipe' }),
      'Fix TypeScript errors, then rerun npm run typecheck.',
    ));
  }

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    checks,
    recommendations: collectRecommendations(checks),
  };
}

module.exports = {
  AI_CONTEXT_PATH,
  AI_SUMMARY_PATH,
  buildAiContext,
  renderAiSummary,
  runAiDoctor,
  writeAiContext,
};
