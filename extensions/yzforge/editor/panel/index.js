'use strict';

const shared = require('./shared');

const template = `
<section class="shell dashboard-shell" data-state="ready">
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-mark">YZ</div>
      <div class="title-stack">
        <div class="eyebrow" data-i18n="panel_product_label">PROJECT GOVERNANCE</div>
        <h1 data-i18n="dashboard_panel_title">YZForge Dashboard</h1>
        <p class="status-line"><span class="status-dot"></span><span id="status" data-i18n="panel_status_ready">Ready</span></p>
      </div>
    </div>
    <div class="topbar-actions">
      <button id="open-create" data-i18n="open_create_panel">Create</button>
      <button id="open-config" data-i18n="open_config_panel">Config</button>
      <button id="refresh" class="icon-button" data-i18n-title="panel_refresh_title" title="Refresh">↻</button>
    </div>
  </header>

  <section class="section summary">
    <div class="section-heading">
      <div>
        <div class="section-title" data-i18n="panel_project">Project</div>
        <div class="section-description" data-i18n="panel_project_desc">Current project topology</div>
      </div>
      <span class="section-meta" data-i18n="panel_live_snapshot">Live snapshot</span>
    </div>
    <div class="summary-grid">
      <div class="metric metric-module"><strong id="module-count">0</strong><span data-i18n="panel_modules">Modules</span></div>
      <div class="metric metric-library"><strong id="library-count">0</strong><span data-i18n="panel_libraries">Libraries</span></div>
      <div class="metric metric-pack"><strong id="pack-count">0</strong><span data-i18n="panel_packs">Packs</span></div>
    </div>
    <div id="module-list" class="entity-list"></div>
  </section>

  <section class="section tools">
    <div class="section-heading">
      <div>
        <div class="section-title" data-i18n="panel_workbench">Workbench</div>
        <div class="section-description" data-i18n="panel_workbench_desc">Common project maintenance actions</div>
      </div>
    </div>
    <div class="command-grid">
      <article class="command-card">
        <div class="command-card-head"><span class="command-glyph">G</span><div><strong data-i18n="workbench_generate">Generate</strong><p data-i18n="workbench_generate_desc">Refresh derived files</p></div></div>
        <div class="tool-row">
          <button id="generate" class="command-primary" data-i18n="generate_all">Generate All</button>
          <button id="generate-check" data-i18n="generate_check">Generate Check</button>
        </div>
      </article>

      <article class="command-card">
        <div class="command-card-head"><span class="command-glyph">V</span><div><strong data-i18n="workbench_validate">Validate</strong><p data-i18n="workbench_validate_desc">Inspect architecture health</p></div></div>
        <button id="project-check" class="full-button command-primary" data-i18n="project_check" data-i18n-title="project_check_desc">Preflight Check</button>
        <div class="tool-row">
          <button id="validate" data-i18n="validate_architecture">Validate</button>
          <button id="validate-strict" class="command-primary" data-i18n="validate_architecture_strict">Validate Strict</button>
        </div>
        <div class="tool-row compact-tools">
          <button id="diagnostics" data-i18n="panel_diagnostics">Diagnostics</button>
          <button id="smoke-test" data-i18n="smoke_test">Smoke Test</button>
        </div>
      </article>

      <article class="command-card">
        <div class="command-card-head"><span class="command-glyph">F</span><div><strong data-i18n="workbench_framework">Framework</strong><p data-i18n="workbench_framework_desc">Version and runtime evidence</p></div></div>
        <div class="tool-row">
          <button id="upgrade-check" data-i18n="upgrade_check">Upgrade Check</button>
          <button id="upgrade" data-i18n="upgrade_framework">Upgrade</button>
        </div>
        <button id="runtime-snapshot" class="full-button" data-i18n="runtime_snapshot">Runtime Snapshot</button>
      </article>

      <article class="command-card danger-card">
        <div class="command-card-head"><span class="command-glyph danger-glyph">C</span><div><strong data-i18n="workbench_clean">Clean</strong><p data-i18n="workbench_clean_desc">Preview before removing output</p></div></div>
        <div class="tool-row">
          <button id="clean-preview" data-i18n="clean_preview">Clean Preview</button>
          <button id="clean" class="danger" data-i18n="clean_generated" data-i18n-title="clean_generated_title">Safe Clean</button>
        </div>
        <label class="clean-toggle" data-i18n-title="clean_scripts_title">
          <input id="clean-scripts" type="checkbox" />
          <span data-i18n="clean_scripts">Include generated TS</span>
        </label>
      </article>
    </div>
  </section>

  <section class="section result">
    <div class="section-heading">
      <div>
        <div class="section-title" data-i18n="panel_result">Result</div>
        <div class="section-description" data-result-summary data-i18n="panel_result_empty_summary">Run an action to inspect its result</div>
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

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.metric {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 10px 11px;
  overflow: hidden;
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius);
  background: var(--color-normal-fill);
}

.metric::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  content: '';
  background: var(--color-primary-fill);
}

.metric-library::before { opacity: 0.68; }
.metric-pack::before { opacity: 0.42; }

.metric strong {
  font-size: 21px;
  font-weight: 650;
  line-height: 1;
}

.metric span {
  color: var(--color-normal-contrast-weaker);
  font-size: 11px;
}

.entity-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
}

.command-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.command-card {
  display: grid;
  align-content: start;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius);
  background: var(--color-normal-fill);
}

.command-card-head {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.command-card-head > div {
  min-width: 0;
}

.command-card-head strong {
  font-size: 13px;
}

.command-card-head p {
  font-size: 11px;
  line-height: 1.35;
}

.command-glyph {
  display: grid;
  width: 25px;
  height: 25px;
  flex: 0 0 25px;
  place-items: center;
  color: var(--color-primary-contrast);
  border: 1px solid var(--color-primary-border);
  border-radius: 7px;
  background: var(--color-primary-fill);
  font-size: 11px;
  font-weight: 750;
}

.danger-card {
  border-color: var(--color-danger-border, var(--color-normal-border));
}

.danger-glyph {
  color: var(--color-danger-contrast, #ff969e);
  border-color: var(--color-danger-border, #873d45);
  background: transparent;
}

.compact-tools button,
.full-button {
  min-height: 32px;
  font-size: 13px;
}

.full-button {
  width: 100%;
}

.clean-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-normal-contrast-weaker);
  cursor: pointer;
  font-size: 12px;
}

@media (max-width: 560px) {
  .command-grid { grid-template-columns: 1fr; }
}

@media (max-width: 400px) {
  .summary-grid { grid-template-columns: 1fr; }
  .topbar { flex-direction: column; }
  .topbar-actions { width: 100%; }
  .topbar-actions button:not(.icon-button) { flex: 1; }
}
`;

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell',
    status: '#status',
    refresh: '#refresh',
    openCreate: '#open-create',
    openConfig: '#open-config',
    generate: '#generate',
    projectCheck: '#project-check',
    upgrade: '#upgrade',
    upgradeCheck: '#upgrade-check',
    clean: '#clean',
    validate: '#validate',
    validateStrict: '#validate-strict',
    diagnostics: '#diagnostics',
    smokeTest: '#smoke-test',
    runtimeSnapshot: '#runtime-snapshot',
    generateCheck: '#generate-check',
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
      return shared.t(this, key);
    },

    setBusy(busy, label) {
      if (busy || this.$.shell.dataset.state === 'busy') {
        shared.setStatus(this, label || (busy ? 'panel_status_working' : 'panel_status_ready'), busy ? 'busy' : 'ready');
      }
      this.$.shell.setAttribute('aria-busy', String(busy));
      for (const button of this.$.shell.querySelectorAll('button')) button.disabled = busy;
      this.$.cleanScripts.disabled = busy;
    },

    cleanOptions() {
      return { includeScripts: this.$.cleanScripts.checked === true };
    },

    setResult(value) {
      shared.setResult(this, value);
    },

    async call(message, payload) {
      return await shared.call(message, payload);
    },

    renderModules(modules) {
      this.$.moduleList.innerHTML = modules.length > 0
        ? modules.map((item) => `<span class="tag">${shared.escapeHtml(item.name)}</span>`).join('')
        : `<span class="form-hint">${shared.escapeHtml(this.t('panel_no_modules'))}</span>`;
    },

    async refreshSummary(options = {}) {
      this.setBusy(true, 'panel_status_refreshing');
      try {
        const summary = await this.call('get-project-summary');
        const modules = summary.modules || [];
        this.$.moduleCount.textContent = String(modules.length);
        this.$.libraryCount.textContent = String((summary.libraries || []).length);
        this.$.packCount.textContent = String((summary.contentPacks || []).length);
        this.renderModules(modules);
        if (!options.silentResult) this.setResult(summary);
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async runCommand(message, statusKey, options = {}) {
      this.setBusy(true, statusKey);
      try {
        const result = await this.call(message, options.payload);
        this.setResult(result);
        if (options.refresh && result?.ok !== false) await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult(shared.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async cleanGenerated() {
      const includeScripts = this.$.cleanScripts.checked === true;
      if (includeScripts && typeof window !== 'undefined' && typeof window.confirm === 'function'
        && !window.confirm(this.t('clean_scripts_confirm'))) return;
      await this.runCommand('clean-generated', 'panel_status_cleaning', {
        payload: { dryRun: false, ...this.cleanOptions() },
        refresh: true,
      });
    },
  },
  ready() {
    shared.initialize(this);
    this.$.refresh.addEventListener('click', () => this.refreshSummary());
    this.$.openCreate.addEventListener('click', () => this.call('open-create-panel').catch((error) => this.setResult(shared.errorResult(error))));
    this.$.openConfig.addEventListener('click', () => this.call('open-config-panel').catch((error) => this.setResult(shared.errorResult(error))));
    this.$.generate.addEventListener('click', () => this.runCommand('generate-all', 'panel_status_generating', { refresh: true }));
    this.$.generateCheck.addEventListener('click', () => this.runCommand('generate-check', 'panel_status_validating'));
    this.$.projectCheck.addEventListener('click', () => this.runCommand('project-check', 'panel_status_checking'));
    this.$.upgrade.addEventListener('click', () => this.runCommand('upgrade-framework', 'panel_status_upgrading', { refresh: true }));
    this.$.upgradeCheck.addEventListener('click', () => this.runCommand('upgrade-check', 'panel_status_upgrading'));
    this.$.clean.addEventListener('click', () => this.cleanGenerated());
    this.$.cleanPreview.addEventListener('click', () => this.runCommand('clean-generated-preview', 'panel_status_cleaning', { payload: this.cleanOptions() }));
    this.$.validate.addEventListener('click', () => this.runCommand('validate-architecture', 'panel_status_validating'));
    this.$.validateStrict.addEventListener('click', () => this.runCommand('validate-architecture-strict', 'panel_status_validating'));
    this.$.diagnostics.addEventListener('click', () => this.runCommand('project-diagnostics', 'panel_status_diagnosing'));
    this.$.runtimeSnapshot.addEventListener('click', () => this.runCommand('runtime-snapshot', 'panel_status_diagnosing'));
    this.$.smokeTest.addEventListener('click', () => this.runCommand('smoke-test', 'panel_status_smoking'));
    this.refreshSummary({ silentResult: true });
  },
  beforeClose() {},
  close() {},
});
