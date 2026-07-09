'use strict';

const en = require('../../i18n/en');
const zh = require('../../i18n/zh');

const template = `
<section class="shell">
  <header class="topbar">
    <div>
      <h1>YZForge</h1>
      <p id="status" data-i18n="panel_status_ready">Ready</p>
    </div>
    <button id="refresh" class="icon-button" data-i18n="panel_refresh" data-i18n-title="panel_refresh_title" title="Refresh project summary">Refresh</button>
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

  <section class="section config-section">
    <div class="section-title" data-i18n="config_tables">Config Tables</div>
    <div class="form-grid">
      <label>
        <span data-i18n="config_source">Source</span>
        <select id="config-source"></select>
      </label>
      <label>
        <span data-i18n="config_sheet">Sheet</span>
        <select id="config-sheet"></select>
      </label>
      <label>
        <span data-i18n="config_scope_kind">Scope</span>
        <select id="config-scope-kind">
          <option value="module">Module</option>
          <option value="library">Library</option>
          <option value="content-pack">ContentPack</option>
          <option value="global">Global</option>
        </select>
      </label>
      <label>
        <span data-i18n="config_scope_target">Target</span>
        <select id="config-scope-target"></select>
      </label>
      <label>
        <span data-i18n="config_table">Table</span>
        <input id="config-table" placeholder="item" />
      </label>
      <label>
        <span data-i18n="config_row">Row Type</span>
        <input id="config-row" placeholder="ItemRow" />
      </label>
      <label>
        <span data-i18n="config_primary_key">Primary Key</span>
        <input id="config-primary-key" value="id" />
      </label>
      <label>
        <span data-i18n="config_format">Format</span>
        <select id="config-format">
          <option value="json">json</option>
        </select>
      </label>
    </div>
    <div class="create-footer">
      <div class="options-row">
        <label><input id="config-generate-keys" type="checkbox" checked /> <span data-i18n="config_generate_keys">Generate ID constants</span></label>
      </div>
      <div class="tool-row config-actions">
        <button id="config-scan" data-i18n="config_scan">Scan Excel</button>
        <button id="config-save-table" class="command-primary" data-i18n="config_save_table">Save Table</button>
        <button id="config-build" class="command-primary" data-i18n="config_build">Build Config</button>
        <button id="config-check" data-i18n="config_check">Config Check</button>
      </div>
    </div>
  </section>

  <section class="section summary">
    <div class="section-title" data-i18n="panel_project">Project</div>
    <div class="summary-grid">
      <div><strong id="module-count">0</strong><span data-i18n="panel_modules">Modules</span></div>
      <div><strong id="library-count">0</strong><span data-i18n="panel_libraries">Libraries</span></div>
      <div><strong id="pack-count">0</strong><span data-i18n="panel_packs">Packs</span></div>
    </div>
    <div id="module-list" class="list"></div>
  </section>

  <section class="section tools">
    <div class="section-title" data-i18n="panel_workbench">Workbench</div>
    <div class="command-groups">
      <div class="command-group">
        <div class="command-title" data-i18n="workbench_generate">Generate</div>
        <div class="tool-row">
          <button id="generate" class="command-primary" data-i18n="generate_all">Generate All</button>
          <button id="generate-check" data-i18n="generate_check">Generate Check</button>
        </div>
      </div>
      <div class="command-group">
        <div class="command-title" data-i18n="workbench_validate">Validate</div>
        <div class="tool-row">
          <button id="validate" data-i18n="validate_architecture">Validate</button>
          <button id="validate-strict" data-i18n="validate_architecture_strict">Validate Strict</button>
          <button id="diagnostics" data-i18n="panel_diagnostics">Diagnostics</button>
          <button id="smoke-test" data-i18n="smoke_test">Smoke Test</button>
          <button id="runtime-snapshot" data-i18n="runtime_snapshot">Runtime Snapshot</button>
        </div>
      </div>
      <div class="command-group">
        <div class="command-title" data-i18n="workbench_clean">Clean</div>
        <div class="tool-row">
          <button id="clean-preview" data-i18n="clean_preview">Clean Preview</button>
          <button id="clean" data-i18n="clean_generated" data-i18n-title="clean_generated_title">Safe Clean</button>
        </div>
        <label class="clean-toggle" data-i18n-title="clean_scripts_title">
          <input id="clean-scripts" type="checkbox" />
          <span data-i18n="clean_scripts">Include generated TS</span>
        </label>
      </div>
    </div>
  </section>

  <section class="section result">
    <div class="section-title" data-i18n="panel_result">Result</div>
    <div id="result-list" class="result-list"></div>
    <pre id="result"></pre>
  </section>
</section>
`;

