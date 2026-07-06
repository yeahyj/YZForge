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

  <section class="section">
    <div class="section-title" data-i18n="panel_create">Create</div>
    <div class="form-grid">
      <label>
        <span data-i18n="panel_kind">Kind</span>
        <select id="kind">
          <option value="module" data-i18n="kind_module">Module</option>
          <option value="library" data-i18n="kind_library">Library</option>
          <option value="content-pack" data-i18n="kind_content_pack">ContentPack</option>
          <option value="view" data-i18n="kind_view">Module View</option>
          <option value="global-view" data-i18n="kind_global_view">Global View</option>
          <option value="part" data-i18n="kind_part">Part</option>
          <option value="model" data-i18n="kind_model">Model</option>
          <option value="service" data-i18n="kind_service">Service</option>
          <option value="flow" data-i18n="kind_flow">Flow</option>
          <option value="event-file" data-i18n="kind_event_file">Event File</option>
          <option value="extension-stub" data-i18n="kind_extension_stub">Extension Stub</option>
        </select>
      </label>
      <label>
        <span data-i18n="panel_name">Name</span>
        <input id="name" data-i18n-placeholder="panel_placeholder_pascal" placeholder="PascalCase" />
      </label>
      <label id="owner-row">
        <span data-i18n="panel_owner">Owner</span>
        <select id="owner"></select>
      </label>
    </div>
    <div id="prefab-row" class="options-row">
      <label><input id="prefab" type="checkbox" checked /> <span data-i18n="panel_prefab">Prefab</span></label>
      <label><input id="overwrite" type="checkbox" /> <span data-i18n="panel_overwrite">Overwrite</span></label>
    </div>
    <button id="create" class="primary" data-i18n="panel_create">Create</button>
  </section>

  <section class="section action-row">
    <button id="generate" data-i18n="generate_all">Generate All</button>
    <button id="clean" data-i18n="clean_generated">Clean Generated</button>
    <button id="validate" data-i18n="validate_architecture">Validate</button>
    <button id="validate-strict" data-i18n="validate_architecture_strict">Validate Strict</button>
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
  gap: 10px;
  min-width: 0;
  height: 100%;
  padding: 12px;
  background: var(--color-normal-fill);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
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
  border-radius: 6px;
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

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
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
  gap: 14px;
  margin: 10px 0;
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
  width: 100%;
  border-color: var(--color-primary-border);
  background: var(--color-primary-fill);
}

.icon-button {
  flex: none;
}

.action-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
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
  border-radius: 4px;
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

.result {
  flex: 1;
  min-height: 0;
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
  border-radius: 4px;
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
  height: calc(100% - 24px);
  min-height: 140px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--color-normal-contrast);
  border-radius: 4px;
  background: var(--color-normal-fill);
}

.hidden {
  display: none;
}
`;

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

function getLocale() {
  const language = Editor.I18n && typeof Editor.I18n.getLanguage === 'function'
    ? Editor.I18n.getLanguage()
    : 'en';
  return String(language || '').toLowerCase().startsWith('zh') ? zh : en;
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell',
    status: '#status',
    refresh: '#refresh',
    kind: '#kind',
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
      for (const button of [this.$.refresh, this.$.create, this.$.generate, this.$.clean, this.$.validate]) {
        button.disabled = busy;
      }
      this.$.validateStrict.disabled = busy;
    },

    resultRows(value) {
      if (!value || typeof value !== 'object') {
        return [];
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
      if (Array.isArray(value.fileDetails) && value.fileDetails.length > 0) {
        return value.fileDetails.map((item) => ({
          label: item.path,
          url: item.url,
          path: item.path,
        }));
      }
      return [];
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
      const needsOwner = !['module', 'library', 'global-view', 'extension-stub'].includes(kind);
      const needsPrefab = ['view', 'global-view', 'part'].includes(kind);
      this.$.ownerRow.classList.toggle('hidden', !needsOwner);
      this.$.prefabRow.classList.toggle('hidden', !needsPrefab);
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
        this.$.owner.innerHTML = modules
          .map((item) => `<option value="${item.name}">${item.name}</option>`)
          .join('');
        if (!options.silentResult) {
          this.setResult(summary);
        }
      } catch (error) {
        this.setResult({ ok: false, error: error.message });
      } finally {
        this.setBusy(false);
        this.updateVisibility();
      }
    },

    async createItem() {
      const kind = this.$.kind.value;
      const name = this.$.name.value.trim();
      const message = messageNameForKind(kind);
      const payload = {
        name,
        owner: this.$.owner.value,
        prefab: this.$.prefab.checked,
        overwrite: this.$.overwrite.checked,
      };
      this.setBusy(true, 'panel_status_creating');
      try {
        const result = await this.call(message, payload);
        this.setResult(result);
        await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult({ ok: false, error: error.message });
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
        this.setResult({ ok: false, error: error.message });
      } finally {
        this.setBusy(false);
      }
    },

    async cleanGenerated() {
      this.setBusy(true, 'panel_status_cleaning');
      try {
        this.setResult(await this.call('clean-generated', { dryRun: false }));
        await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult({ ok: false, error: error.message });
      } finally {
        this.setBusy(false);
      }
    },

    async validateProject() {
      this.setBusy(true, 'panel_status_validating');
      try {
        this.setResult(await this.call('validate-architecture'));
      } catch (error) {
        this.setResult({ ok: false, error: error.message });
      } finally {
        this.setBusy(false);
      }
    },

    async validateProjectStrict() {
      this.setBusy(true, 'panel_status_validating');
      try {
        this.setResult(await this.call('validate-architecture-strict'));
      } catch (error) {
        this.setResult({ ok: false, error: error.message });
      } finally {
        this.setBusy(false);
      }
    },
  },
  ready() {
    this.translate();
    this.$.kind.addEventListener('change', () => this.updateVisibility());
    this.$.refresh.addEventListener('click', () => this.refreshSummary());
    this.$.create.addEventListener('click', () => this.createItem());
    this.$.generate.addEventListener('click', () => this.generateAll());
    this.$.clean.addEventListener('click', () => this.cleanGenerated());
    this.$.validate.addEventListener('click', () => this.validateProject());
    this.$.validateStrict.addEventListener('click', () => this.validateProjectStrict());
    this.updateVisibility();
    this.refreshSummary();
  },
  beforeClose() {},
  close() {},
});
