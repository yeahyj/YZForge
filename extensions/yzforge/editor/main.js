'use strict';

const fs = require('fs');
const path = require('path');
const { cleanGenerated: cleanGeneratedFiles, collectGeneratedFiles } = require('./cleanup');
const { buildConfig, configDashboard, deleteConfigPlanTable, saveConfigPlanTable } = require('./config-builder');
const { create } = require('./create');
const { generate } = require('./generate');
const { validate } = require('./validate');
const { scanProject } = require('./scanner');
const { smoke } = require('./smoke');
const { kebabCase, toPosix } = require('./fs-utils');
const en = require('../i18n/en');
const zh = require('../i18n/zh');

function projectRoot() {
  return (global.Editor && Editor.Project && Editor.Project.path) || process.cwd();
}

function locale() {
  const language = global.Editor && Editor.I18n && typeof Editor.I18n.getLanguage === 'function'
    ? Editor.I18n.getLanguage()
    : 'en';
  return String(language || '').toLowerCase().startsWith('zh') ? zh : en;
}

function t(key) {
  const current = locale();
  return current[key] || en[key] || key;
}

function normalizeOptions(first, second) {
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return first;
  }
  if (typeof first === 'string') {
    return second && typeof second === 'object'
      ? { ...second, name: first }
      : { name: first };
  }
  return {};
}

const VIEW_KIND_PREFIXES = ['Page', 'Paper', 'Popup', 'Toast', 'Top', 'System'];
const MODULE_UNIT_SUFFIXES = ['Model', 'Service', 'Flow'];

function pascalCaseName(value) {
  const words = String(value || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  return words.map((word) => {
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  }).join('');
}

function knownKindPrefix(name) {
  return VIEW_KIND_PREFIXES.find((prefix) => name.startsWith(prefix) && name.length > prefix.length);
}

function knownUnitSuffix(name) {
  return MODULE_UNIT_SUFFIXES.find((suffix) => name.endsWith(suffix) && name.length > suffix.length);
}

function normalizeViewName(name, viewKind) {
  if (!name) {
    return '';
  }
  const prefix = VIEW_KIND_PREFIXES.includes(viewKind) ? viewKind : 'Page';
  const existingPrefix = knownKindPrefix(name);
  const core = existingPrefix ? name.slice(existingPrefix.length) : name;
  return `${prefix}${core}`;
}

function normalizePartName(name) {
  return name && !name.startsWith('Part') ? `Part${name}` : name;
}

function normalizeUnitName(name, suffix) {
  if (!name) {
    return '';
  }
  const existingSuffix = knownUnitSuffix(name);
  const core = existingSuffix ? name.slice(0, -existingSuffix.length) : name;
  return core ? `${core}${suffix}` : name;
}

function normalizeCreateOptions(kind, options = {}) {
  const next = { ...options };
  if (next.owner) {
    next.owner = pascalCaseName(next.owner);
  }
  if (next.name) {
    next.name = pascalCaseName(next.name);
    if (kind === 'view' || kind === 'global-view') {
      next.name = normalizeViewName(next.name, next.viewKind);
    } else if (kind === 'part') {
      next.name = normalizePartName(next.name);
    } else if (kind === 'model') {
      next.name = normalizeUnitName(next.name, 'Model');
    } else if (kind === 'service') {
      next.name = normalizeUnitName(next.name, 'Service');
    } else if (kind === 'flow') {
      next.name = normalizeUnitName(next.name, 'Flow');
    }
  }
  return next;
}

function requireName(options, label) {
  if (!options.name) {
    throw new Error(`${label} name is required.`);
  }
}

function requireOwner(options, label) {
  if (!options.owner) {
    throw new Error(`${label} owner module is required.`);
  }
}

async function assetDbRequest(method, ...args) {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    return undefined;
  }
  return await Editor.Message.request('asset-db', method, ...args);
}

async function refreshAsset(url) {
  try {
    await assetDbRequest('refresh-asset', url);
    return { url, refreshed: true };
  } catch (error) {
    return { url, refreshed: false, error: error.message };
  }
}

