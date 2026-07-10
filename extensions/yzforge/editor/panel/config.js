'use strict';

const shared = require('./shared');

const template = `
<section class="shell config-shell" data-state="ready">
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-mark">YZ</div>
      <div class="title-stack">
        <div class="eyebrow" data-i18n="panel_product_label">PROJECT GOVERNANCE</div>
        <h1 data-i18n="config_panel_title">YZForge Config Tables</h1>
        <p class="status-line"><span class="status-dot"></span><span id="status" data-i18n="panel_status_ready">Ready</span></p>
      </div>
    </div>
    <button id="config-scan" data-i18n="config_scan">Scan Excel</button>
  </header>

  <section class="config-overview" aria-label="Config overview">
    <div class="overview-item"><strong id="config-source-count">0</strong><span data-i18n="config_sources">Excel sources</span></div>
    <div class="overview-item"><strong id="config-rule-count">0</strong><span data-i18n="config_rules">Saved rules</span></div>
    <div class="overview-item"><strong id="config-target-count">0</strong><span data-i18n="config_targets">Available targets</span></div>
  </section>

  <div class="config-workspace">
    <section class="section rule-section">
      <div class="section-heading">
        <div>
          <div class="section-title" data-i18n="config_saved_table">Saved Rule</div>
          <div class="section-description" data-i18n="config_rule_list_desc">Select a rule or start a new mapping</div>
        </div>
        <span id="config-dirty-state" class="state-pill" data-state="success" data-i18n="config_state_saved">Saved</span>
      </div>

      <label>
        <span data-i18n="config_rule">Rule</span>
        <select id="config-plan-table"></select>
      </label>

      <div class="rule-actions">
        <button id="config-new-table" data-i18n="config_new_table">New Rule</button>
        <button id="config-delete-table" class="danger" data-i18n="config_delete_table">Delete Rule</button>
      </div>

      <label class="rule-name-row">
        <span data-i18n="config_rule_name">Rule Name</span>
        <input id="config-rule-label" data-i18n-placeholder="config_rule_name_placeholder" placeholder="Battle Items" />
      </label>

      <div class="rule-note" data-i18n="config_rule_note">Rules are stored in config-source/export-plan.json.</div>
    </section>

    <section class="section mapping-section">
      <div class="section-heading">
        <div>
          <div class="section-title" data-i18n="config_mapping">Data Mapping</div>
          <div class="section-description" data-i18n="config_mapping_desc">Connect one Excel sheet to its owning scope</div>
        </div>
      </div>

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
        <label class="table-field">
          <span data-i18n="config_table">Table Key</span>
          <input id="config-table" data-i18n-placeholder="config_table_placeholder" placeholder="battleItems" />
          <span class="field-hint" data-i18n="config_table_hint">Use lower camel case; the row type is derived automatically.</span>
        </label>
        <label class="check-label generate-keys">
          <input id="config-generate-keys" type="checkbox" checked />
          <span data-i18n="config_generate_keys">Generate ID constants</span>
        </label>
      </div>

      <div class="preview-card config-preview">
        <div class="preview-kicker" data-i18n="config_output_preview">OUTPUT PREVIEW</div>
        <div id="config-preview-source" class="preview-value">—</div>
        <div id="config-preview-path" class="preview-path">—</div>
      </div>
    </section>
  </div>

  <section class="section action-section">
    <div class="action-copy">
      <div class="section-title" data-i18n="config_actions">Apply Configuration</div>
      <div id="config-form-hint" class="form-hint" data-state="info" data-i18n="config_form_ready">Mapping is ready to save.</div>
    </div>
    <div class="config-actions">
      <button id="config-save-table" class="primary" data-i18n="config_save_table">Save Rule</button>
      <button id="config-check" data-i18n="config_check">Config Check</button>
      <button id="config-build" class="command-primary" data-i18n="config_build">Build Config</button>
    </div>
  </section>

  <section class="section result">
    <div class="section-heading">
      <div>
        <div class="section-title" data-i18n="panel_result">Result</div>
        <div class="section-description" data-result-summary data-i18n="config_result_empty">Save, check, or build to inspect details</div>
      </div>
      <span class="state-pill" data-result-state data-state="info" data-i18n="panel_result_state_info">Idle</span>
    </div>
    <div data-result-empty class="empty-state" data-i18n="panel_result_empty">No command has run yet.</div>
    <div id="result-list" class="result-list"></div>
    <details class="raw-details hidden">
      <summary data-i18n="panel_raw_output">Raw output</summary>
      <div class="raw-toolbar"><button data-result-copy data-i18n="panel_copy">Copy</button></div>
      <pre id="result"></pre>
    </details>
  </section>
</section>
`;

