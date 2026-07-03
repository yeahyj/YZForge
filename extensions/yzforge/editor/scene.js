'use strict';

module.paths.push(Editor.App.path + '/node_modules');

const cc = require('cc');
const { js, Node, Prefab, UITransform } = cc;

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

function serializePrefab(options = {}) {
  const name = String(options.name || '').trim();
  if (!name) {
    throw new Error('Prefab name is required.');
  }

  const node = new Node(String(options.rootName || name));
  const warnings = [];
  try {
    node.addComponent(UITransform);

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

    const serialized = getSerializer()(prefab);
    const content = typeof serialized === 'string'
      ? serialized
      : JSON.stringify(serialized, null, 2);
    JSON.parse(content);

    return {
      name,
      componentName,
      componentAttached: Boolean(componentClass),
      warnings,
      content,
    };
  } finally {
    node.destroy();
  }
}

exports.methods = {
  createUiPrefab(options) {
    return serializePrefab(options);
  },
};
