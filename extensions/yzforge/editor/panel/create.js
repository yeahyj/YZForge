'use strict';

const shared = require('./shared');

const template = `
<section class="shell create-shell">
  <header class="topbar">
    <div>
      <h1 data-i18n="create_panel_title">YZForge Create</h1>
      <p id="status" data-i18n="panel_status_ready">Ready</p>
    </div>
    <button id="refresh" data-i18n="panel_refresh" data-i18n-title="panel_refresh_title" title="Refresh project summary">Refresh</button>
  </header>

  <section class="section create-section">
    <div class="section-title" data-i18n="panel_create">Create</div>
    <div class="create-tabs" role="tablist">
      <button type="button" class="create-tab active" data-create-group="structure" data-i18n="create_group_structure">Structure</button>
      <button type="button" class="create-tab" data-create-group="ui" data-i18n="create_group_ui">UI</button>
      <button type="button" class="create-tab" data-create-group="module-code" data-i18n="create_group_module_code">Module Code</button>
      <button type="button" class="create-tab" data-create-group="app" data-i18n="create_group_app">App</button>
    </div>
    <div class="form-grid">
      <label>
        <span data-i18n="panel_kind">Kind</span>
        <select id="kind">
          <option value="module" data-create-group="structure" data-i18n="kind_module">Module</option>
          <option value="library" data-create-group="structure" data-i18n="kind_library">Library</option>
          <option value="content-pack" data-create-group="structure" data-i18n="kind_content_pack">ContentPack</option>
          <option value="view" data-create-group="ui" data-i18n="kind_view">Module View</option>
          <option value="global-view" data-create-group="ui" data-i18n="kind_global_view">Global View</option>
          <option value="part" data-create-group="ui" data-i18n="kind_part">Part</option>
          <option value="model" data-create-group="module-code" data-i18n="kind_model">Model</option>
          <option value="service" data-create-group="module-code" data-i18n="kind_service">Service</option>
          <option value="flow" data-create-group="module-code" data-i18n="kind_flow">Flow</option>
          <option value="event-file" data-create-group="module-code" data-i18n="kind_event_file">Event File</option>
          <option value="extension-stub" data-create-group="app" data-i18n="kind_extension_stub">Extension Stub</option>
        </select>
      </label>
      <label id="view-kind-row">
        <span data-i18n="panel_view_kind">View Kind</span>
        <select id="view-kind">
          <option value="Page" data-i18n="view_kind_page">Page</option>
          <option value="Paper" data-i18n="view_kind_paper">Paper</option>
          <option value="Popup" data-i18n="view_kind_popup">Popup</option>
          <option value="Toast" data-i18n="view_kind_toast">Toast</option>
          <option value="Top" data-i18n="view_kind_top">Top</option>
          <option value="System" data-i18n="view_kind_system">System</option>
        </select>
      </label>
      <label id="owner-row">
        <span data-i18n="panel_owner">Owner</span>
        <select id="owner"></select>
      </label>
      <label>
        <span data-i18n="panel_name">Name</span>
        <input id="name" data-i18n-placeholder="panel_placeholder_pascal" placeholder="PascalCase" />
      </label>
    </div>
    <div class="create-footer">
      <div id="prefab-row" class="options-row">
        <label><input id="prefab" type="checkbox" checked /> <span data-i18n="panel_prefab">Prefab</span></label>
        <label><input id="overwrite" type="checkbox" /> <span data-i18n="panel_overwrite">Overwrite</span></label>
      </div>
      <button id="create" class="primary" data-i18n="panel_create">Create</button>
    </div>
  </section>

  <section class="section summary">
    <div class="section-title" data-i18n="panel_project">Project</div>
    <div class="summary-line">
      <span><strong id="module-count">0</strong> <span data-i18n="panel_modules">Modules</span></span>
      <span><strong id="library-count">0</strong> <span data-i18n="panel_libraries">Libraries</span></span>
      <span><strong id="pack-count">0</strong> <span data-i18n="panel_packs">Packs</span></span>
    </div>
    <div id="module-list" class="list"></div>
  </section>

  <section class="section result">
    <div class="section-title" data-i18n="panel_result">Result</div>
    <div id="result-list" class="result-list"></div>
    <pre id="result"></pre>
  </section>
</section>
`;

