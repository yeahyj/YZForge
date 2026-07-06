'use strict';

const { create } = require('./create');
const { generate } = require('./generate');
const { validate } = require('./validate');
const { scanProject } = require('./scanner');
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
  await assetDbRequest('save-asset-meta', target.url, meta);
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
  try {
    info = await queryAssetInfo(url);
  } catch (error) {
    result.warnings.push(`query asset info failed: ${error.message}`);
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

  try {
    await assetDbRequest('open-asset', uuid);
    result.opened = true;
  } catch (error) {
    result.warnings.push(`open asset failed: ${error.message}`);
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

  let serialized;
  try {
    serialized = await Editor.Message.request('scene', 'execute-scene-script', {
      name: 'yzforge',
      method: 'createUiPrefab',
      args: [{
        name: result.name,
        componentName: result.name,
        requireComponent: options.requireComponent !== false,
      }],
    });
  } catch (error) {
    return {
      target: targetUrl,
      created: false,
      reason: error.message,
    };
  }

  const method = existing && options.overwrite === true ? 'save-asset' : 'create-asset';
  await assetDbRequest(method, targetUrl, serialized.content);
  await refreshAsset(targetUrl);
  return {
    target: targetUrl,
    created: !existing,
    overwritten: Boolean(existing && options.overwrite === true),
    componentAttached: serialized.componentAttached,
    warnings: serialized.warnings || [],
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

  const prefab = await createUiPrefab(result, options);
  const generated = generate(projectRoot());
  const createdUrls = changedAssetUrls(result, generated, prefab);
  refreshed.push(...await refreshCreatedAssets(createdUrls));
  const focus = await selectAsset(preferredAssetUrl(result, prefab));

  return {
    ...result,
    assetDb: {
      refreshed,
      bundle: await configureBundle(bundleTarget(result)),
      prefab,
      focus,
    },
    generated,
  };
}

async function createKind(kind, options) {
  const root = projectRoot();
  const result = create(root, kind, options);
  const completed = await postCreate(result, options);
  console.log(`[YZForge] created ${kind}:`, completed);
  return completed;
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

  getProjectSummary() {
    return describeProject();
  },

  showCreateHelp,

  async generateAll() {
    const result = generate(projectRoot());
    console.log('[YZForge] generate all:', result);
    return result;
  },

  async validateArchitecture() {
    const result = validate(projectRoot());
    console.log('[YZForge] validate architecture:', result);
    return result;
  },

  async validateArchitectureStrict() {
    const result = validate(projectRoot(), { strict: true });
    console.log('[YZForge] validate architecture strict:', result);
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
