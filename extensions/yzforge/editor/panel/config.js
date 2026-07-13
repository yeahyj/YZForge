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
    <div class="overview-item"><strong id="config-rule-count">0</strong><span data-i18n="config_exported_sheets">Exported sheets</span></div>
    <div class="overview-item"><strong id="config-target-count">0</strong><span data-i18n="config_targets">Available targets</span></div>
  </section>

  <section class="section file-section">
    <div class="section-heading">
      <div>
        <div class="section-title" data-i18n="config_file_defaults">File Configuration</div>
        <div class="section-description" data-i18n="config_file_defaults_desc">Set the owning target once for the whole Excel file</div>
      </div>
      <span id="config-dirty-state" class="state-pill" data-state="info" data-i18n="config_state_unconfigured">Not configured</span>
    </div>

    <div class="form-grid file-form">
      <label class="source-field">
        <span data-i18n="config_source_file">Excel File</span>
        <select id="config-source"></select>
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
    </div>

    <div class="file-options">
      <label class="check-label">
        <input id="config-generate-keys" type="checkbox" checked />
        <span data-i18n="config_generate_keys_default">Generate ID constants for all sheets</span>
      </label>
    </div>

    <div class="file-summary">
      <div class="preview-card config-preview">
        <div class="preview-kicker" data-i18n="config_output_preview">OUTPUT PREVIEW</div>
        <div id="config-preview-source" class="preview-value">—</div>
        <div id="config-preview-path" class="preview-path">—</div>
      </div>
      <button id="config-details" class="details-button" aria-expanded="false">
        <span data-i18n="config_details">Sheet Details</span>
        <span id="config-details-count" class="button-badge">0</span>
      </button>
    </div>

    <section id="sheet-details" class="sheet-details hidden" aria-hidden="true">
      <div class="details-heading">
        <div>
          <div class="section-title" data-i18n="config_sheet_overrides">Sheet Overrides</div>
          <div class="section-description" data-i18n="config_sheet_overrides_desc">Enable sheets or override table keys and targets only when needed</div>
        </div>
      </div>
      <div id="sheet-list" class="sheet-list"></div>
    </section>
  </section>

  <section class="section action-section">
    <div class="action-copy">
      <div class="section-title" data-i18n="config_actions">Apply Configuration</div>
      <div id="config-form-hint" class="form-hint" data-state="info" data-i18n="config_form_ready">File configuration is ready.</div>
    </div>
    <div class="config-actions">
      <button id="config-delete-source" class="danger" data-i18n="config_delete_source">Remove File Rules</button>
      <button id="config-save-source" class="primary" data-i18n="config_save_source">Save File Configuration</button>
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
  gap: 3px;
  padding: 11px 13px;
  border-right: 1px solid var(--color-normal-border);
}

.overview-item:last-child { border-right: 0; }
.overview-item strong { font-size: 18px; line-height: 1.15; }
.overview-item span { color: var(--color-normal-contrast-weaker); font-size: 11px; }

.file-section { display: grid; gap: 12px; }
.file-section > .section-heading { margin-bottom: 0; }
.source-field { grid-column: 1 / -1; }

.file-options {
  display: flex;
  min-height: 30px;
  align-items: center;
}

.file-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  gap: 8px;
}

.config-preview { min-height: 68px; }

.preview-path {
  min-width: 0;
  overflow: hidden;
  color: var(--color-primary-contrast);
  font: 11px/1.5 var(--font-mono, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.details-button {
  min-width: 138px;
  gap: 8px;
}

.button-badge {
  display: inline-grid;
  min-width: 22px;
  min-height: 22px;
  padding: 0 6px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-normal-fill);
  font-size: 11px;
}

.sheet-details {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--color-normal-border);
}

.sheet-list {
  display: grid;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}

.sheet-row {
  display: grid;
  grid-template-columns: minmax(125px, 1.15fr) minmax(115px, 1fr) 105px minmax(120px, 1fr) auto;
  align-items: end;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius);
  background: var(--color-normal-fill);
}

.sheet-row[data-enabled='false'] .sheet-field:not(.sheet-enable) { opacity: 0.5; }