function bundleTarget(result) {
  if (result.kind === 'module') {
    return {
      url: `db://assets/modules/${result.name}`,
      bundleName: `yzforge-module-${kebabCase(result.name)}`,
      priority: 8,
    };
  }
  if (result.kind === 'library') {
    return {
      url: `db://assets/libraries/${result.name}`,
      bundleName: `yzforge-lib-${kebabCase(result.name)}`,
      priority: 7,
    };
  }
  if (result.kind === 'content-pack') {
    return {
      url: `db://assets/content-packs/${result.owner}/${result.name}`,
      bundleName: `yzforge-content-pack-${kebabCase(result.owner)}-${kebabCase(result.name)}`,
      priority: 6,
    };
  }
  return undefined;
}

async function configureBundle(target) {
  if (!target) {
    return undefined;
  }

  await refreshAsset(target.url);
  const meta = await assetDbRequest('query-asset-meta', target.url);
  if (!meta) {
    return {
      url: target.url,
      configured: false,
      reason: 'asset meta is not available yet',
    };
  }

  meta.userData = {
    ...(meta.userData || {}),
    isBundle: true,
    bundleName: target.bundleName,
    priority: meta.userData && meta.userData.priority !== undefined ? meta.userData.priority : target.priority,
    compressionType: meta.userData && meta.userData.compressionType ? meta.userData.compressionType : {},
    isRemoteBundle: meta.userData && meta.userData.isRemoteBundle ? meta.userData.isRemoteBundle : {},
  };
  await assetDbRequest('save-asset-meta', meta.uuid || target.url, JSON.stringify(meta));
  await refreshAsset(target.url);
  return {
    url: target.url,
    configured: true,
    bundleName: target.bundleName,
  };
}

async function queryAssetInfo(url) {
  try {
    return await assetDbRequest('query-asset-info', url);
  } catch (error) {
    return undefined;
  }
}

function asAssetUrl(relativePath) {
  return relativePath ? `db://${toPosix(relativePath)}` : undefined;
}

function pathFromAssetUrl(url) {
  const normalized = toPosix(url);
  return normalized.startsWith('db://') ? normalized.slice('db://'.length) : undefined;
}

function normalizePrefabContent(serialized) {
  if (serialized === undefined || serialized === null) {
    throw new Error('Prefab serializer returned empty content.');
  }
  const raw = serialized && typeof serialized === 'object' && 'content' in serialized
    ? serialized.content
    : serialized;
  const content = typeof raw === 'string'
    ? raw
    : JSON.stringify(raw, null, 2);
  JSON.parse(content);
  return content;
}

