'use strict';

const shared = require('./shared');

const template = `
<section class="shell config-shell">
  <header class="topbar">
    <div>
      <h1 data-i18n="config_panel_title">YZForge Config Tables</h1>
      <p id="status" data-i18n="panel_status_ready">Ready</p>
    </div>
    <button id="config-scan" data-i18n="config_scan">Scan Excel</button>
  </header>

  <section class="section">
    <div class="section-title" data-i18n="config_saved_table">Saved Rule</div>
    <div class="saved-rule-row">
      <select id="config-plan-table"></select>
      <button id="config-delete-table" data-i18n="config_delete_table">Delete Rule</button>
    </div>
    <label class="rule-name-row">
      <span data-i18n="config_rule_name">Rule Name</span>
      <input id="config-rule-label" placeholder="Start Items" />
    </label>
  </section>

  <section class="section">
    <div class="section-title" data-i18n="config_source">Source</div>
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
    </div>
  </section>

  <section class="section">
    <div class="section-title" data-i18n="config_output">Output</div>
    <div class="form-grid">
      <label>
        <span data-i18n="config_table">Table Key</span>
        <input id="config-table" placeholder="startItems" />
      </label>
    </div>
    <div class="config-footer">
      <div class="options-row">
        <label><input id="config-generate-keys" type="checkbox" checked /> <span data-i18n="config_generate_keys">Generate ID constants</span></label>
      </div>
      <div class="tool-row config-actions">
        <button id="config-save-table" class="command-primary" data-i18n="config_save_table">Save Table</button>
        <button id="config-build" class="command-primary" data-i18n="config_build">Build Config</button>
        <button id="config-check" data-i18n="config_check">Config Check</button>
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
${shared.baseStyle}

.saved-rule-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.rule-name-row {
  margin-top: 8px;
}

.config-footer {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.config-actions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 420px) {
  .saved-rule-row,
  .config-actions {
    grid-template-columns: 1fr;
  }
}
`;

function configScopeTargetValue(scope = {}) {
  if (scope.kind === 'content-pack') {
    return `${scope.owner || ''}/${scope.name || ''}`;
  }
  if (scope.kind === 'global') {
    return 'Global';
  }
  return scope.name || '';
}

