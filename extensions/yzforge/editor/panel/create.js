'use strict';

const shared = require('./shared');

const template = `
<section class="shell create-shell" data-state="ready">
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-mark">YZ</div>
      <div class="title-stack">
        <div class="eyebrow" data-i18n="panel_product_label">PROJECT GOVERNANCE</div>
        <h1 data-i18n="create_panel_title">YZForge Create</h1>
        <p class="status-line"><span class="status-dot"></span><span id="status" data-i18n="panel_status_ready">Ready</span></p>
      </div>
    </div>
    <button id="refresh" class="icon-button" data-i18n-title="panel_refresh_title" title="Refresh">↻</button>
  </header>

  <section class="section create-section">
    <div class="section-heading">
      <div>
        <div class="section-title" data-i18n="panel_create">Create</div>
        <div class="section-description" data-i18n="create_panel_desc">Create framework-owned structure with safe defaults</div>
      </div>
      <span id="create-step" class="section-meta" data-i18n="create_ready">Ready to create</span>
    </div>

    <div class="create-tabs" role="tablist">
      <button type="button" class="create-tab active" data-create-group="structure" data-i18n="create_group_structure">Structure</button>
      <button type="button" class="create-tab" data-create-group="ui" data-i18n="create_group_ui">UI</button>
      <button type="button" class="create-tab" data-create-group="module-code" data-i18n="create_group_module_code">Module Code</button>
      <button type="button" class="create-tab" data-create-group="app" data-i18n="create_group_app">App</button>
    </div>

    <select id="kind" class="hidden" aria-hidden="true">
      <option value="module">Module</option><option value="library">Library</option><option value="content-pack">ContentPack</option>
      <option value="view">Module View</option><option value="global-view">Global View</option><option value="part">Part</option>
      <option value="model">Model</option><option value="service">Service</option><option value="flow">Flow</option><option value="event-file">Event File</option>
      <option value="extension-stub">Extension Stub</option>
    </select>
    <div id="kind-grid" class="kind-grid" role="radiogroup">
      <button type="button" class="kind-choice" data-create-group="structure" data-kind="module"><span class="kind-glyph">M</span><span data-i18n="kind_module">Module</span></button>
      <button type="button" class="kind-choice" data-create-group="structure" data-kind="library"><span class="kind-glyph">L</span><span data-i18n="kind_library">Library</span></button>
      <button type="button" class="kind-choice" data-create-group="structure" data-kind="content-pack"><span class="kind-glyph">C</span><span data-i18n="kind_content_pack">ContentPack</span></button>
      <button type="button" class="kind-choice" data-create-group="ui" data-kind="view"><span class="kind-glyph">V</span><span data-i18n="kind_view">Module View</span></button>
      <button type="button" class="kind-choice" data-create-group="ui" data-kind="global-view"><span class="kind-glyph">G</span><span data-i18n="kind_global_view">Global View</span></button>
      <button type="button" class="kind-choice" data-create-group="ui" data-kind="part"><span class="kind-glyph">P</span><span data-i18n="kind_part">Part</span></button>
      <button type="button" class="kind-choice" data-create-group="module-code" data-kind="model"><span class="kind-glyph">M</span><span data-i18n="kind_model">Model</span></button>
      <button type="button" class="kind-choice" data-create-group="module-code" data-kind="service"><span class="kind-glyph">S</span><span data-i18n="kind_service">Service</span></button>
      <button type="button" class="kind-choice" data-create-group="module-code" data-kind="flow"><span class="kind-glyph">F</span><span data-i18n="kind_flow">Flow</span></button>
      <button type="button" class="kind-choice" data-create-group="module-code" data-kind="event-file"><span class="kind-glyph">E</span><span data-i18n="kind_event_file">Event File</span></button>
      <button type="button" class="kind-choice" data-create-group="app" data-kind="extension-stub"><span class="kind-glyph">X</span><span data-i18n="kind_extension_stub">Extension Stub</span></button>
    </div>

    <div class="form-grid create-form">
      <label id="owner-row">
        <span data-i18n="panel_owner">Owner</span>
        <select id="owner"></select>
      </label>
      <label id="view-kind-row">
        <span data-i18n="panel_view_kind">View Kind</span>
        <select id="view-kind">
          <option value="Page" data-i18n="view_kind_page">Page</option><option value="Paper" data-i18n="view_kind_paper">Paper</option>
          <option value="Popup" data-i18n="view_kind_popup">Popup</option><option value="Toast" data-i18n="view_kind_toast">Toast</option>
          <option value="Top" data-i18n="view_kind_top">Top</option><option value="System" data-i18n="view_kind_system">System</option>
        </select>
      </label>
      <label class="name-row">
        <span data-i18n="panel_name">Name</span>
        <input id="name" autocomplete="off" data-i18n-placeholder="panel_placeholder_pascal" placeholder="PascalCase" />
      </label>
    </div>

    <div class="preview-card create-preview">
      <span class="preview-kicker" data-i18n="create_preview">Will create</span>
      <strong id="preview-title" class="preview-title">Module</strong>
      <span id="preview-path" class="preview-value">—</span>
    </div>

    <div class="create-footer">
      <div class="options-row">
        <label id="prefab-row" class="check-label"><input id="prefab" type="checkbox" checked /> <span data-i18n="panel_prefab">Prefab</span></label>
        <label class="check-label"><input id="overwrite" type="checkbox" /> <span data-i18n="panel_overwrite">Overwrite</span></label>
      </div>
      <button id="create" class="primary" data-i18n="panel_create">Create</button>
    </div>
    <div id="form-hint" class="form-hint" data-state="info"></div>
  </section>

  <section class="section project-strip">
    <div class="project-strip-title" data-i18n="panel_project">Project</div>
    <span class="tag"><strong id="module-count">0</strong>&nbsp;<span data-i18n="panel_modules">Modules</span></span>
    <span class="tag"><strong id="library-count">0</strong>&nbsp;<span data-i18n="panel_libraries">Libraries</span></span>
    <span class="tag"><strong id="pack-count">0</strong>&nbsp;<span data-i18n="panel_packs">Packs</span></span>
    <div id="module-list" class="module-tags"></div>
  </section>

  <section class="section result">
    <div class="section-heading">
      <div><div class="section-title" data-i18n="panel_result">Result</div><div class="section-description" data-result-summary data-i18n="panel_result_empty_summary">Run an action to inspect its result</div></div>
      <span class="state-pill" data-result-state data-state="info" data-i18n="panel_result_state_info">Idle</span>
    </div>
    <div data-result-empty class="empty-state" data-i18n="create_result_empty">Created files will appear here.</div>
    <div id="result-list" class="result-list"></div>
    <details class="raw-details hidden"><summary data-i18n="panel_raw_output">Raw output</summary><div class="raw-toolbar"><button data-result-copy data-i18n="panel_copy">Copy</button></div><pre id="result"></pre></details>
  </section>
</section>
`;

