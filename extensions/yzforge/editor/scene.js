'use strict';

module.paths.push(Editor.App.path + '/node_modules');

const cc = require('cc');
const { Button, Color, js, Label, Node, Prefab, Sprite, UITransform } = cc;

const UI_LAYER = cc.Layers && cc.Layers.Enum && cc.Layers.Enum.UI_2D
  ? cc.Layers.Enum.UI_2D
  : 1 << 30;

const SPRITE_FRAMES = {
  sprite: '57520716-48c8-4a19-8acf-41c9f8777fb0@f9941',
  splash: '7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941',
  button: '20835ba4-6145-4fbc-a58a-051ce700aa3e@f9941',
  panel: 'b730527c-3233-41c2-aaf7-7cdab58f9749@f9941',
};

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

function createNode(name, parent, options = {}) {
  const node = new Node(name);
  node.layer = UI_LAYER;
  if (parent) {
    parent.addChild(node);
  }
  node.setPosition(options.x || 0, options.y || 0, 0);
  setContentSize(node, options.width || 100, options.height || 40);
  return node;
}

function color(value) {
  return new Color(value[0], value[1], value[2], value.length > 3 ? value[3] : 255);
}

function addSprite(node, value) {
  const sprite = node.getComponent(Sprite) || node.addComponent(Sprite);
  sprite.color = color(value);
  return sprite;
}

function alignLabel(label) {
  if (Label.HorizontalAlign) {
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
  }
  if (Label.VerticalAlign) {
    label.verticalAlign = Label.VerticalAlign.CENTER;
  }
}

function addLabel(node, text, options = {}) {
  const label = node.getComponent(Label) || node.addComponent(Label);
  label.string = text;
  label.fontSize = options.fontSize || 24;
  label.lineHeight = options.lineHeight || Math.max(label.fontSize + 8, 28);
  label.color = color(options.color || [255, 255, 255, 255]);
  alignLabel(label);
  return label;
}

function addButton(node, text, options = {}) {
  addSprite(node, options.background || [54, 111, 176, 255]);
  const button = node.getComponent(Button) || node.addComponent(Button);
  button.target = node;
  if (Button.Transition) {
    button.transition = Button.Transition.COLOR;
  }

  const labelNode = createNode('Label', node, {
    width: options.width || 160,
    height: options.height || 48,
  });
  addLabel(labelNode, text, {
    fontSize: options.fontSize || 20,
    lineHeight: options.height || 48,
    color: options.color || [255, 255, 255, 255],
  });
  return button;
}

function addTitle(root, text, y) {
  const title = createNode('@title:Label', root, {
    x: 0,
    y,
    width: 520,
    height: 54,
  });
  addLabel(title, text, {
    fontSize: 28,
    lineHeight: 54,
    color: [244, 248, 255, 255],
  });
}

function addMessage(root, text, y, width = 520) {
  const message = createNode('@message:Label', root, {
    x: 0,
    y,
    width,
    height: 72,
  });
  addLabel(message, text, {
    fontSize: 20,
    lineHeight: 30,
    color: [219, 228, 238, 255],
  });
}

function addCloseButton(root, x, y) {
  const button = createNode('@closeButton:Button', root, {
    x,
    y,
    width: 52,
    height: 52,
  });
  addButton(button, 'X', {
    width: 52,
    height: 52,
    fontSize: 18,
    background: [112, 76, 86, 255],
  });
}

function addScaffold(root, options) {
  const viewKind = String(options.viewKind || '').trim() || inferViewKind(options.name);
  if (options.kind === 'part') {
    setContentSize(root, 320, 160);
    addSprite(root, [35, 42, 55, 245]);
    addTitle(root, options.name, 32);
    addMessage(root, 'Part content', -32, 260);
    return viewKind;
  }

  if (viewKind === 'Page') {
    setContentSize(root, 720, 1280);
    addSprite(root, [22, 29, 39, 255]);
    addTitle(root, options.name, 410);
    addMessage(root, 'Page view is ready.', 320, 520);
    const primary = createNode('@primaryButton:Button', root, {
      x: 0,
      y: -270,
      width: 260,
      height: 64,
    });
    addButton(primary, 'Open', { width: 260, height: 64 });
  } else if (viewKind === 'Paper') {
    setContentSize(root, 640, 860);
    addSprite(root, [28, 35, 46, 250]);
    addTitle(root, options.name, 330);
    addMessage(root, 'Paper view content.', 230, 500);
    addCloseButton(root, 270, 360);
  } else if (viewKind === 'Popup') {
    setContentSize(root, 680, 460);
    addSprite(root, [31, 36, 46, 250]);
    addTitle(root, options.name, 150);
    addMessage(root, 'Popup message.', 55, 520);
    addCloseButton(root, 286, 172);

    const confirm = createNode('@confirmButton:Button', root, {
      x: 120,
      y: -150,
      width: 180,
      height: 58,
    });
    addButton(confirm, 'OK', { width: 180, height: 58, background: [56, 126, 185, 255] });

    const cancel = createNode('@cancelButton:Button', root, {
      x: -120,
      y: -150,
      width: 180,
      height: 58,
    });
    addButton(cancel, 'Cancel', { width: 180, height: 58, background: [78, 86, 99, 255] });
  } else if (viewKind === 'Toast') {
    setContentSize(root, 420, 88);
    addSprite(root, [35, 42, 55, 235]);
    addMessage(root, 'Toast message.', 0, 360);
  } else if (viewKind === 'Top') {
    setContentSize(root, 560, 120);
    addSprite(root, [38, 63, 78, 242]);
    addMessage(root, 'Top layer message.', 0, 480);
  } else if (viewKind === 'System') {
    setContentSize(root, 600, 180);
    addSprite(root, [45, 38, 64, 248]);
    addTitle(root, options.name, 42);
    addMessage(root, 'System notice.', -28, 500);
    addCloseButton(root, 260, 54);
  } else {
    setContentSize(root, 520, 280);
    addSprite(root, [31, 36, 46, 250]);
    addTitle(root, options.name, 64);
    addMessage(root, 'View is ready.', -20, 420);
  }
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

function spriteFrameRef(kind) {
  return {
    __uuid__: SPRITE_FRAMES[kind] || SPRITE_FRAMES.sprite,
    __expectedType__: 'cc.SpriteFrame',
  };
}

function patchSpriteFrames(content) {
  const records = JSON.parse(content);
  const list = Array.isArray(records) ? records : [records];
  for (const record of list) {
    if (!record || record.__type__ !== 'cc.Sprite') {
      continue;
    }
    if (!record._spriteFrame) {
      record._spriteFrame = spriteFrameRef('splash');
    }
    if (record._sizeMode === undefined) {
      record._sizeMode = 0;
    }
  }
  return JSON.stringify(records, null, 2);
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
    setContentSize(node, 520, 280);
    const scaffoldKind = addScaffold(node, options);

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
    const content = patchSpriteFrames(rawContent);
    JSON.parse(content);

    return {
      name,
      componentName,
      viewKind: scaffoldKind,
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
