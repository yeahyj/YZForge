'use strict';

module.paths.push(Editor.App.path + '/node_modules');

const cc = require('cc');
const { js, Node, Prefab, UITransform } = cc;

const UI_LAYER = cc.Layers && cc.Layers.Enum && cc.Layers.Enum.UI_2D
  ? cc.Layers.Enum.UI_2D
  : 1 << 30;

function getSerializer() {
  const cceGlobal = typeof globalThis !== 'undefined' ? globalThis.cce : undefined;
  const serializer = cceGlobal && cceGlobal.Utils && cceGlobal.Utils.serialize;
  if (typeof serializer !== 'function') {
    throw new Error('cce.Utils.serialize is unavailable.');
  }
  return serializer.bind(cceGlobal.Utils);
}

function resolveComponentClass(name) {
  if (!name || !js || typeof js.getClassByName !== 'function') {
    return null;
  }
  return js.getClassByName(name) || js.getClassByName(`cc.${name}`);
}

function setContentSize(node, width, height) {
  const transform = node.getComponent(UITransform) || node.addComponent(UITransform);
  if (typeof transform.setContentSize === 'function') {
    transform.setContentSize(width, height);
  } else {
    transform.width = width;
    transform.height = height;
  }
  return transform;
}

function applyMinimalPrefabShape(root, options) {
  const viewKind = String(options.viewKind || '').trim() || inferViewKind(options.name);
  setContentSize(root, 100, 100);
  return viewKind;
}

function inferViewKind(name) {
  for (const kind of ['Page', 'Paper', 'Popup', 'Toast', 'Top', 'System']) {
    if (String(name || '').startsWith(kind)) {
      return kind;
    }
  }
  return 'Page';
}

function createPrefabInfo(prefab, root) {
  const legacy = cc.legacyCC || cc.cclegacy || globalThis.cclegacy || globalThis.cc;
  const PrefabInfo = legacy && legacy._PrefabInfo;
  if (typeof PrefabInfo !== 'function') {
    throw new Error('legacyCC._PrefabInfo is unavailable.');
  }
  const info = new PrefabInfo();
  info.asset = prefab;
  info.root = root;
  return info;
}

function runtimeApp() {
  return typeof globalThis !== 'undefined' ? globalThis.__YZFORGE_APP__ : undefined;
}

function getRuntimeSnapshot() {
  const app = runtimeApp();
  if (!app || typeof app.snapshot !== 'function') {
    return {
      ok: false,
      running: false,
      reason: 'YZForge App is not available in the scene process.',
    };
  }
  return {
    ok: true,
    running: true,
    snapshot: app.snapshot(),
  };
}

function serializePrefab(options = {}) {
  const name = String(options.name || '').trim();
  if (!name) {
    throw new Error('Prefab name is required.');
  }

  const node = new Node(String(options.rootName || name));
  node.layer = UI_LAYER;
  const warnings = [];
  try {
    const viewKind = applyMinimalPrefabShape(node, options);

    const componentName = String(options.componentName || name);
    const componentClass = resolveComponentClass(componentName);
    if (componentClass) {
      node.addComponent(componentClass);
    } else if (options.requireComponent !== false) {
      throw new Error(`Component class is not available in scene process: ${componentName}.`);
    } else {
      warnings.push(`Component class is not available in scene process: ${componentName}.`);
    }

    const prefab = new Prefab();
    prefab.name = String(options.prefabName || name);
    prefab.data = node;
    node._prefab = createPrefabInfo(prefab, node);

    const serialized = getSerializer()(prefab);
    const rawContent = typeof serialized === 'string'
      ? serialized
      : JSON.stringify(serialized, null, 2);
    const content = JSON.stringify(JSON.parse(rawContent), null, 2);

    return {
      name,
      componentName,
      viewKind,
      componentAttached: Boolean(componentClass),
      warnings,
      content,
    };
  } finally {
    node.destroy();
  }
}

exports.methods = {
  hasComponentClass(name) {
    return Boolean(resolveComponentClass(name));
  },

  createUiPrefab(options) {
    return serializePrefab(options);
  },

  getRuntimeSnapshot() {
    return getRuntimeSnapshot();
  },
};