function writePrefabFileFallback(targetUrl, content) {
  if (!targetUrl.startsWith('db://assets/')) {
    return false;
  }
  const relative = targetUrl.slice('db://'.length);
  const filePath = path.join(projectRoot(), relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  return true;
}

function hasEditorAssetDb() {
  return Boolean(global.Editor && Editor.Message && typeof Editor.Message.request === 'function');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleWithTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        timeout: true,
        error: `${label} timed out after ${ms}ms`,
      });
    }, ms);
  });
  try {
    return await Promise.race([
      Promise.resolve(promise)
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({
          ok: false,
          error: error && error.message ? error.message : String(error),
        })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function fileDetail(relativePath) {
  const normalized = toPosix(relativePath);
  return {
    path: normalized,
    url: normalized.startsWith('assets/') ? asAssetUrl(normalized) : undefined,
  };
}

function assetUrlDetail(url, extra = {}) {
  const path = pathFromAssetUrl(url);
  return {
    ...extra,
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
  };
}

function extractIssuePath(issue) {
  const normalized = toPosix(issue);
  const root = toPosix(projectRoot());
  const rootIndex = normalized.indexOf(`${root}/`);
  if (rootIndex >= 0) {
    const rel = normalized.slice(rootIndex + root.length + 1).match(/^[^\s:'")]+/)?.[0];
    return rel ? rel.replace(/[.,]+$/, '') : undefined;
  }

  const match = normalized.match(/\b((?:assets|extensions|docs)\/[^\s:'")]+|(?:import-map|tsconfig)\.json)\b/);
  return match ? match[1].replace(/[.,]+$/, '') : undefined;
}

function issueDetail(issue) {
  const path = extractIssuePath(issue);
  return {
    message: issue,
    ...(path ? fileDetail(path) : {}),
  };
}

function withGeneratedDetails(result) {
  return {
    ...result,
    changedDetails: (result.changed || []).map(fileDetail),
  };
}

function withValidationDetails(result) {
  return {
    ...result,
    issueDetails: result.issueDetails || (result.issues || []).map(issueDetail),
  };
}

function withCleanDetails(result) {
  const files = result.files || [];
  const protectedFiles = result.protected || [];
  const removed = result.removed || [];
  const failed = result.failed || [];
  return {
    ...result,
    summary: {
      total: typeof result.total === 'number' ? result.total : files.length + protectedFiles.length,
      cleanable: files.length,
      protected: protectedFiles.length,
      removed: removed.length,
      failed: failed.length,
      dryRun: result.dryRun === true,
      includeScripts: result.includeScripts === true,
    },
    fileDetails: files.map(fileDetail),
    protectedDetails: protectedFiles.map(fileDetail),
    removedDetails: removed.map(fileDetail),
    failedDetails: failed.map((item) => ({
      ...item,
      ...fileDetail(item.path),
    })),
  };
}

function withRuntimeResourceDetails(result) {
  const diagnostics = result && result.snapshot && result.snapshot.resourceDiagnostics;
  if (!diagnostics) {
    return result;
  }
  return {
    ...result,
    resourceDiagnosticsSummary: {
      healthy: diagnostics.healthy === true,
      holdingCount: diagnostics.holdingCount || 0,
      leakCount: diagnostics.leakCount || 0,
      failedReleaseCount: diagnostics.failedReleaseCount || 0,
      hotBundleCount: diagnostics.hotBundleCount || 0,
      failedBundleCount: diagnostics.failedBundleCount || 0,
    },
    details: (diagnostics.details || []).map((item) => ({
      severity: item.severity,
      code: item.code,
      ownerKey: item.ownerKey,
      kind: item.kind,
      key: item.key,
      message: [
        item.severity ? item.severity.toUpperCase() : undefined,
        item.code,
        item.message,
      ].filter(Boolean).join(' | '),
    })),
  };
}

function isGeneratedScript(relativePath) {
  return /\.generated\.ts$/.test(toPosix(relativePath));
}

function editorCleanPlan(files, options = {}) {
  if (options.includeScripts === true || options.force === true) {
    return {
      files,
      protected: [],
    };
  }
  const protectedFiles = [];
  const cleanableFiles = [];
  for (const file of files) {
    if (isGeneratedScript(file)) {
      protectedFiles.push(file);
    } else {
      cleanableFiles.push(file);
    }
  }
  return {
    files: cleanableFiles,
    protected: protectedFiles,
  };
}

function pushUniqueDetail(details, seen, detail) {
  const key = detail.url || detail.path || detail.message || detail.code;
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  details.push(detail);
}

function createTargetDetails(kind, options = {}) {
  const name = options.name;
  const owner = options.owner;
  const details = [];
  if (owner) {
    details.push({
      ...fileDetail(`assets/modules/${owner}/module.json`),
      code: 'create.owner_module',
      message: `assets/modules/${owner}/module.json`,
    });
  }
  if (!name) {
    return details;
  }
  if (kind === 'module') {
    details.push({ ...fileDetail(`assets/modules/${name}/module.json`), code: 'create.target', message: `assets/modules/${name}/module.json` });
  } else if (kind === 'library') {
    details.push({ ...fileDetail(`assets/libraries/${name}/library.json`), code: 'create.target', message: `assets/libraries/${name}/library.json` });
  } else if (kind === 'content-pack' && owner) {
    details.push({ ...fileDetail(`assets/content-packs/${owner}/${name}/content-pack.json`), code: 'create.target', message: `assets/content-packs/${owner}/${name}/content-pack.json` });
  } else if (kind === 'view' && owner) {
    details.push({ ...fileDetail(`assets/modules/${owner}/code/view/${name}.ts`), code: 'create.target', message: `assets/modules/${owner}/code/view/${name}.ts` });
    details.push({ ...fileDetail(`assets/modules/${owner}/res/view/${name}.prefab`), code: 'create.prefab_target', message: `assets/modules/${owner}/res/view/${name}.prefab` });
  } else if (kind === 'global-view') {
    details.push({ ...fileDetail(`assets/app/global/code/view/${name}.ts`), code: 'create.target', message: `assets/app/global/code/view/${name}.ts` });
    details.push({ ...fileDetail(`assets/app/global/res/view/${name}.prefab`), code: 'create.prefab_target', message: `assets/app/global/res/view/${name}.prefab` });
  } else if (kind === 'part' && owner) {
    details.push({ ...fileDetail(`assets/modules/${owner}/code/part/${name}.ts`), code: 'create.target', message: `assets/modules/${owner}/code/part/${name}.ts` });
    details.push({ ...fileDetail(`assets/modules/${owner}/res/part/${name}.prefab`), code: 'create.prefab_target', message: `assets/modules/${owner}/res/part/${name}.prefab` });
  } else if (['model', 'service', 'flow'].includes(kind) && owner) {
    details.push({ ...fileDetail(`assets/modules/${owner}/code/${kind}/${name}.ts`), code: 'create.target', message: `assets/modules/${owner}/code/${kind}/${name}.ts` });
  } else if (kind === 'event-file' && owner) {
    details.push({ ...fileDetail(`assets/modules/${owner}/code/events/${name}.ts`), code: 'create.target', message: `assets/modules/${owner}/code/events/${name}.ts` });
    details.push({ ...fileDetail(`assets/modules/${owner}/code/events/index.ts`), code: 'create.index', message: `assets/modules/${owner}/code/events/index.ts` });
  } else if (kind === 'extension-stub') {
    details.push({ ...fileDetail(`assets/app/extensions/${name}.ts`), code: 'create.target', message: `assets/app/extensions/${name}.ts` });
  }
  return details;
}

function createResultDetails(result, generated, assetDb) {
  const details = [];
  const seen = new Set();
  for (const relative of result.changed || []) {
    pushUniqueDetail(details, seen, {
      ...fileDetail(relative),
      code: 'create.source',
      message: relative,
    });
  }
  for (const item of generated.changedDetails || []) {
    pushUniqueDetail(details, seen, {
      ...item,
      code: 'create.generated',
      message: item.path,
    });
  }
  const prefab = assetDb && assetDb.prefab;
  if (prefab && prefab.target) {
    const status = prefab.created
      ? 'created'
      : prefab.overwritten
        ? 'overwritten'
        : 'skipped';
    pushUniqueDetail(details, seen, assetUrlDetail(prefab.target, {
      code: `create.prefab_${status}`,
      message: pathFromAssetUrl(prefab.target) || prefab.target,
      status,
      reason: prefab.reason,
    }));
  }
  for (const refreshed of assetDb?.refreshed || []) {
    if (refreshed && refreshed.refreshed === false) {
      pushUniqueDetail(details, seen, assetUrlDetail(refreshed.url, {
        code: 'asset_db.refresh_failed',
        message: refreshed.error || refreshed.url,
        severity: 'warning',
      }));
    }
  }
  const bundle = assetDb?.bundle;
  if (bundle && bundle.configured === false) {
    pushUniqueDetail(details, seen, assetUrlDetail(bundle.url, {
      code: 'asset_db.bundle_pending',
      message: bundle.reason || bundle.url,
      severity: 'warning',
    }));
  }
  const focus = assetDb?.focus;
  if (focus && focus.url) {
    pushUniqueDetail(details, seen, assetUrlDetail(focus.url, {
      code: focus.selected || focus.opened ? 'asset_db.focus' : 'asset_db.focus_pending',
      message: pathFromAssetUrl(focus.url) || focus.url,
      severity: focus.selected || focus.opened ? 'info' : 'warning',
    }));
  }
  return details;
}

function createFailureResult(kind, options, error) {
  const message = error && error.message ? error.message : String(error);
  const targetDetails = createTargetDetails(kind, options);
  const primary = targetDetails[0] || {};
  const details = [{
    ...primary,
    severity: 'error',
    code: 'create.failed',
    message,
  }, ...targetDetails];
  return {
    ok: false,
    kind,
    name: options.name,
    owner: options.owner,
    error: message,
    details,
    issueDetails: [{
      severity: 'error',
      code: 'create.failed',
      message,
      ...(primary.path ? { path: primary.path, url: primary.url } : {}),
    }],
  };
}

async function selectAsset(url) {
  const result = {
    url,
    selected: false,
    opened: false,
    warnings: [],
  };
  if (!url) {
    result.warnings.push('asset url is empty');
    return result;
  }

  let info;
  const infoResult = await settleWithTimeout(queryAssetInfo(url), 3000, `query asset info ${url}`);
  if (infoResult.ok) {
    info = infoResult.value;
  } else {
    result.warnings.push(infoResult.error);
  }

  const uuid = info && (info.uuid || info.id);
  result.uuid = uuid;
  if (!uuid) {
    result.warnings.push('asset uuid is not available yet');
    return result;
  }

  try {
    if (global.Editor && Editor.Selection && typeof Editor.Selection.select === 'function') {
      Editor.Selection.select('asset', uuid);
      result.selected = true;
    } else {
      result.warnings.push('Editor.Selection.select is unavailable');
    }
  } catch (error) {
    result.warnings.push(`select asset failed: ${error.message}`);
  }

  const openResult = await settleWithTimeout(assetDbRequest('open-asset', uuid), 5000, `open asset ${url}`);
  if (openResult.ok) {
    result.opened = true;
  } else {
    result.warnings.push(openResult.error);
  }

  return result;
}

function preferredAssetUrl(result, prefab) {
  if (prefab && prefab.target) {
    return prefab.target;
  }
  if (result.kind === 'module') {
    return asAssetUrl(`assets/modules/${result.name}/module.json`);
  }
  if (result.kind === 'library') {
    return asAssetUrl(`assets/libraries/${result.name}/library.json`);
  }
  if (result.kind === 'content-pack') {
    return asAssetUrl(`assets/content-packs/${result.owner}/${result.name}/content-pack.json`);
  }
  if (result.changed && result.changed[0]) {
    return asAssetUrl(result.changed[0]);
  }
  return undefined;
}

function changedAssetUrls(result, generated, prefab) {
  const urls = new Set();
  for (const relative of result.changed || []) {
    urls.add(asAssetUrl(relative));
  }
  for (const relative of generated.changed || []) {
    urls.add(asAssetUrl(relative));
  }
  if (prefab && prefab.target) {
    urls.add(prefab.target);
  }
  urls.delete(undefined);
  return Array.from(urls);
}

async function refreshCreatedAssets(urls) {
  const refreshed = [];
  for (const url of urls) {
    refreshed.push(await refreshAsset(url));
  }
  return refreshed;
}

async function cleanGeneratedAssets(options = {}) {
  const root = projectRoot();
  const dryRun = Boolean(options.dryRun || options.check);
  const includeScripts = options.includeScripts === true || options.force === true;
  const allFiles = collectGeneratedFiles(root);
  const plan = editorCleanPlan(allFiles, {
    ...options,
    includeScripts,
  });
  if (dryRun) {
    return withCleanDetails({
      ok: true,
      dryRun: true,
      includeScripts,
      count: plan.files.length,
      total: allFiles.length,
      files: plan.files,
      protected: plan.protected,
      removed: [],
      failed: [],
    });
  }

  if (!hasEditorAssetDb()) {
    const result = cleanGeneratedFiles(root, {
      includeScripts,
    });
    return withCleanDetails({
      ...result,
      total: allFiles.length,
      includeScripts,
      protected: plan.protected,
    });
  }

  const removed = [];
  const failed = [];
  for (const relative of plan.files) {
    try {
      await assetDbRequest('delete-asset', asAssetUrl(relative));
      removed.push(relative);
    } catch (error) {
      failed.push({
        path: relative,
        reason: error.message,
      });
    }
  }
  await refreshAsset('db://assets/app');
  await refreshAsset('db://assets/modules');
  await refreshAsset('db://assets/libraries');
  await refreshAsset('db://assets/content-packs');

  return withCleanDetails({
    ok: failed.length === 0,
    dryRun: false,
    includeScripts,
    count: removed.length,
    total: allFiles.length,
    files: plan.files,
    protected: plan.protected,
    removed,
    failed,
  });
}

async function collectProjectDiagnostics() {
  const root = projectRoot();
  const summary = describeProject();
  const generated = withGeneratedDetails(generate(root, { check: true }));
  const clean = await cleanGeneratedAssets({ dryRun: true });
  const validation = withValidationDetails(validate(root, { strict: true }));
  return {
    ok: generated.changed.length === 0 && validation.ok,
    summary,
    generated,
    clean,
    validation,
  };
}

async function collectRuntimeSnapshot() {
  if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
    return {
      ok: false,
      running: false,
      reason: 'Editor.Message.request is unavailable',
    };
  }

  try {
    const result = await Editor.Message.request('scene', 'execute-scene-script', {
      name: 'yzforge',
      method: 'getRuntimeSnapshot',
      args: [],
    });
    return withRuntimeResourceDetails(result);
  } catch (error) {
    return {
      ok: false,
      running: false,
      reason: error.message,
    };
  }
}

async function sceneRequest(method, args = []) {
  return await Editor.Message.request('scene', 'execute-scene-script', {
    name: 'yzforge',
    method,
    args,
  });
}

async function waitForSceneComponent(componentName, options = {}) {
  if (!componentName || options.requireComponent === false) {
    return {
      componentName,
      available: true,
      attempts: 0,
    };
  }

  const attempts = options.attempts || 8;
  const delayMs = options.delayMs || 300;
  let lastReason;
  for (let index = 0; index < attempts; index += 1) {
    try {
      if (await sceneRequest('hasComponentClass', [componentName])) {
        return {
          componentName,
          available: true,
          attempts: index + 1,
        };
      }
      lastReason = 'component class is not registered yet';
    } catch (error) {
      lastReason = error.message;
    }
    await sleep(delayMs);
  }

  return {
    componentName,
    available: false,
    attempts,
    reason: lastReason,
  };
}

async function createUiPrefab(result, options) {
  if (!['view', 'global-view', 'part'].includes(result.kind) || options.prefab === false) {
    return undefined;
  }
  if (!result.prefab) {
    return undefined;
  }

  const targetUrl = `db://${result.prefab}`;
  const existing = await queryAssetInfo(targetUrl);
  if (existing && options.overwrite !== true) {
    return {
      target: targetUrl,
      created: false,
      reason: 'target prefab already exists',
    };
  }

  const componentReady = await waitForSceneComponent(result.name, {
    requireComponent: options.requireComponent !== false,
  });
  if (!componentReady.available) {
    return {
      target: targetUrl,
      created: false,
      reason: `Component class is not available in scene process: ${result.name}. ${componentReady.reason || ''}`.trim(),
      componentReady,
    };
  }

  let serialized;
  try {
    serialized = await sceneRequest('createUiPrefab', [{
        name: result.name,
        componentName: result.name,
        kind: result.kind,
        viewKind: options.viewKind || result.viewKind,
        requireComponent: options.requireComponent !== false,
    }]);
  } catch (error) {
    return {
      target: targetUrl,
      created: false,
      reason: error.message,
    };
  }

  let content;
  try {
    content = normalizePrefabContent(serialized);
  } catch (error) {
    return {
      target: targetUrl,
      created: false,
      reason: error.message,
    };
  }

  const method = existing && options.overwrite === true ? 'save-asset' : 'create-asset';
  let saveMethod = `asset-db:${method}`;
  try {
    await assetDbRequest(method, targetUrl, content);
  } catch (error) {
    if (!writePrefabFileFallback(targetUrl, content)) {
      throw error;
    }
    saveMethod = `fs-write (${error.message})`;
  }
  await refreshAsset(targetUrl);
  return {
    target: targetUrl,
    created: !existing,
    overwritten: Boolean(existing && options.overwrite === true),
    componentAttached: serialized.componentAttached,
    componentReady,
    viewKind: serialized.viewKind,
    warnings: serialized.warnings || [],
    saveMethod,
  };
}

async function postCreate(result, options) {
  const refreshed = [];
  if (result.kind === 'module') {
    refreshed.push(await refreshAsset('db://assets/modules'));
    refreshed.push(await refreshAsset(`db://assets/modules/${result.name}`));
  } else if (result.kind === 'library') {
    refreshed.push(await refreshAsset('db://assets/libraries'));
    refreshed.push(await refreshAsset(`db://assets/libraries/${result.name}`));
  } else if (result.kind === 'content-pack') {
    refreshed.push(await refreshAsset('db://assets/content-packs'));
    refreshed.push(await refreshAsset(`db://assets/content-packs/${result.owner}/${result.name}`));
  } else if (result.kind === 'extension-stub') {
    refreshed.push(await refreshAsset('db://assets/app'));
    refreshed.push(await refreshAsset('db://assets/app/extensions'));
  } else if (result.kind === 'global-view') {
    refreshed.push(await refreshAsset('db://assets/app'));
    refreshed.push(await refreshAsset('db://assets/app/global'));
  } else if (result.owner) {
    refreshed.push(await refreshAsset(`db://assets/modules/${result.owner}`));
  }

  refreshed.push(...await refreshCreatedAssets((result.changed || []).map(asAssetUrl)));
  const prefab = await createUiPrefab(result, options);
  const generated = withGeneratedDetails(generate(projectRoot()));
  const createdUrls = changedAssetUrls(result, generated, prefab);
  refreshed.push(...await refreshCreatedAssets(createdUrls));
  const bundle = await configureBundle(bundleTarget(result));
  const focus = await selectAsset(preferredAssetUrl(result, prefab));
  const assetDb = {
    refreshed,
    bundle,
    prefab,
    focus,
  };

  return {
    ok: true,
    ...result,
    changedDetails: (result.changed || []).map(fileDetail),
    details: createResultDetails(result, generated, assetDb),
    assetDb,
    generated,
  };
}

async function createKind(kind, options) {
  const root = projectRoot();
  const normalizedOptions = normalizeCreateOptions(kind, options);
  try {
    const result = create(root, kind, normalizedOptions);
    const completed = await postCreate(result, normalizedOptions);
    console.log(`[YZForge] created ${kind}:`, completed);
    return completed;
  } catch (error) {
    const failed = createFailureResult(kind, normalizedOptions, error);
    console.warn(`[YZForge] create ${kind} failed:`, failed);
    return failed;
  }
}

async function refreshChangedFiles(changed) {
  const refreshed = [];
  for (const relativePath of changed || []) {
    const url = asAssetUrl(relativePath);
    if (url) {
      refreshed.push(await refreshAsset(url));
    }
  }
  return refreshed;
}

function showCreateHelp() {
  const message = t('create_help_detail');
  if (global.Editor && Editor.Dialog && typeof Editor.Dialog.info === 'function') {
    Editor.Dialog.info(t('create_help_title'), { detail: message });
  }
  console.log(`[YZForge]\n${message}`);
  return { ok: true, message };
}

function describeProject() {
  const project = scanProject(projectRoot());
  return {
    modules: project.modules.map((item) => ({
      name: item.name,
      bundle: item.bundle,
      path: item.projectPath,
    })),
    libraries: project.libraries.map((item) => ({
      name: item.name,
      bundle: item.bundle,
      path: item.projectPath,
    })),
    contentPacks: project.contentPacks.map((item) => ({
      id: item.id,
      owner: item.owner,
      name: item.name,
      bundle: item.bundle,
      path: item.projectPath,
    })),
  };
}

exports.load = function load() {
  console.log('[YZForge] editor extension loaded.');
};

exports.unload = function unload() {
  console.log('[YZForge] editor extension unloaded.');
};

exports.methods = {
  openPanel() {
    return Editor.Panel.open('yzforge');
  },

  openCreatePanel() {
    return Editor.Panel.open('yzforge.create');
  },

  openConfigPanel() {
    return Editor.Panel.open('yzforge.config');
  },

  getProjectSummary() {
    return describeProject();
  },

  showCreateHelp,

  async generateAll() {
    const result = withGeneratedDetails(generate(projectRoot()));
    console.log('[YZForge] generate all:', result);
    return result;
  },

  async generateCheck() {
    const result = withGeneratedDetails(generate(projectRoot(), { check: true }));
    console.log('[YZForge] generate check:', result);
    return result;
  },

  async cleanGenerated(first) {
    const options = normalizeOptions(first);
    const result = await cleanGeneratedAssets(options);
    console.log('[YZForge] clean generated:', result);
    return result;
  },

  async cleanGeneratedPreview(first) {
    const options = normalizeOptions(first);
    const result = await cleanGeneratedAssets({
      ...options,
      dryRun: true,
    });
    console.log('[YZForge] clean generated preview:', result);
    return result;
  },

  async projectDiagnostics() {
    const result = await collectProjectDiagnostics();
    console.log('[YZForge] project diagnostics:', result);
    return result;
  },

  async runtimeSnapshot() {
    const result = await collectRuntimeSnapshot();
    console.log('[YZForge] runtime snapshot:', result);
    return result;
  },

  async smokeTest(first) {
    const options = normalizeOptions(first);
    const result = await smoke({
      keep: options.keep === true,
    });
    console.log('[YZForge] smoke test:', result);
    return result;
  },

  async focusAsset(first) {
    const options = normalizeOptions(first);
    const url = options.url || asAssetUrl(options.path);
    return await selectAsset(url);
  },

  async validateArchitecture() {
    const result = withValidationDetails(validate(projectRoot()));
    console.log('[YZForge] validate architecture:', result);
    return result;
  },

  async validateArchitectureStrict() {
    const result = withValidationDetails(validate(projectRoot(), { strict: true }));
    console.log('[YZForge] validate architecture strict:', result);
    return result;
  },

  async configDashboard() {
    const result = configDashboard(projectRoot());
    console.log('[YZForge] config dashboard:', result);
    return result;
  },

  async saveConfigTable(first, second) {
    const options = normalizeOptions(first, second);
    const result = saveConfigPlanTable(projectRoot(), options);
    console.log('[YZForge] save config table:', result);
    return result;
  },

  async deleteConfigTable(first, second) {
    const options = normalizeOptions(first, second);
    const result = deleteConfigPlanTable(projectRoot(), options);
    console.log('[YZForge] delete config table:', result);
    return result;
  },

  async configBuild() {
    const result = buildConfig(projectRoot());
    const refreshed = await refreshChangedFiles(result.changed);
    const completed = { ...result, refreshed };
    console.log('[YZForge] config build:', completed);
    return completed;
  },

  async configCheck() {
    const result = buildConfig(projectRoot(), { check: true });
    console.log('[YZForge] config check:', result);
    return result;
  },

  async createModule(first, second) {
    const options = normalizeOptions(first, second);
    requireName(options, 'Module');
    return await createKind('module', options);
  },

  async createLibrary(first, second) {
    const options = normalizeOptions(first, second);
    requireName(options, 'Library');
    return await createKind('library', options);
  },

  async createContentPack(first, second) {
    const options = normalizeOptions(first, second);
    requireOwner(options, 'ContentPack');
    requireName(options, 'ContentPack');
    return await createKind('content-pack', options);
  },

  async createModuleView(first, second) {
    const options = normalizeOptions(first, second);
    requireOwner(options, 'View');
    requireName(options, 'View');
    return await createKind('view', options);
  },

  async createGlobalView(first, second) {
    const options = normalizeOptions(first, second);
    requireName(options, 'Global View');
    return await createKind('global-view', options);
  },

  async createPart(first, second) {
    const options = normalizeOptions(first, second);
    requireOwner(options, 'Part');
    requireName(options, 'Part');
    return await createKind('part', options);
  },

  async createModel(first, second) {
    const options = normalizeOptions(first, second);
    requireOwner(options, 'Model');
    requireName(options, 'Model');
    return await createKind('model', options);
  },

  async createService(first, second) {
    const options = normalizeOptions(first, second);
    requireOwner(options, 'Service');
    requireName(options, 'Service');
    return await createKind('service', options);
  },

  async createFlow(first, second) {
    const options = normalizeOptions(first, second);
    requireOwner(options, 'Flow');
    requireName(options, 'Flow');
    return await createKind('flow', options);
  },

  async createEventFile(first, second) {
    const options = normalizeOptions(first, second);
    requireOwner(options, 'Event');
    requireName(options, 'Event');
    return await createKind('event-file', options);
  },

  async createExtensionStub(first, second) {
    const options = normalizeOptions(first, second);
    requireName(options, 'Extension');
    return await createKind('extension-stub', options);
  },
};