const style = `
${shared.baseStyle}

.create-section {
  display: grid;
  gap: 10px;
}

.create-section .section-title {
  margin-bottom: 0;
}

.create-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.create-tab {
  min-height: 28px;
  padding: 3px 6px;
  color: var(--color-normal-contrast-weaker);
  border-color: transparent;
  background: var(--color-normal-fill);
}

.create-tab.active {
  color: var(--color-primary-contrast);
  border-color: var(--color-primary-border);
  background: var(--color-primary-fill);
}

#owner-row {
  grid-column: 1 / -1;
}

.create-footer {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
}

.create-footer .primary {
  justify-self: end;
}

.summary-line {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--color-normal-contrast-weaker);
}

.summary-line strong {
  color: var(--color-normal-contrast);
}

.list {
  margin-top: 8px;
  max-height: 72px;
  overflow: auto;
  color: var(--color-normal-contrast-weaker);
}

@media (max-width: 420px) {
  .create-tabs,
  .create-footer {
    grid-template-columns: 1fr;
  }
}
`;

const DEFAULT_CREATE_GROUP = 'structure';
const VIEW_KIND_PREFIXES = ['Page', 'Paper', 'Popup', 'Toast', 'Top', 'System'];
const MODULE_UNIT_SUFFIXES = ['Model', 'Service', 'Flow'];

function messageNameForKind(kind) {
  return {
    module: 'create-module',
    library: 'create-library',
    'content-pack': 'create-content-pack',
    view: 'create-module-view',
    'global-view': 'create-global-view',
    part: 'create-part',
    model: 'create-model',
    service: 'create-service',
    flow: 'create-flow',
    'event-file': 'create-event-file',
    'extension-stub': 'create-extension-stub',
  }[kind];
}

function isViewCreateKind(kind) {
  return kind === 'view' || kind === 'global-view';
}

function kindNeedsOwner(kind) {
  return !['module', 'library', 'global-view', 'extension-stub'].includes(kind);
}

function kindSupportsPrefab(kind) {
  return ['view', 'global-view', 'part'].includes(kind);
}

function knownKindPrefix(name) {
  return VIEW_KIND_PREFIXES.find((prefix) => name.startsWith(prefix) && name.length > prefix.length);
}

function knownUnitSuffix(name) {
  return MODULE_UNIT_SUFFIXES.find((suffix) => name.endsWith(suffix) && name.length > suffix.length);
}