const style = `
${shared.baseStyle}

.create-section {
  display: grid;
  gap: 11px;
}

.create-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius);
  background: var(--color-normal-fill);
}

.create-tab {
  min-height: 34px;
  padding: 5px 7px;
  color: var(--color-normal-contrast-weaker);
  border-color: transparent;
  background: transparent;
  font-size: 13px;
}

.create-tab.active {
  color: var(--color-primary-contrast);
  border-color: var(--color-primary-border);
  background: var(--color-primary-fill);
}

.kind-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.kind-choice {
  justify-content: flex-start;
  min-height: 42px;
  padding: 7px 9px;
  gap: 7px;
  color: var(--color-normal-contrast-weaker);
  background: var(--color-normal-fill);
  font-size: 13px;
}

.kind-choice.active {
  color: var(--color-normal-contrast);
  border-color: var(--color-primary-border);
  box-shadow: inset 0 0 0 1px var(--color-primary-border);
}

.kind-glyph {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  place-items: center;
  color: var(--color-primary-contrast);
  border-radius: 6px;
  background: var(--color-primary-fill);
  font-size: 10px;
  font-weight: 750;
}

.name-row,
#owner-row {
  grid-column: 1 / -1;
}

.create-preview {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 10px;
}

.create-preview .preview-kicker {
  grid-row: 1 / 3;
  align-self: stretch;
  display: grid;
  padding-right: 10px;
  place-items: center;
  border-right: 1px solid var(--color-normal-border);
}

.preview-title {
  font-size: 12px;
}

.create-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}

.create-footer .primary {
  min-width: 130px;
}

.project-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.project-strip-title {
  margin-right: 3px;
  font-weight: 650;
}

.module-tags {
  display: flex;
  min-width: 0;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 2px;
}

@media (max-width: 470px) {
  .create-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kind-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .create-footer { grid-template-columns: 1fr; }
  .create-footer .primary { width: 100%; }
}
`;