const style = `
${shared.baseStyle}

.config-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius-lg);
  background: var(--color-normal-fill-emphasis);
}

.overview-item {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 9px 12px;
  border-right: 1px solid var(--color-normal-border);
}

.overview-item:last-child { border-right: 0; }
.overview-item strong { font-size: 16px; line-height: 1.15; }
.overview-item span { color: var(--color-normal-contrast-weaker); font-size: 9px; }

.config-workspace {
  display: grid;
  grid-template-columns: minmax(190px, 0.72fr) minmax(300px, 1.4fr);
  align-items: start;
  gap: var(--yz-space);
}

.rule-section,
.mapping-section {
  height: 100%;
}

.rule-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 8px;
}

.rule-name-row { margin-top: 10px; }

.rule-note {
  margin-top: 10px;
  padding-top: 9px;
  color: var(--color-normal-contrast-weaker);
  border-top: 1px solid var(--color-normal-border);
  font-size: 9px;
}

.table-field { grid-column: 1 / -1; }

.generate-keys {
  align-self: end;
  min-height: 31px;
  padding: 0 1px;
}

.config-preview { margin-top: 11px; }

.preview-path {
  min-width: 0;
  overflow: hidden;
  color: var(--color-primary-contrast);
  font: 10px/1.45 var(--font-mono, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.action-copy { min-width: 150px; }

.config-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(105px, 1fr));
  gap: 7px;
}

@media (max-width: 650px) {
  .config-workspace { grid-template-columns: 1fr; }
  .action-section { align-items: stretch; flex-direction: column; }
}

@media (max-width: 470px) {
  .config-overview,
  .config-actions { grid-template-columns: 1fr; }
  .overview-item { border-right: 0; border-bottom: 1px solid var(--color-normal-border); }
  .overview-item:last-child { border-bottom: 0; }
}
`;

function configScopeTargetValue(scope = {}) {
  if (scope.kind === 'content-pack') return `${scope.owner || ''}/${scope.name || ''}`;
  if (scope.kind === 'global') return 'Global';
  return scope.name || '';
}

function configDefaultTableKey(value) {
  const words = String(value || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return '';
  const [first, ...rest] = words;
  return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')}`;
}

function configPlanLabel(table) {
  if (table.label) return table.label;
  const scope = table.scope || {};
  const target = configScopeTargetValue(scope);
  return [scope.kind || 'unknown', target && target !== 'Global' ? target : undefined, table.table || table.sheet].filter(Boolean).join(' / ');
}

function pascalCase(value) {
  return String(value || '').replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_match, _separator, char) => char.toUpperCase());
}