.sheet-enable {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  align-self: stretch;
  gap: 8px;
  padding-bottom: 3px;
}

.sheet-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-keys {
  min-width: 74px;
  align-self: center;
  justify-content: center;
}

.action-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.action-copy { min-width: 180px; }

.config-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(112px, 1fr));
  gap: 7px;
}

@media (max-width: 820px) {
  .sheet-row { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
  .sheet-enable { grid-column: 1 / -1; min-height: 32px; }
  .sheet-keys { justify-content: flex-start; }
  .action-section { align-items: stretch; flex-direction: column; }
  .config-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 470px) {
  .config-overview,
  .file-summary,
  .sheet-row,
  .config-actions { grid-template-columns: 1fr; }
  .overview-item { border-right: 0; border-bottom: 1px solid var(--color-normal-border); }
  .overview-item:last-child { border-bottom: 0; }
  .sheet-enable { grid-column: auto; }
  .details-button { width: 100%; }
}
`;

function configDefaultTableKey(value) {
  const words = String(value || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return '';
  const [first, ...rest] = words;
  return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')}`;
}

function pascalCase(value) {
  const normalized = configDefaultTableKey(value);
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : '';
}

function sourceName(source) {
  const filename = String(source || '').split('/').pop() || '';
  return filename.replace(/\.xlsx$/i, '');
}

function scopeTargetValue(scope = {}) {
  if (scope.kind === 'content-pack') return `${scope.owner || ''}/${scope.name || ''}`;
  if (scope.kind === 'global') return 'Global';
  return scope.name || '';
}

function scopeFrom(kind, target) {
  if (kind === 'content-pack') {
    const [owner, name] = String(target || '').split('/');
    return { kind, owner, name };
  }
  if (kind === 'global') return { kind };
  return { kind, name: target };
}

function scopeKey(scope = {}) {
  return `${scope.kind || ''}:${scope.owner || ''}:${scope.name || ''}`;
}

function scopeLabel(scope = {}) {
  if (scope.kind === 'global') return 'global';
  return `${scope.kind || 'unknown'}:${scopeTargetValue(scope)}`;
}