const style = `
:host {
  color: var(--color-normal-contrast);
  font: 12px/1.45 var(--font-normal);
}

.shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  height: 100%;
  padding: 10px;
  overflow: auto;
  background: var(--color-normal-fill);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0 8px;
  border-bottom: 1px solid var(--color-normal-border);
}

h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0;
}

p {
  margin: 2px 0 0;
  color: var(--color-normal-contrast-weaker);
}

.section {
  border: 1px solid var(--color-normal-border);
  border-radius: 5px;
  padding: 10px;
  background: var(--color-normal-fill-emphasis);
}

.section-title {
  margin-bottom: 8px;
  color: var(--color-normal-contrast-weaker);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.create-section {
  display: grid;
  gap: 10px;
  flex: none;
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
  min-height: 26px;
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

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-height: 0;
}

#owner-row {
  grid-column: 1 / -1;
}

label {
  display: grid;
  gap: 4px;
}

label span {
  color: var(--color-normal-contrast-weaker);
}

input,
select {
  box-sizing: border-box;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  color: var(--color-normal-contrast);
  border: 1px solid var(--color-normal-border);
  border-radius: 4px;
  background: var(--color-normal-fill);
}

.options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  min-height: 28px;
}

.options-row label {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 6px;
}

.options-row input {
  width: auto;
  min-height: auto;
}

button {
  min-width: 0;
  min-height: 28px;
  padding: 4px 10px;
  color: var(--color-normal-contrast);
  border: 1px solid var(--color-normal-border);
  border-radius: 4px;
  background: var(--color-normal-fill-hover);
}

button:hover {
  background: var(--color-normal-fill-important);
}

button:disabled {
  opacity: 0.55;
}

.primary {
  min-width: 92px;
  border-color: var(--color-primary-border);
  background: var(--color-primary-fill);
}

.command-primary {
  border-color: var(--color-primary-border);
}

.icon-button {
  flex: none;
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

.command-groups {
  display: grid;
  gap: 10px;
}

.command-group {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--color-normal-border);
}

.command-group:first-child {
  padding-top: 0;
  border-top: 0;
}

.command-title {
  color: var(--color-normal-contrast-weaker);
  font-size: 11px;
  font-weight: 600;
}

.tool-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.config-actions {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.clean-toggle {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-normal-border);
}

.clean-toggle input {
  width: auto;
  min-height: auto;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.summary-grid div {
  display: grid;
  gap: 2px;
  padding: 8px;
  border-radius: 3px;
  background: var(--color-normal-fill);
}

.summary-grid strong {
  font-size: 18px;
  line-height: 1;
}

.summary-grid span,
.list {
  color: var(--color-normal-contrast-weaker);
}

.list {
  margin-top: 8px;
  max-height: 92px;
  overflow: auto;
}

.result-list {
  display: grid;
  gap: 4px;
  max-height: 120px;
  margin-bottom: 8px;
  overflow: auto;
}

.result-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 3px;
  background: var(--color-normal-fill);
}

.result-row span {
  min-width: 0;
  overflow: hidden;
  color: var(--color-normal-contrast-weaker);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-row button {
  min-height: 24px;
  padding: 2px 8px;
}

pre {
  box-sizing: border-box;
  min-height: 140px;
  max-height: 260px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--color-normal-contrast);
  border-radius: 3px;
  background: var(--color-normal-fill);
}

.hidden {
  display: none;
}

@media (max-width: 420px) {
  .create-tabs,
  .form-grid,
  .create-footer,
  .tool-row {
    grid-template-columns: 1fr;
  }

  .primary {
    width: 100%;
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

function getLocale() {
  const language = Editor.I18n && typeof Editor.I18n.getLanguage === 'function'
    ? Editor.I18n.getLanguage()
    : 'en';
  return String(language || '').toLowerCase().startsWith('zh') ? zh : en;
}

function pascalCaseName(value) {
  const words = String(value || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  return words.map((word) => {
    const head = word.charAt(0).toUpperCase();
    const tail = word.slice(1);
    return `${head}${tail}`;
  }).join('');
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
    generate: '#generate',
    clean: '#clean',
    validate: '#validate',
    validateStrict: '#validate-strict',
    diagnostics: '#diagnostics',
    smokeTest: '#smoke-test',
    runtimeSnapshot: '#runtime-snapshot',
    generateCheck: '#generate-check',
    configSource: '#config-source',
    configSheet: '#config-sheet',
    configScopeKind: '#config-scope-kind',
    configScopeTarget: '#config-scope-target',
    configTable: '#config-table',
    configRow: '#config-row',
    configPrimaryKey: '#config-primary-key',
    configFormat: '#config-format',
    configGenerateKeys: '#config-generate-keys',
    configScan: '#config-scan',
    configSaveTable: '#config-save-table',
    configBuild: '#config-build',
    configCheck: '#config-check',
    cleanPreview: '#clean-preview',
    cleanScripts: '#clean-scripts',
    moduleCount: '#module-count',
    libraryCount: '#library-count',
    packCount: '#pack-count',
    moduleList: '#module-list',
    resultList: '#result-list',
    result: '#result',
  },
  methods: {
    t(key) {
      return (this.locale && this.locale[key]) || en[key] || key;
    },

    translate() {
      this.locale = getLocale();
      for (const element of this.$.shell.querySelectorAll('[data-i18n]')) {
        element.textContent = this.t(element.dataset.i18n);
      }
      for (const element of this.$.shell.querySelectorAll('[data-i18n-title]')) {
        element.setAttribute('title', this.t(element.dataset.i18nTitle));
      }
      for (const element of this.$.shell.querySelectorAll('[data-i18n-placeholder]')) {
        element.setAttribute('placeholder', this.t(element.dataset.i18nPlaceholder));
      }
    },

    setBusy(busy, label) {
      const key = label || (busy ? 'panel_status_working' : 'panel_status_ready');
      this.$.status.textContent = this.t(key);
      for (const button of [this.$.refresh, this.$.create, this.$.generate, this.$.clean, this.$.validate, this.$.diagnostics, this.$.smokeTest, this.$.runtimeSnapshot, this.$.generateCheck, this.$.configScan, this.$.configSaveTable, this.$.configBuild, this.$.configCheck, this.$.cleanPreview]) {
        button.disabled = busy;
      }
      for (const button of this.$.shell.querySelectorAll('.create-tab')) {
        button.disabled = busy;
      }
      this.$.cleanScripts.disabled = busy;
      this.$.validateStrict.disabled = busy;
      this.$.configGenerateKeys.disabled = busy;
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

    cleanOptions() {
      return {
        includeScripts: this.$.cleanScripts.checked === true,
      };
    },

    resultRows(value) {
      if (!value || typeof value !== 'object') {
        return [];
      }
      if (Array.isArray(value.details) && value.details.length > 0) {
        return value.details.map((item) => ({
          label: item.message || item.label || item.path || item.url || item.code,
          url: item.url,
          path: item.path,
        }));
      }
      if (Array.isArray(value.issueDetails) && value.issueDetails.length > 0) {
        return value.issueDetails.map((item) => ({
          label: item.message || item.path,
          url: item.url,
          path: item.path,
        }));
      }
      if (Array.isArray(value.removedDetails) && value.removedDetails.length > 0) {
        return value.removedDetails.map((item) => ({
          label: item.path,
          url: item.url,
          path: item.path,
        }));
      }
      if (Array.isArray(value.changedDetails) && value.changedDetails.length > 0) {
        return value.changedDetails.map((item) => ({
          label: item.path,
          url: item.url,
          path: item.path,
        }));
      }
      if (value.generated && Array.isArray(value.generated.changedDetails) && value.generated.changedDetails.length > 0) {
        return value.generated.changedDetails.map((item) => ({
          label: item.path,
          url: item.url,
          path: item.path,
        }));
      }
      if (value.validation && Array.isArray(value.validation.issueDetails) && value.validation.issueDetails.length > 0) {
        return value.validation.issueDetails.map((item) => ({
          label: item.message || item.path,
          url: item.url,
          path: item.path,
        }));
      }
      if (value.clean && Array.isArray(value.clean.fileDetails) && value.clean.fileDetails.length > 0) {
        return value.clean.fileDetails.map((item) => ({
          label: item.path,
          url: item.url,
          path: item.path,
        }));
      }
      if (value.clean && Array.isArray(value.clean.protectedDetails) && value.clean.protectedDetails.length > 0) {
        return value.clean.protectedDetails.map((item) => ({
          label: `${this.t('clean_protected')}: ${item.path}`,
          url: item.url,
          path: item.path,
        }));
      }
      if (Array.isArray(value.protectedDetails) && value.protectedDetails.length > 0) {
        return value.protectedDetails.map((item) => ({
          label: `${this.t('clean_protected')}: ${item.path}`,
          url: item.url,
          path: item.path,
        }));
      }
      if (Array.isArray(value.fileDetails) && value.fileDetails.length > 0) {
        return value.fileDetails.map((item) => ({
          label: item.path,
          url: item.url,
          path: item.path,
        }));
      }
      return [];
    },

    errorResult(error) {
      return {
        ok: false,
        error: error && error.message ? error.message : String(error),
        details: error && Array.isArray(error.details) ? error.details : [],
        issueDetails: error && Array.isArray(error.issueDetails) ? error.issueDetails : [],
      };
    },

    setResult(value) {
      this.$.resultList.innerHTML = '';
      for (const row of this.resultRows(value)) {
        const item = document.createElement('div');
        item.className = 'result-row';
        const label = document.createElement('span');
        label.textContent = row.label || row.path || row.url || '';
        item.appendChild(label);
        if (row.url || row.path) {
          const button = document.createElement('button');
          button.textContent = this.t('panel_locate');
          button.addEventListener('click', () => this.locateResult(row));
          item.appendChild(button);
        }
        this.$.resultList.appendChild(item);
      }
      this.$.result.textContent = typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2);
    },

    async call(message, payload) {
      return await Editor.Message.request('yzforge', message, payload);
    },

    async locateResult(row) {
      try {
        const result = await this.call('focus-asset', {
          url: row.url,
          path: row.path,
        });
        this.$.status.textContent = result && result.selected
          ? this.t('panel_status_ready')
          : this.t('panel_status_working');
      } catch (error) {
        this.setResult({ ok: false, error: error.message, target: row });
      }
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
          ? modules.map((item) => `<option value="${item.name}">${item.name}</option>`).join('')
          : `<option value="">${this.t('panel_no_modules')}</option>`;
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

    updateConfigSourceSheets() {
      const dashboard = this.configDashboardValue || {};
      const source = (dashboard.sources || []).find((item) => item.source === this.$.configSource.value);
      const sheets = source && Array.isArray(source.sheets) ? source.sheets : [];
      this.$.configSheet.innerHTML = sheets.length > 0
        ? sheets.map((sheet) => `<option value="${sheet}">${sheet}</option>`).join('')
        : '<option value="">No sheets</option>';
      this.applyConfigDefaults();
    },

    updateConfigScopeTargets() {
      const dashboard = this.configDashboardValue || {};
      const scopes = dashboard.scopes || {};
      const kind = this.$.configScopeKind.value;
      let targets = [];
      if (kind === 'module') {
        targets = scopes.modules || [];
      } else if (kind === 'library') {
        targets = scopes.libraries || [];
      } else if (kind === 'content-pack') {
        targets = (scopes.contentPacks || []).map((item) => `${item.owner}/${item.name}`);
      } else if (kind === 'global') {
        targets = ['Global'];
      }
      this.$.configScopeTarget.innerHTML = targets.length > 0
        ? targets.map((target) => `<option value="${target}">${target}</option>`).join('')
        : '<option value="">No target</option>';
    },

    applyConfigDefaults() {
      const sheet = this.$.configSheet.value;
      if (!this.$.configTable.value && sheet) {
        this.$.configTable.value = sheet.charAt(0).toLowerCase() + sheet.slice(1);
      }
      if (!this.$.configRow.value && sheet) {
        this.$.configRow.value = `${sheet.charAt(0).toUpperCase()}${sheet.slice(1)}Row`;
      }
      if (!this.$.configPrimaryKey.value) {
        this.$.configPrimaryKey.value = 'id';
      }
    },

    async refreshConfigDashboard(options = {}) {
      if (!options.keepBusy) {
        this.setBusy(true, 'panel_status_refreshing');
      }
      try {
        const dashboard = await this.call('config-dashboard');
        this.configDashboardValue = dashboard;
        const selectedSource = this.$.configSource.value;
        this.$.configSource.innerHTML = (dashboard.sources || []).length > 0
          ? dashboard.sources.map((item) => `<option value="${item.source}">${item.source}</option>`).join('')
          : '<option value="">config-source/excel is empty</option>';
        if (selectedSource && (dashboard.sources || []).some((item) => item.source === selectedSource)) {
          this.$.configSource.value = selectedSource;
        }
        this.updateConfigSourceSheets();
        this.updateConfigScopeTargets();
        if (!options.silentResult) {
          this.setResult(dashboard);
        }
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        if (!options.keepBusy) {
          this.setBusy(false);
        }
      }
    },

    configTablePayload() {
      const kind = this.$.configScopeKind.value;
      const target = this.$.configScopeTarget.value;
      const scope = { kind };
      if (kind === 'content-pack') {
        const [owner, name] = target.split('/');
        scope.owner = owner;
        scope.name = name;
      } else if (kind !== 'global') {
        scope.name = target;
      }
      return {
        source: this.$.configSource.value,
        sheet: this.$.configSheet.value,
        table: this.$.configTable.value,
        row: this.$.configRow.value,
        primaryKey: this.$.configPrimaryKey.value || 'id',
        format: this.$.configFormat.value || 'json',
        generateKeys: this.$.configGenerateKeys.checked === true,
        scope,
      };
    },

    async saveConfigTable() {
      this.applyConfigDefaults();
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-save-table', this.configTablePayload());
        this.setResult(result);
        await this.refreshConfigDashboard({ silentResult: true, keepBusy: true });
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async buildConfig() {
      this.setBusy(true, 'panel_status_generating');
      try {
        this.setResult(await this.call('config-build'));
        await this.refreshConfigDashboard({ silentResult: true, keepBusy: true });
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async checkConfig() {
      this.setBusy(true, 'panel_status_generating');
      try {
        this.setResult(await this.call('config-check'));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
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

    async generateAll() {
      this.setBusy(true, 'panel_status_generating');
      try {
        this.setResult(await this.call('generate-all'));
        await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async cleanGenerated() {
      this.setBusy(true, 'panel_status_cleaning');
      try {
        this.setResult(await this.call('clean-generated', {
          dryRun: false,
          ...this.cleanOptions(),
        }));
        await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async validateProject() {
      this.setBusy(true, 'panel_status_validating');
      try {
        this.setResult(await this.call('validate-architecture'));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async validateProjectStrict() {
      this.setBusy(true, 'panel_status_validating');
      try {
        this.setResult(await this.call('validate-architecture-strict'));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async runDiagnostics() {
      this.setBusy(true, 'panel_status_diagnosing');
      try {
        this.setResult(await this.call('project-diagnostics'));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async runtimeSnapshot() {
      this.setBusy(true, 'panel_status_diagnosing');
      try {
        this.setResult(await this.call('runtime-snapshot'));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async smokeTest() {
      this.setBusy(true, 'panel_status_smoking');
      try {
        this.setResult(await this.call('smoke-test'));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async generateCheck() {
      this.setBusy(true, 'panel_status_generating');
      try {
        this.setResult(await this.call('generate-check'));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async cleanPreview() {
      this.setBusy(true, 'panel_status_cleaning');
      try {
        this.setResult(await this.call('clean-generated-preview', this.cleanOptions()));
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },
  },
  ready() {
    this.translate();
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
    this.$.generate.addEventListener('click', () => this.generateAll());
    this.$.clean.addEventListener('click', () => this.cleanGenerated());
    this.$.validate.addEventListener('click', () => this.validateProject());
    this.$.validateStrict.addEventListener('click', () => this.validateProjectStrict());
    this.$.diagnostics.addEventListener('click', () => this.runDiagnostics());
    this.$.smokeTest.addEventListener('click', () => this.smokeTest());
    this.$.runtimeSnapshot.addEventListener('click', () => this.runtimeSnapshot());
    this.$.generateCheck.addEventListener('click', () => this.generateCheck());
    this.$.cleanPreview.addEventListener('click', () => this.cleanPreview());
    this.$.configScan.addEventListener('click', () => this.refreshConfigDashboard());
    this.$.configSource.addEventListener('change', () => this.updateConfigSourceSheets());
    this.$.configSheet.addEventListener('change', () => this.applyConfigDefaults());
    this.$.configScopeKind.addEventListener('change', () => this.updateConfigScopeTargets());
    this.$.configSaveTable.addEventListener('click', () => this.saveConfigTable());
    this.$.configBuild.addEventListener('click', () => this.buildConfig());
    this.$.configCheck.addEventListener('click', () => this.checkConfig());
    this.setCreateGroup(DEFAULT_CREATE_GROUP);
    this.refreshSummary();
    this.refreshConfigDashboard({ silentResult: true });
  },
  beforeClose() {},
  close() {},
});