function configOutputPath(kind, target, table) {
  if (!table) return '—';
  const filename = `${pascalCase(table)}.json`;
  if (kind === 'global') return `assets/app/global/res/content/config/${filename}`;
  if (kind === 'module') return `assets/modules/${target || '…'}/res/content/config/${filename}`;
  if (kind === 'library') return `assets/libraries/${target || '…'}/res/content/config/${filename}`;
  if (kind === 'content-pack') return `assets/content-packs/${target || '…'}/res/content/config/${filename}`;
  return filename;
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell', status: '#status', configPlanTable: '#config-plan-table', configNewTable: '#config-new-table',
    configRuleLabel: '#config-rule-label', configSource: '#config-source', configSheet: '#config-sheet',
    configScopeKind: '#config-scope-kind', configScopeTarget: '#config-scope-target', configTable: '#config-table',
    configGenerateKeys: '#config-generate-keys', configScan: '#config-scan', configSaveTable: '#config-save-table',
    configDeleteTable: '#config-delete-table', configBuild: '#config-build', configCheck: '#config-check',
    configDirtyState: '#config-dirty-state', configFormHint: '#config-form-hint', configPreviewSource: '#config-preview-source',
    configPreviewPath: '#config-preview-path', configSourceCount: '#config-source-count', configRuleCount: '#config-rule-count',
    configTargetCount: '#config-target-count', resultList: '#result-list', result: '#result',
  },
  methods: {
    t(key) { return shared.t(this, key); },
    async call(message, payload) { return await shared.call(message, payload); },
    setResult(value) { shared.setResult(this, value); },

    setBusy(busy, label) {
      this.isBusy = busy;
      if (busy || this.$.shell.dataset.state === 'busy') {
        shared.setStatus(this, label || (busy ? 'panel_status_working' : 'panel_status_ready'), busy ? 'busy' : 'ready');
      }
      this.$.shell.setAttribute('aria-busy', String(busy));
      for (const control of this.$.shell.querySelectorAll('button, input, select')) control.disabled = busy;
      if (!busy) this.updateFormState();
    },

    setDirty(dirty) {
      this.isDirty = dirty;
      this.$.configDirtyState.dataset.state = dirty ? 'warning' : 'success';
      this.$.configDirtyState.textContent = this.t(dirty ? 'config_state_dirty' : 'config_state_saved');
      this.updateFormState();
    },

    markConfigDirty() {
      if (!this.isApplying) this.setDirty(true);
      this.updatePreview();
    },

    confirmDiscard() {
      return !this.isDirty || typeof window === 'undefined' || typeof window.confirm !== 'function'
        || window.confirm(this.t('config_discard_confirm'));
    },

    updateOverview() {
      const dashboard = this.configDashboardValue || {};
      const scopes = dashboard.scopes || {};
      const rules = dashboard.plan?.tables || [];
      const targetCount = (scopes.modules || []).length + (scopes.libraries || []).length
        + (scopes.contentPacks || []).length + (scopes.global ? 1 : 0);
      this.$.configSourceCount.textContent = String((dashboard.sources || []).length);
      this.$.configRuleCount.textContent = String(rules.length);
      this.$.configTargetCount.textContent = String(targetCount);
    },

    updateConfigSourceSheets(preferredSheet) {
      const dashboard = this.configDashboardValue || {};
      const source = (dashboard.sources || []).find((item) => item.source === this.$.configSource.value);
      const sheets = source && Array.isArray(source.sheets) ? source.sheets : [];
      const selected = preferredSheet || this.$.configSheet.value;
      this.$.configSheet.innerHTML = sheets.length > 0
        ? sheets.map((sheet) => `<option value="${shared.escapeHtml(sheet)}">${shared.escapeHtml(sheet)}</option>`).join('')
        : `<option value="">${shared.escapeHtml(this.t('config_no_sheets'))}</option>`;
      if (selected && sheets.includes(selected)) this.$.configSheet.value = selected;
      this.applyConfigDefaults();
      this.updatePreview();
    },

    updateConfigScopeTargets(preferredTarget) {
      const dashboard = this.configDashboardValue || {};
      const scopes = dashboard.scopes || {};
      const kind = this.$.configScopeKind.value;
      let targets = [];
      if (kind === 'module') targets = scopes.modules || [];
      else if (kind === 'library') targets = scopes.libraries || [];
      else if (kind === 'content-pack') targets = (scopes.contentPacks || []).map((item) => `${item.owner}/${item.name}`);
      else if (kind === 'global') targets = scopes.global === false ? [] : ['Global'];
      this.$.configScopeTarget.innerHTML = targets.length > 0
        ? targets.map((target) => `<option value="${shared.escapeHtml(target)}">${shared.escapeHtml(target)}</option>`).join('')
        : `<option value="">${shared.escapeHtml(this.t('config_no_target'))}</option>`;
      if (preferredTarget && targets.includes(preferredTarget)) this.$.configScopeTarget.value = preferredTarget;
      this.updatePreview();
    },

    updateConfigPlanTables(selectedId) {
      const tables = this.configDashboardValue?.plan?.tables || [];
      const selected = selectedId !== undefined ? selectedId : this.$.configPlanTable.value;
      this.$.configPlanTable.innerHTML = [
        `<option value="">${shared.escapeHtml(this.t('config_new_table'))}</option>`,
        ...tables.map((table) => `<option value="${shared.escapeHtml(table.id || '')}">${shared.escapeHtml(configPlanLabel(table))}</option>`),
      ].join('');
      if (selected && tables.some((table) => table.id === selected)) this.$.configPlanTable.value = selected;
    },

    selectedConfigPlanTable() {
      const tables = this.configDashboardValue?.plan?.tables || [];
      return tables.find((table) => table.id === this.$.configPlanTable.value);
    },

    applyConfigPlanTable() {
      const table = this.selectedConfigPlanTable();
      this.isApplying = true;
      if (table) {
        this.$.configRuleLabel.value = table.label || '';
        this.$.configSource.value = table.source || '';
        this.updateConfigSourceSheets(table.sheet || '');
        this.$.configScopeKind.value = table.scope?.kind || 'module';
        this.updateConfigScopeTargets(configScopeTargetValue(table.scope));
        this.$.configTable.value = table.table || '';
        this.$.configGenerateKeys.checked = table.generateKeys !== false;
      } else {
        this.$.configRuleLabel.value = '';
        this.$.configTable.value = '';
        this.$.configGenerateKeys.checked = true;
        this.updateConfigSourceSheets();
        this.updateConfigScopeTargets();
        this.applyConfigDefaults();
      }
      this.currentRuleId = table?.id || '';
      this.isApplying = false;
      this.setDirty(false);
      this.updatePreview();
    },

    changeConfigPlanTable() {
      const nextId = this.$.configPlanTable.value;
      if (nextId !== this.currentRuleId && !this.confirmDiscard()) {
        this.$.configPlanTable.value = this.currentRuleId || '';
        return;
      }
      this.applyConfigPlanTable();
    },

    beginNewConfigTable() {
      if (!this.confirmDiscard()) return;
      this.$.configPlanTable.value = '';
      this.applyConfigPlanTable();
      this.$.configRuleLabel.focus();
    },

    applyConfigDefaults() {
      const sheet = this.$.configSheet.value;
      if (!this.$.configTable.value && sheet) this.$.configTable.value = configDefaultTableKey(sheet);
    },

    updatePreview() {
      const source = this.$.configSource.value;
      const sheet = this.$.configSheet.value;
      const kind = this.$.configScopeKind.value;
      const target = this.$.configScopeTarget.value;
      const table = this.$.configTable.value.trim();
      this.$.configPreviewSource.textContent = source && sheet ? `${source}  ·  ${sheet}` : this.t('config_preview_empty');
      this.$.configPreviewPath.textContent = configOutputPath(kind, target, table);
      this.updateFormState();
    },

    validationMessage() {
      if (!this.$.configSource.value) return this.t('config_source_required');
      if (!this.$.configSheet.value) return this.t('config_sheet_required');
      if (!this.$.configScopeTarget.value) return this.t('config_target_required');
      const table = this.$.configTable.value.trim();
      if (!table) return this.t('config_table_required');
      if (!/^[a-z][A-Za-z0-9]*$/.test(table)) return this.t('config_table_invalid');
      return '';
    },

    updateFormState() {
      const validation = this.validationMessage();
      const message = validation || (this.isDirty ? this.t('config_unsaved_hint') : this.t('config_form_ready'));
      this.$.configFormHint.textContent = message;
      this.$.configFormHint.dataset.state = validation ? 'error' : 'info';
      this.$.configSaveTable.disabled = Boolean(this.isBusy || validation || !this.isDirty);
      this.$.configDeleteTable.disabled = Boolean(this.isBusy || !this.currentRuleId);
    },

    async refreshConfigDashboard(options = {}) {
      if (!options.keepBusy) this.setBusy(true, 'panel_status_refreshing');
      try {
        const dashboard = await this.call('config-dashboard');
        this.configDashboardValue = dashboard;
        this.updateOverview();
        const sources = dashboard.sources || [];
        const selectedSource = this.$.configSource.value;
        this.$.configSource.innerHTML = sources.length > 0
          ? sources.map((item) => `<option value="${shared.escapeHtml(item.source)}">${shared.escapeHtml(item.source)}</option>`).join('')
          : `<option value="">${shared.escapeHtml(this.t('config_no_sources'))}</option>`;
        if (selectedSource && sources.some((item) => item.source === selectedSource)) this.$.configSource.value = selectedSource;
        this.updateConfigPlanTables(options.selectedId ?? this.currentRuleId);
        this.applyConfigPlanTable();
        if (!options.silentResult) this.setResult(dashboard);
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        if (!options.keepBusy) this.setBusy(false);
      }
    },

    async scanConfigSources() {
      if (!this.confirmDiscard()) return;
      await this.refreshConfigDashboard();
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
      const payload = {
        label: this.$.configRuleLabel.value.trim(),
        source: this.$.configSource.value,
        sheet: this.$.configSheet.value,
        table: this.$.configTable.value.trim(),
        generateKeys: this.$.configGenerateKeys.checked === true,
        scope,
      };
      if (this.currentRuleId) payload.id = this.currentRuleId;
      return payload;
    },

    async saveConfigTable() {
      this.applyConfigDefaults();
      if (this.validationMessage()) {
        this.updateFormState();
        return;
      }
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-save-table', this.configTablePayload());
        this.setResult(result);
        if (result?.ok !== false) {
          this.currentRuleId = result.table?.id || this.currentRuleId;
          await this.refreshConfigDashboard({ silentResult: true, keepBusy: true, selectedId: this.currentRuleId });
        }
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async deleteConfigTable() {
      const table = this.selectedConfigPlanTable();
      if (!table) return;
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(this.t('config_delete_confirm'))) return;
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-delete-table', { id: table.id });
        this.setResult(result);
        if (result?.ok !== false) {
          this.currentRuleId = '';
          await this.refreshConfigDashboard({ silentResult: true, keepBusy: true, selectedId: '' });
        }
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async buildConfig() {
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-build');
        this.setResult(result);
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async checkConfig() {
      this.setBusy(true, 'panel_status_validating');
      try {
        this.setResult(await this.call('config-check'));
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
    this.isDirty = false;
    this.isApplying = false;
    this.currentRuleId = '';
    this.$.configScan.addEventListener('click', () => this.scanConfigSources());
    this.$.configPlanTable.addEventListener('change', () => this.changeConfigPlanTable());
    this.$.configNewTable.addEventListener('click', () => this.beginNewConfigTable());
    this.$.configSource.addEventListener('change', () => { this.updateConfigSourceSheets(); this.markConfigDirty(); });
    this.$.configSheet.addEventListener('change', () => { this.applyConfigDefaults(); this.markConfigDirty(); });
    this.$.configScopeKind.addEventListener('change', () => { this.updateConfigScopeTargets(); this.markConfigDirty(); });
    this.$.configScopeTarget.addEventListener('change', () => this.markConfigDirty());
    this.$.configRuleLabel.addEventListener('input', () => this.markConfigDirty());
    this.$.configTable.addEventListener('input', () => this.markConfigDirty());
    this.$.configGenerateKeys.addEventListener('change', () => this.markConfigDirty());
    this.$.configSaveTable.addEventListener('click', () => this.saveConfigTable());
    this.$.configDeleteTable.addEventListener('click', () => this.deleteConfigTable());
    this.$.configBuild.addEventListener('click', () => this.buildConfig());
    this.$.configCheck.addEventListener('click', () => this.checkConfig());
    this.$.shell.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!this.$.configSaveTable.disabled) void this.saveConfigTable();
      }
    });
    this.refreshConfigDashboard({ silentResult: true });
  },
  beforeClose() {},
  close() {},
});