function configOutputPath(scope, table) {
  if (!table) return '—';
  const filename = `${pascalCase(table)}.json`;
  const target = scopeTargetValue(scope);
  if (scope.kind === 'global') return `assets/app/global/res/content/config/${filename}`;
  if (scope.kind === 'module') return `assets/modules/${target || '…'}/res/content/config/${filename}`;
  if (scope.kind === 'library') return `assets/libraries/${target || '…'}/res/content/config/${filename}`;
  if (scope.kind === 'content-pack') return `assets/content-packs/${target || '…'}/res/content/config/${filename}`;
  return filename;
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell', status: '#status', configScan: '#config-scan', configSource: '#config-source',
    configScopeKind: '#config-scope-kind', configScopeTarget: '#config-scope-target', configGenerateKeys: '#config-generate-keys',
    configDetails: '#config-details', configDetailsCount: '#config-details-count', sheetDetails: '#sheet-details', sheetList: '#sheet-list',
    configDeleteSource: '#config-delete-source', configSaveSource: '#config-save-source', configBuild: '#config-build', configCheck: '#config-check',
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
      if (!busy) {
        this.renderSheetDetails();
        this.updateFormState();
      }
    },

    setDirty(dirty) {
      this.isDirty = dirty;
      const state = dirty ? 'warning' : (this.hasSavedRules ? 'success' : 'info');
      const key = dirty ? 'config_state_dirty' : (this.hasSavedRules ? 'config_state_saved' : 'config_state_unconfigured');
      this.$.configDirtyState.dataset.state = state;
      this.$.configDirtyState.textContent = this.t(key);
      this.updateFormState();
    },

    markConfigDirty() {
      this.syncFileControlsFromDrafts();
      if (!this.isApplying) this.setDirty(true);
      this.updatePreview();
    },

    confirmDiscard() {
      return !this.isDirty || typeof window === 'undefined' || typeof window.confirm !== 'function'
        || window.confirm(this.t('config_discard_confirm'));
    },

    scopeTargets(kind) {
      const scopes = this.configDashboardValue?.scopes || {};
      if (kind === 'module') return scopes.modules || [];
      if (kind === 'library') return scopes.libraries || [];
      if (kind === 'content-pack') return (scopes.contentPacks || []).map((item) => `${item.owner}/${item.name}`);
      if (kind === 'global') return scopes.global === false ? [] : ['Global'];
      return [];
    },

    defaultScope() {
      for (const kind of ['module', 'library', 'content-pack', 'global']) {
        const targets = this.scopeTargets(kind);
        if (targets.length > 0) return scopeFrom(kind, targets[0]);
      }
      return { kind: 'module', name: '' };
    },

    updateOverview() {
      const dashboard = this.configDashboardValue || {};
      const scopes = dashboard.scopes || {};
      const targetCount = (scopes.modules || []).length + (scopes.libraries || []).length
        + (scopes.contentPacks || []).length + (scopes.global ? 1 : 0);
      this.$.configSourceCount.textContent = String((dashboard.sources || []).length);
      this.$.configRuleCount.textContent = String((dashboard.plan?.tables || []).length);
      this.$.configTargetCount.textContent = String(targetCount);
    },

    updateFileScopeTargets(preferredTarget) {
      const kind = this.$.configScopeKind.value;
      const targets = this.scopeTargets(kind);
      this.$.configScopeTarget.innerHTML = targets.length > 0
        ? targets.map((target) => `<option value="${shared.escapeHtml(target)}">${shared.escapeHtml(target)}</option>`).join('')
        : `<option value="">${shared.escapeHtml(this.t('config_no_target'))}</option>`;
      if (preferredTarget && targets.includes(preferredTarget)) this.$.configScopeTarget.value = preferredTarget;
    },

    selectSource(source) {
      const dashboard = this.configDashboardValue || {};
      const sourceInfo = (dashboard.sources || []).find((item) => item.source === source);
      const existing = (dashboard.plan?.tables || []).filter((table) => table.source === source);
      const existingBySheet = new Map(existing.map((table) => [table.sheet, table]));
      const missingRules = existing.filter((table) => !(sourceInfo?.sheets || []).includes(table.sheet));
      const fallbackScope = existing[0]?.scope || this.defaultScope();
      const fallbackGenerateKeys = existing.length > 0 ? existing[0].generateKeys !== false : true;
      this.isApplying = true;
      this.currentSource = source || '';
      this.sourceError = sourceInfo?.error || '';
      this.hasSavedRules = existing.length > 0;
      this.sheetDrafts = (sourceInfo?.sheets || []).map((sheet) => {
        const table = existingBySheet.get(sheet);
        return {
          id: table?.id,
          label: table?.label,
          sheet,
          table: table?.table || configDefaultTableKey(sheet),
          enabled: existing.length === 0 ? true : Boolean(table),
          scope: table?.scope || { ...fallbackScope },
          generateKeys: table ? table.generateKeys !== false : fallbackGenerateKeys,
        };
      });
      this.$.configScopeKind.value = fallbackScope.kind || 'module';
      this.updateFileScopeTargets(scopeTargetValue(fallbackScope));
      this.$.configGenerateKeys.checked = fallbackGenerateKeys;
      this.isApplying = false;
      this.syncFileControlsFromDrafts();
      const mixed = this.hasMixedSettings();
      this.setDetailsExpanded(mixed);
      this.setDirty(missingRules.length > 0);
      this.renderSheetDetails();
      this.updatePreview();
    },

    changeSource() {
      const nextSource = this.$.configSource.value;
      if (nextSource !== this.currentSource && !this.confirmDiscard()) {
        this.$.configSource.value = this.currentSource || '';
        return;
      }
      this.selectSource(nextSource);
    },

    hasMixedSettings() {
      const enabled = (this.sheetDrafts || []).filter((row) => row.enabled);
      if (enabled.length < 2) return false;
      const scopes = new Set(enabled.map((row) => scopeKey(row.scope)));
      const generateKeys = new Set(enabled.map((row) => row.generateKeys));
      return scopes.size > 1 || generateKeys.size > 1;
    },

    syncFileControlsFromDrafts() {
      const enabled = (this.sheetDrafts || []).filter((row) => row.enabled);
      if (enabled.length === 0) {
        this.$.configGenerateKeys.indeterminate = false;
        return;
      }
      const scopeKeys = new Set(enabled.map((row) => scopeKey(row.scope)));
      const generateKeys = new Set(enabled.map((row) => row.generateKeys));
      this.isApplying = true;
      if (scopeKeys.size === 1) {
        this.$.configScopeKind.value = enabled[0].scope.kind;
        this.updateFileScopeTargets(scopeTargetValue(enabled[0].scope));
      }
      this.$.configGenerateKeys.indeterminate = generateKeys.size > 1;
      if (generateKeys.size === 1) this.$.configGenerateKeys.checked = enabled[0].generateKeys;
      this.isApplying = false;
    },

    applyFileDefaults() {
      if (this.isApplying) return;
      this.$.configGenerateKeys.indeterminate = false;
      const scope = scopeFrom(this.$.configScopeKind.value, this.$.configScopeTarget.value);
      const generateKeys = this.$.configGenerateKeys.checked === true;
      for (const row of this.sheetDrafts || []) {
        if (!row.enabled) continue;
        row.scope = { ...scope };
        row.generateKeys = generateKeys;
      }
      this.markConfigDirty();
      this.renderSheetDetails();
    },

    setDetailsExpanded(expanded) {
      this.detailsExpanded = expanded;
      this.$.sheetDetails.classList.toggle('hidden', !expanded);
      this.$.sheetDetails.setAttribute('aria-hidden', String(!expanded));
      this.$.configDetails.setAttribute('aria-expanded', String(expanded));
    },

    toggleDetails() {
      this.setDetailsExpanded(!this.detailsExpanded);
    },

    targetOptions(kind, selected) {
      const targets = this.scopeTargets(kind);
      if (targets.length === 0) return `<option value="">${shared.escapeHtml(this.t('config_no_target'))}</option>`;
      return targets.map((target) => `<option value="${shared.escapeHtml(target)}"${target === selected ? ' selected' : ''}>${shared.escapeHtml(target)}</option>`).join('');
    },

    renderSheetDetails() {
      this.$.sheetList.innerHTML = '';
      const rows = this.sheetDrafts || [];
      for (const row of rows) {
        const item = document.createElement('article');
        item.className = 'sheet-row';
        item.dataset.enabled = String(row.enabled);
        item.innerHTML = `
          <label class="sheet-field sheet-enable check-label">
            <input data-sheet-enabled type="checkbox"${row.enabled ? ' checked' : ''} />
            <span class="sheet-name" title="${shared.escapeHtml(row.sheet)}">${shared.escapeHtml(row.sheet)}</span>
          </label>
          <label class="sheet-field">
            <span>${shared.escapeHtml(this.t('config_table'))}</span>
            <input data-sheet-table value="${shared.escapeHtml(row.table)}" />
          </label>
          <label class="sheet-field">
            <span>${shared.escapeHtml(this.t('config_scope_kind'))}</span>
            <select data-sheet-kind>
              ${['module', 'library', 'content-pack', 'global'].map((kind) => `<option value="${kind}"${row.scope.kind === kind ? ' selected' : ''}>${kind === 'content-pack' ? 'ContentPack' : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`}</option>`).join('')}
            </select>
          </label>
          <label class="sheet-field">
            <span>${shared.escapeHtml(this.t('config_scope_target'))}</span>
            <select data-sheet-target>${this.targetOptions(row.scope.kind, scopeTargetValue(row.scope))}</select>
          </label>
          <label class="sheet-field sheet-keys check-label" title="${shared.escapeHtml(this.t('config_generate_keys'))}">
            <input data-sheet-keys type="checkbox"${row.generateKeys ? ' checked' : ''} />
            <span>${shared.escapeHtml(this.t('config_keys_short'))}</span>
          </label>`;
        const enabled = item.querySelector('[data-sheet-enabled]');
        const table = item.querySelector('[data-sheet-table]');
        const kind = item.querySelector('[data-sheet-kind]');
        const target = item.querySelector('[data-sheet-target]');
        const keys = item.querySelector('[data-sheet-keys]');
        const syncDisabled = () => {
          for (const control of [table, kind, target, keys]) control.disabled = this.isBusy || !row.enabled;
          item.dataset.enabled = String(row.enabled);
        };
        enabled.disabled = this.isBusy;
        syncDisabled();
        enabled.addEventListener('change', () => {
          row.enabled = enabled.checked;
          if (row.enabled) {
            row.scope = scopeFrom(this.$.configScopeKind.value, this.$.configScopeTarget.value);
            row.generateKeys = this.$.configGenerateKeys.checked === true;
            keys.checked = row.generateKeys;
          }
          syncDisabled();
          this.markConfigDirty();
        });
        table.addEventListener('input', () => { row.table = table.value.trim(); this.markConfigDirty(); });
        kind.addEventListener('change', () => {
          const targets = this.scopeTargets(kind.value);
          row.scope = scopeFrom(kind.value, targets[0] || '');
          target.innerHTML = this.targetOptions(kind.value, scopeTargetValue(row.scope));
          this.markConfigDirty();
        });
        target.addEventListener('change', () => { row.scope = scopeFrom(kind.value, target.value); this.markConfigDirty(); });
        keys.addEventListener('change', () => { row.generateKeys = keys.checked; this.markConfigDirty(); });
        this.$.sheetList.appendChild(item);
      }
      if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = this.t('config_no_sheets');
        this.$.sheetList.appendChild(empty);
      }
    },

    updatePreview() {
      const source = this.currentSource || '';
      const enabled = (this.sheetDrafts || []).filter((row) => row.enabled);
      const mixed = this.hasMixedSettings();
      this.$.configDetailsCount.textContent = String(enabled.length);
      this.$.configPreviewSource.textContent = source || this.t('config_preview_empty');
      if (enabled.length === 1) {
        this.$.configPreviewPath.textContent = configOutputPath(enabled[0].scope, enabled[0].table);
      } else if (enabled.length > 1) {
        const targetLabel = mixed ? this.t('config_mixed_targets') : scopeLabel(enabled[0].scope);
        this.$.configPreviewPath.textContent = this.t('config_file_preview')
          .replace('{count}', String(enabled.length))
          .replace('{target}', targetLabel || '—');
      } else {
        this.$.configPreviewPath.textContent = this.t('config_no_enabled_sheets');
      }
      this.updateFormState();
    },

    validationMessage() {
      if (!this.currentSource) return this.t('config_source_required');
      if (this.sourceError) return this.sourceError;
      const enabled = (this.sheetDrafts || []).filter((row) => row.enabled);
      if (enabled.length === 0) return this.t('config_sheet_required');
      for (const row of enabled) {
        if (!row.table || !/^[a-z][A-Za-z0-9]*$/.test(row.table)) {
          return this.t('config_sheet_table_invalid').replace('{sheet}', row.sheet);
        }
        if (!scopeTargetValue(row.scope)) {
          return this.t('config_sheet_target_required').replace('{sheet}', row.sheet);
        }
      }
      return '';
    },

    updateFormState() {
      const validation = this.validationMessage();
      const needsSave = this.isDirty || !this.hasSavedRules;
      const message = validation || (this.isDirty ? this.t('config_unsaved_hint') : (this.hasSavedRules ? this.t('config_form_ready') : this.t('config_unconfigured_hint')));
      this.$.configFormHint.textContent = message;
      this.$.configFormHint.dataset.state = validation ? 'error' : 'info';
      this.$.configSaveSource.disabled = Boolean(this.isBusy || validation || !needsSave);
      this.$.configDeleteSource.disabled = Boolean(this.isBusy || !this.hasSavedRules);
      this.$.configCheck.disabled = Boolean(this.isBusy || this.isDirty || !this.hasSavedRules);
      this.$.configBuild.disabled = Boolean(this.isBusy || validation);
    },

    async refreshConfigDashboard(options = {}) {
      if (!options.keepBusy) this.setBusy(true, 'panel_status_refreshing');
      try {
        const dashboard = await this.call('config-dashboard');
        this.configDashboardValue = dashboard;
        this.updateOverview();
        const sources = dashboard.sources || [];
        const preferred = options.selectedSource ?? this.currentSource;
        this.$.configSource.innerHTML = sources.length > 0
          ? sources.map((item) => {
            const configured = (dashboard.plan?.tables || []).filter((table) => table.source === item.source).length;
            const state = item.error ? this.t('config_source_scan_failed') : `${configured}/${item.sheets.length}`;
            const label = `${sourceName(item.source)}  ·  ${state}`;
            return `<option value="${shared.escapeHtml(item.source)}">${shared.escapeHtml(label)}</option>`;
          }).join('')
          : `<option value="">${shared.escapeHtml(this.t('config_no_sources'))}</option>`;
        if (preferred && sources.some((item) => item.source === preferred)) this.$.configSource.value = preferred;
        this.selectSource(this.$.configSource.value);
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

    configSourcePayload() {
      return {
        source: this.currentSource,
        tables: (this.sheetDrafts || []).filter((row) => row.enabled).map((row) => ({
          id: row.id,
          label: row.label,
          sheet: row.sheet,
          table: row.table,
          scope: row.scope,
          generateKeys: row.generateKeys,
          format: 'json',
        })),
      };
    },

    async saveConfigSource() {
      if (this.validationMessage()) {
        this.updateFormState();
        return;
      }
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-save-source', this.configSourcePayload());
        this.setResult(result);
        if (result?.ok !== false) {
          await this.refreshConfigDashboard({ silentResult: true, keepBusy: true, selectedSource: this.currentSource });
        }
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async deleteConfigSource() {
      if (!this.hasSavedRules) return;
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(this.t('config_delete_source_confirm'))) return;
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-delete-source', { source: this.currentSource });
        this.setResult(result);
        if (result?.ok !== false) {
          await this.refreshConfigDashboard({ silentResult: true, keepBusy: true, selectedSource: this.currentSource });
        }
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async buildConfig() {
      if (this.validationMessage()) {
        this.updateFormState();
        return;
      }
      this.setBusy(true, 'panel_status_generating');
      try {
        if (this.isDirty || !this.hasSavedRules) {
          const saved = await this.call('config-save-source', this.configSourcePayload());
          if (saved?.ok === false) {
            this.setResult(saved);
            return;
          }
          await this.refreshConfigDashboard({ silentResult: true, keepBusy: true, selectedSource: this.currentSource });
        }
        this.setResult(await this.call('config-build'));
      }
      catch (error) { this.setResult(shared.errorResult(error)); }
      finally { this.setBusy(false); }
    },

    async checkConfig() {
      this.setBusy(true, 'panel_status_validating');
      try { this.setResult(await this.call('config-check')); }
      catch (error) { this.setResult(shared.errorResult(error)); }
      finally { this.setBusy(false); }
    },
  },
  ready() {
    shared.initialize(this);
    this.isBusy = false;
    this.isDirty = false;
    this.isApplying = false;
    this.hasSavedRules = false;
    this.currentSource = '';
    this.sourceError = '';
    this.sheetDrafts = [];
    this.detailsExpanded = false;
    this.$.configScan.addEventListener('click', () => this.scanConfigSources());
    this.$.configSource.addEventListener('change', () => this.changeSource());
    this.$.configScopeKind.addEventListener('change', () => {
      this.updateFileScopeTargets();
      this.applyFileDefaults();
    });
    this.$.configScopeTarget.addEventListener('change', () => this.applyFileDefaults());
    this.$.configGenerateKeys.addEventListener('change', () => this.applyFileDefaults());
    this.$.configDetails.addEventListener('click', () => this.toggleDetails());
    this.$.configSaveSource.addEventListener('click', () => this.saveConfigSource());
    this.$.configDeleteSource.addEventListener('click', () => this.deleteConfigSource());
    this.$.configBuild.addEventListener('click', () => this.buildConfig());
    this.$.configCheck.addEventListener('click', () => this.checkConfig());
    this.$.shell.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!this.$.configSaveSource.disabled) void this.saveConfigSource();
      }
    });
    this.refreshConfigDashboard({ silentResult: true });
  },
  beforeClose() {},
  close() {},
});