const DEFAULT_CREATE_GROUP = 'structure';
const VIEW_KIND_PREFIXES = ['Page', 'Paper', 'Popup', 'Toast', 'Top', 'System'];
const MODULE_UNIT_SUFFIXES = ['Model', 'Service', 'Flow'];

function messageNameForKind(kind) {
  return {
    module: 'create-module', library: 'create-library', 'content-pack': 'create-content-pack', view: 'create-module-view',
    'global-view': 'create-global-view', part: 'create-part', model: 'create-model', service: 'create-service', flow: 'create-flow',
    'event-file': 'create-event-file', 'extension-stub': 'create-extension-stub',
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
  const words = String(value || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
}

function withViewKindPrefix(name, viewKind) {
  if (!name) return '';
  const prefix = VIEW_KIND_PREFIXES.includes(viewKind) ? viewKind : 'Page';
  const existingPrefix = knownKindPrefix(name);
  return `${prefix}${existingPrefix ? name.slice(existingPrefix.length) : name}`;
}

function withPartPrefix(name) {
  return !name || name.startsWith('Part') ? name : `Part${name}`;
}

function withUnitSuffix(name, suffix) {
  if (!name) return '';
  const existingSuffix = knownUnitSuffix(name);
  const core = existingSuffix ? name.slice(0, -existingSuffix.length) : name;
  return core ? `${core}${suffix}` : name;
}

function normalizeCreateName(kind, value, viewKind) {
  const name = pascalCaseName(value);
  if (isViewCreateKind(kind)) return withViewKindPrefix(name, viewKind);
  if (kind === 'part') return withPartPrefix(name);
  if (kind === 'model') return withUnitSuffix(name, 'Model');
  if (kind === 'service') return withUnitSuffix(name, 'Service');
  if (kind === 'flow') return withUnitSuffix(name, 'Flow');
  return name;
}

function placeholderKeyForKind(kind) {
  if (isViewCreateKind(kind)) return 'panel_placeholder_view';
  if (kind === 'part') return 'panel_placeholder_part';
  if (kind === 'model') return 'panel_placeholder_model';
  if (kind === 'service') return 'panel_placeholder_service';
  if (kind === 'flow') return 'panel_placeholder_flow';
  return 'panel_placeholder_pascal';
}

function kindLocaleKey(kind) {
  return `kind_${kind.replace(/-/g, '_')}`;
}

function targetPathForKind(kind, name, owner) {
  if (!name) return '—';
  if (kind === 'module') return `assets/modules/${name}`;
  if (kind === 'library') return `assets/libraries/${name}`;
  if (kind === 'content-pack') return `assets/content-packs/${owner || '?'}/${name}`;
  if (kind === 'global-view') return `assets/app/global/code/view/${name}.ts`;
  if (kind === 'extension-stub') return `assets/app/extensions/${name}.ts`;
  const folder = { view: 'view', part: 'part', model: 'model', service: 'service', flow: 'flow', 'event-file': 'events' }[kind] || 'code';
  return `assets/modules/${owner || '?'}/code/${folder}/${name}.ts`;
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell', status: '#status', refresh: '#refresh', kind: '#kind', kindGrid: '#kind-grid', viewKind: '#view-kind',
    viewKindRow: '#view-kind-row', name: '#name', owner: '#owner', ownerRow: '#owner-row', prefabRow: '#prefab-row',
    prefab: '#prefab', overwrite: '#overwrite', create: '#create', createStep: '#create-step', formHint: '#form-hint',
    previewTitle: '#preview-title', previewPath: '#preview-path', moduleCount: '#module-count', libraryCount: '#library-count',
    packCount: '#pack-count', moduleList: '#module-list', resultList: '#result-list', result: '#result',
  },
  methods: {
    t(key) { return shared.t(this, key); },

    setBusy(busy, label) {
      this.isBusy = busy;
      if (busy || this.$.shell.dataset.state === 'busy') shared.setStatus(this, label || (busy ? 'panel_status_working' : 'panel_status_ready'), busy ? 'busy' : 'ready');
      this.$.shell.setAttribute('aria-busy', String(busy));
      for (const control of this.$.shell.querySelectorAll('button, input, select')) control.disabled = busy;
      this.updateFormState();
    },

    async call(message, payload) { return await shared.call(message, payload); },
    setResult(value) { shared.setResult(this, value); },

    setCreateGroup(group) {
      const targetGroup = group || DEFAULT_CREATE_GROUP;
      const choices = Array.from(this.$.kindGrid.querySelectorAll('.kind-choice'));
      const activeChoices = choices.filter((choice) => choice.dataset.createGroup === targetGroup);
      if (activeChoices.length === 0) return;
      for (const choice of choices) {
        choice.classList.toggle('hidden', choice.dataset.createGroup !== targetGroup);
        choice.setAttribute('role', 'radio');
      }
      for (const tab of this.$.shell.querySelectorAll('.create-tab')) {
        const active = tab.dataset.createGroup === targetGroup;
        tab.classList.toggle('active', active);
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(active));
      }
      if (!activeChoices.some((choice) => choice.dataset.kind === this.$.kind.value)) this.chooseKind(activeChoices[0].dataset.kind);
      else this.chooseKind(this.$.kind.value);
    },

    chooseKind(kind) {
      this.$.kind.value = kind;
      for (const choice of this.$.kindGrid.querySelectorAll('.kind-choice')) {
        const active = choice.dataset.kind === kind;
        choice.classList.toggle('active', active);
        choice.setAttribute('aria-checked', String(active));
      }
      this.updateVisibility();
      this.normalizeNameField();
      this.updatePreview();
    },

    updateVisibility() {
      const kind = this.$.kind.value;
      this.$.ownerRow.classList.toggle('hidden', !kindNeedsOwner(kind));
      this.$.prefabRow.classList.toggle('hidden', !kindSupportsPrefab(kind));
      this.$.viewKindRow.classList.toggle('hidden', !isViewCreateKind(kind));
      this.$.name.setAttribute('placeholder', this.t(placeholderKeyForKind(kind)).replace('{kind}', this.$.viewKind.value));
      this.$.create.textContent = this.t('panel_create_named').replace('{kind}', this.t(kindLocaleKey(kind)));
      this.updateFormState();
    },

    normalizeNameField() {
      const normalized = normalizeCreateName(this.$.kind.value, this.$.name.value, this.$.viewKind.value);
      if (normalized) this.$.name.value = normalized;
      this.updatePreview();
    },

    updatePreview() {
      const kind = this.$.kind.value;
      const name = normalizeCreateName(kind, this.$.name.value, this.$.viewKind.value);
      const owner = this.$.owner.value;
      this.$.previewTitle.textContent = `${this.t(kindLocaleKey(kind))}${name ? ` · ${name}` : ''}`;
      this.$.previewPath.textContent = targetPathForKind(kind, name, owner);
      this.updateFormState();
    },

    validationMessage() {
      const kind = this.$.kind.value;
      const name = normalizeCreateName(kind, this.$.name.value, this.$.viewKind.value);
      if (!name) return this.t('create_name_required');
      if (kindNeedsOwner(kind) && !this.$.owner.value) return this.t('create_owner_required');
      return '';
    },

    updateFormState() {
      const message = this.validationMessage();
      this.$.formHint.textContent = message || this.t('create_form_ready');
      this.$.formHint.dataset.state = message ? 'error' : 'info';
      this.$.create.disabled = Boolean(this.isBusy || message);
      this.$.createStep.textContent = message ? this.t('create_needs_attention') : this.t('create_ready');
    },

    async refreshSummary(options = {}) {
      this.setBusy(true, 'panel_status_refreshing');
      try {
        const summary = await this.call('get-project-summary');
        const modules = summary.modules || [];
        this.$.moduleCount.textContent = String(modules.length);
        this.$.libraryCount.textContent = String((summary.libraries || []).length);
        this.$.packCount.textContent = String((summary.contentPacks || []).length);
        this.$.moduleList.innerHTML = modules.length > 0
          ? modules.map((item) => `<span class="tag">${shared.escapeHtml(item.name)}</span>`).join('')
          : `<span class="form-hint">${shared.escapeHtml(this.t('panel_no_modules'))}</span>`;
        const selectedOwner = this.$.owner.value;
        this.$.owner.innerHTML = modules.length > 0
          ? modules.map((item) => `<option value="${shared.escapeHtml(item.name)}">${shared.escapeHtml(item.name)}</option>`).join('')
          : `<option value="">${shared.escapeHtml(this.t('panel_no_modules'))}</option>`;
        if (selectedOwner && modules.some((item) => item.name === selectedOwner)) this.$.owner.value = selectedOwner;
        if (!options.silentResult) this.setResult(summary);
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
        this.updatePreview();
      }
    },

    async createItem() {
      const validation = this.validationMessage();
      if (validation) {
        this.updateFormState();
        this.$.name.focus();
        return;
      }
      const kind = this.$.kind.value;
      const name = normalizeCreateName(kind, this.$.name.value, this.$.viewKind.value);
      this.$.name.value = name;
      const payload = { name, prefab: this.$.prefab.checked, overwrite: this.$.overwrite.checked };
      if (kindNeedsOwner(kind)) payload.owner = this.$.owner.value;
      if (isViewCreateKind(kind)) payload.viewKind = this.$.viewKind.value;
      this.setBusy(true, 'panel_status_creating');
      try {
        const result = await this.call(messageNameForKind(kind), payload);
        this.setResult(result);
        if (result?.ok !== false) {
          await this.refreshSummary({ silentResult: true });
          this.$.name.value = '';
          this.$.name.focus();
          this.updatePreview();
        }
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },
  },
  ready() {
    shared.initialize(this);
    this.isBusy = false;
    for (const tab of this.$.shell.querySelectorAll('.create-tab')) tab.addEventListener('click', () => this.setCreateGroup(tab.dataset.createGroup));
    for (const choice of this.$.kindGrid.querySelectorAll('.kind-choice')) choice.addEventListener('click', () => this.chooseKind(choice.dataset.kind));
    this.$.viewKind.addEventListener('change', () => this.normalizeNameField());
    this.$.owner.addEventListener('change', () => this.updatePreview());
    this.$.name.addEventListener('input', () => this.updatePreview());
    this.$.name.addEventListener('blur', () => this.normalizeNameField());
    this.$.name.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !this.$.create.disabled) void this.createItem(); });
    this.$.refresh.addEventListener('click', () => this.refreshSummary());
    this.$.create.addEventListener('click', () => this.createItem());
    this.setCreateGroup(DEFAULT_CREATE_GROUP);
    this.refreshSummary({ silentResult: true });
  },
  beforeClose() {},
  close() {},
});