function pascalCaseName(value) {
  const words = String(value || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
}

function withViewKindPrefix(name, viewKind) {
  if (!name) {
    return '';
  }
  const prefix = VIEW_KIND_PREFIXES.includes(viewKind) ? viewKind : 'Page';
  const existingPrefix = knownKindPrefix(name);
  const core = existingPrefix ? name.slice(existingPrefix.length) : name;
  return `${prefix}${core}`;
}

function withPartPrefix(name) {
  if (!name || name.startsWith('Part')) {
    return name;
  }
  return `Part${name}`;
}

function withUnitSuffix(name, suffix) {
  if (!name) {
    return '';
  }
  const existingSuffix = knownUnitSuffix(name);
  const core = existingSuffix ? name.slice(0, -existingSuffix.length) : name;
  return core ? `${core}${suffix}` : name;
}

function normalizeCreateName(kind, value, viewKind) {
  const name = pascalCaseName(value);
  if (isViewCreateKind(kind)) {
    return withViewKindPrefix(name, viewKind);
  }
  if (kind === 'part') {
    return withPartPrefix(name);
  }
  if (kind === 'model') {
    return withUnitSuffix(name, 'Model');
  }
  if (kind === 'service') {
    return withUnitSuffix(name, 'Service');
  }
  if (kind === 'flow') {
    return withUnitSuffix(name, 'Flow');
  }
  return name;
}

function placeholderKeyForKind(kind) {
  if (isViewCreateKind(kind)) {
    return 'panel_placeholder_view';
  }
  if (kind === 'part') {
    return 'panel_placeholder_part';
  }
  if (kind === 'model') {
    return 'panel_placeholder_model';
  }
  if (kind === 'service') {
    return 'panel_placeholder_service';
  }
  if (kind === 'flow') {
    return 'panel_placeholder_flow';
  }
  return 'panel_placeholder_pascal';
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell',
    status: '#status',
    refresh: '#refresh',
    kind: '#kind',
    viewKind: '#view-kind',
    viewKindRow: '#view-kind-row',
    name: '#name',
    owner: '#owner',
    ownerRow: '#owner-row',
    prefabRow: '#prefab-row',
    prefab: '#prefab',
    overwrite: '#overwrite',
    create: '#create',
    moduleCount: '#module-count',
    libraryCount: '#library-count',
    packCount: '#pack-count',
    moduleList: '#module-list',
    resultList: '#result-list',
    result: '#result',
  },
  methods: {
    t(key) {
      return shared.t(this, key);
    },

    setBusy(busy, label) {
      const key = label || (busy ? 'panel_status_working' : 'panel_status_ready');
      this.$.status.textContent = this.t(key);
      for (const button of [this.$.refresh, this.$.create, ...this.$.shell.querySelectorAll('.create-tab')]) {
        button.disabled = busy;
      }
    },

    setResult(value) {
      shared.setResult(this, value);
    },

    errorResult(error) {
      return shared.errorResult(error);
    },

    async call(message, payload) {
      return await shared.call(message, payload);
    },

    setCreateGroup(group) {
      const targetGroup = group || DEFAULT_CREATE_GROUP;
      const options = Array.from(this.$.kind.options);
      const activeOptions = options.filter((option) => option.dataset.createGroup === targetGroup);
      if (activeOptions.length === 0) {
        return;
      }

      for (const option of options) {
        const visible = option.dataset.createGroup === targetGroup;
        option.hidden = !visible;
        option.disabled = !visible;
      }
      if (!activeOptions.some((option) => option.value === this.$.kind.value)) {
        this.$.kind.value = activeOptions[0].value;
      }
      for (const button of this.$.shell.querySelectorAll('.create-tab')) {
        button.classList.toggle('active', button.dataset.createGroup === targetGroup);
      }
      this.updateVisibility();
    },

    updateVisibility() {
      const kind = this.$.kind.value;
      const needsOwner = kindNeedsOwner(kind);
      const needsPrefab = kindSupportsPrefab(kind);
      const needsViewKind = isViewCreateKind(kind);
      const placeholder = this.t(placeholderKeyForKind(kind)).replace('{kind}', this.$.viewKind.value);
      this.$.ownerRow.classList.toggle('hidden', !needsOwner);
      this.$.prefabRow.classList.toggle('hidden', !needsPrefab);
      this.$.viewKindRow.classList.toggle('hidden', !needsViewKind);
      this.$.name.setAttribute('placeholder', placeholder);
    },

    normalizeNameField() {
      const normalized = normalizeCreateName(this.$.kind.value, this.$.name.value, this.$.viewKind.value);
      if (normalized) {
        this.$.name.value = normalized;
      }
    },

    async refreshSummary(options = {}) {
      this.setBusy(true, 'panel_status_refreshing');
      try {
        const summary = await this.call('get-project-summary');
        const modules = summary.modules || [];
        this.$.moduleCount.textContent = String(modules.length);
        this.$.libraryCount.textContent = String((summary.libraries || []).length);
        this.$.packCount.textContent = String((summary.contentPacks || []).length);
        this.$.moduleList.textContent = modules.map((item) => item.name).join(', ') || this.t('panel_no_modules');
        const selectedOwner = this.$.owner.value;
        this.$.owner.innerHTML = modules.length > 0
          ? modules.map((item) => `<option value="${shared.escapeHtml(item.name)}">${shared.escapeHtml(item.name)}</option>`).join('')
          : `<option value="">${shared.escapeHtml(this.t('panel_no_modules'))}</option>`;
        if (selectedOwner && modules.some((item) => item.name === selectedOwner)) {
          this.$.owner.value = selectedOwner;
        }
        if (!options.silentResult) {
          this.setResult(summary);
        }
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
        this.updateVisibility();
      }
    },

    async createItem() {
      const kind = this.$.kind.value;
      const name = normalizeCreateName(kind, this.$.name.value, this.$.viewKind.value);
      this.$.name.value = name;
      const message = messageNameForKind(kind);
      const payload = {
        name,
        prefab: this.$.prefab.checked,
        overwrite: this.$.overwrite.checked,
      };
      if (kindNeedsOwner(kind)) {
        payload.owner = this.$.owner.value;
      }
      if (isViewCreateKind(kind)) {
        payload.viewKind = this.$.viewKind.value;
      }
      this.setBusy(true, 'panel_status_creating');
      try {
        const result = await this.call(message, payload);
        this.setResult(result);
        await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },
  },
  ready() {
    shared.translate(this);
    for (const button of this.$.shell.querySelectorAll('.create-tab')) {
      button.addEventListener('click', () => this.setCreateGroup(button.dataset.createGroup));
    }
    this.$.kind.addEventListener('change', () => {
      this.updateVisibility();
      this.normalizeNameField();
    });
    this.$.viewKind.addEventListener('change', () => {
      this.updateVisibility();
      this.normalizeNameField();
    });
    this.$.name.addEventListener('blur', () => this.normalizeNameField());
    this.$.refresh.addEventListener('click', () => this.refreshSummary());
    this.$.create.addEventListener('click', () => this.createItem());
    this.setCreateGroup(DEFAULT_CREATE_GROUP);
    this.refreshSummary();
  },
  beforeClose() {},
  close() {},
});