function configDefaultTableKey(value) {
  const words = String(value || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  const [first, ...rest] = words;
  return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')}`;
}

function configPlanLabel(table) {
  if (table.label) {
    return table.label;
  }
  const scope = table.scope || {};
  const target = configScopeTargetValue(scope);
  return [
    scope.kind || 'unknown',
    target && target !== 'Global' ? target : undefined,
    table.table || table.sheet,
    table.source,
    table.sheet,
  ].filter(Boolean).join(' / ');
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell',
    status: '#status',
    configPlanTable: '#config-plan-table',
    configRuleLabel: '#config-rule-label',
    configSource: '#config-source',
    configSheet: '#config-sheet',
    configScopeKind: '#config-scope-kind',
    configScopeTarget: '#config-scope-target',
    configTable: '#config-table',
    configGenerateKeys: '#config-generate-keys',
    configScan: '#config-scan',
    configSaveTable: '#config-save-table',
    configDeleteTable: '#config-delete-table',
    configBuild: '#config-build',
    configCheck: '#config-check',
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
      for (const button of [
        this.$.configScan,
        this.$.configSaveTable,
        this.$.configDeleteTable,
        this.$.configBuild,
        this.$.configCheck,
      ]) {
        button.disabled = busy;
      }
      this.$.configPlanTable.disabled = busy;
      this.$.configRuleLabel.disabled = busy;
      this.$.configGenerateKeys.disabled = busy;
      if (!busy) {
        this.$.configDeleteTable.disabled = !this.$.configPlanTable.value;
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

    updateConfigSourceSheets() {
      const dashboard = this.configDashboardValue || {};
      const source = (dashboard.sources || []).find((item) => item.source === this.$.configSource.value);
      const sheets = source && Array.isArray(source.sheets) ? source.sheets : [];
      this.$.configSheet.innerHTML = sheets.length > 0
        ? sheets.map((sheet) => `<option value="${shared.escapeHtml(sheet)}">${shared.escapeHtml(sheet)}</option>`).join('')
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
        ? targets.map((target) => `<option value="${shared.escapeHtml(target)}">${shared.escapeHtml(target)}</option>`).join('')
        : '<option value="">No target</option>';
    },

    updateConfigPlanTables(selectedId) {
      const dashboard = this.configDashboardValue || {};
      const tables = (dashboard.plan && Array.isArray(dashboard.plan.tables)) ? dashboard.plan.tables : [];
      const selected = selectedId !== undefined ? selectedId : this.$.configPlanTable.value;
      this.$.configPlanTable.innerHTML = [
        `<option value="">${shared.escapeHtml(this.t('config_new_table'))}</option>`,
        ...tables.map((table) => `<option value="${shared.escapeHtml(table.id || '')}">${shared.escapeHtml(configPlanLabel(table))}</option>`),
      ].join('');
      if (selected && tables.some((table) => table.id === selected)) {
        this.$.configPlanTable.value = selected;
      }
      this.$.configDeleteTable.disabled = !this.$.configPlanTable.value;
    },

    selectedConfigPlanTable() {
      const dashboard = this.configDashboardValue || {};
      const tables = (dashboard.plan && Array.isArray(dashboard.plan.tables)) ? dashboard.plan.tables : [];
      const id = this.$.configPlanTable.value;
      return id ? tables.find((table) => table.id === id) : undefined;
    },

    applyConfigPlanTable() {
      const table = this.selectedConfigPlanTable();
      this.$.configDeleteTable.disabled = !table;
      if (!table) {
        return;
      }
      this.$.configRuleLabel.value = table.label || '';
      this.$.configSource.value = table.source || '';
      this.updateConfigSourceSheets();
      this.$.configSheet.value = table.sheet || '';
      this.$.configScopeKind.value = table.scope?.kind || 'module';
      this.updateConfigScopeTargets();
      this.$.configScopeTarget.value = configScopeTargetValue(table.scope);
      this.$.configTable.value = table.table || '';
      this.$.configGenerateKeys.checked = table.generateKeys !== false;
    },

    applyConfigDefaults() {
      const sheet = this.$.configSheet.value;
      if (!this.$.configTable.value && sheet) {
        this.$.configTable.value = configDefaultTableKey(sheet);
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
          ? dashboard.sources.map((item) => `<option value="${shared.escapeHtml(item.source)}">${shared.escapeHtml(item.source)}</option>`).join('')
          : '<option value="">config-source/excel is empty</option>';
        if (selectedSource && (dashboard.sources || []).some((item) => item.source === selectedSource)) {
          this.$.configSource.value = selectedSource;
        }
        this.updateConfigSourceSheets();
        this.updateConfigScopeTargets();
        this.updateConfigPlanTables();
        this.applyConfigPlanTable();
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
      const payload = {
        label: this.$.configRuleLabel.value,
        source: this.$.configSource.value,
        sheet: this.$.configSheet.value,
        table: this.$.configTable.value,
        generateKeys: this.$.configGenerateKeys.checked === true,
        scope,
      };
      if (this.$.configPlanTable.value) {
        payload.id = this.$.configPlanTable.value;
      }
      return payload;
    },

    async saveConfigTable() {
      this.applyConfigDefaults();
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-save-table', this.configTablePayload());
        this.setResult(result);
        await this.refreshConfigDashboard({ silentResult: true, keepBusy: true });
        if (result.table?.id) {
          this.updateConfigPlanTables(result.table.id);
          this.applyConfigPlanTable();
        }
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async deleteConfigTable() {
      const table = this.selectedConfigPlanTable();
      if (!table) {
        return;
      }
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(this.t('config_delete_confirm'))) {
        return;
      }
      this.setBusy(true, 'panel_status_generating');
      try {
        const result = await this.call('config-delete-table', { id: table.id });
        this.setResult(result);
        this.$.configPlanTable.value = '';
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
  },
  ready() {
    shared.translate(this);
    this.$.configScan.addEventListener('click', () => this.refreshConfigDashboard());
    this.$.configPlanTable.addEventListener('change', () => this.applyConfigPlanTable());
    this.$.configSource.addEventListener('change', () => this.updateConfigSourceSheets());
    this.$.configSheet.addEventListener('change', () => this.applyConfigDefaults());
    this.$.configScopeKind.addEventListener('change', () => this.updateConfigScopeTargets());
    this.$.configSaveTable.addEventListener('click', () => this.saveConfigTable());
    this.$.configDeleteTable.addEventListener('click', () => this.deleteConfigTable());
    this.$.configBuild.addEventListener('click', () => this.buildConfig());
    this.$.configCheck.addEventListener('click', () => this.checkConfig());
    this.refreshConfigDashboard({ silentResult: true });
  },
  beforeClose() {},
  close() {},
});
