'use strict';

const shared = require('./shared');

const template = `
<section class="shell dashboard-shell">
  <header class="topbar">
    <div>
      <h1 data-i18n="dashboard_panel_title">YZForge Dashboard</h1>
      <p id="status" data-i18n="panel_status_ready">Ready</p>
    </div>
    <button id="refresh" data-i18n="panel_refresh" data-i18n-title="panel_refresh_title" title="Refresh project summary">Refresh</button>
  </header>

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
        <div class="command-title" data-i18n="workbench_framework">Framework</div>
        <div class="tool-row">
          <button id="upgrade-check" data-i18n="upgrade_check" data-i18n-title="upgrade_framework_title">Upgrade Check</button>
          <button id="upgrade" class="command-primary" data-i18n="upgrade_framework" data-i18n-title="upgrade_framework_title">Upgrade Framework</button>
        </div>
      </div>
      <div class="command-group">
        <div class="command-title" data-i18n="workbench_validate">Validate</div>
        <div class="tool-row wide-tools">
          <button id="validate" data-i18n="validate_architecture">Validate</button>
          <button id="validate-strict" data-i18n="validate_architecture_strict">Validate Strict</button>
          <button id="diagnostics" data-i18n="panel_diagnostics">Diagnostics</button>
          <button id="runtime-snapshot" data-i18n="runtime_snapshot">Runtime Snapshot</button>
          <button id="smoke-test" data-i18n="smoke_test">Smoke Test</button>
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
${shared.baseStyle}

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

.wide-tools {
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
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
`;

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
    shell: '.shell',
    status: '#status',
    refresh: '#refresh',
    generate: '#generate',
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
      const key = label || (busy ? 'panel_status_working' : 'panel_status_ready');
      this.$.status.textContent = this.t(key);
      for (const button of [
        this.$.refresh,
        this.$.generate,
        this.$.upgrade,
        this.$.upgradeCheck,
        this.$.clean,
        this.$.validate,
        this.$.validateStrict,
        this.$.diagnostics,
        this.$.smokeTest,
        this.$.runtimeSnapshot,
        this.$.generateCheck,
        this.$.cleanPreview,
      ]) {
        button.disabled = busy;
      }
      this.$.cleanScripts.disabled = busy;
    },

    cleanOptions() {
      return {
        includeScripts: this.$.cleanScripts.checked === true,
      };
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

    async refreshSummary(options = {}) {
      this.setBusy(true, 'panel_status_refreshing');
      try {
        const summary = await this.call('get-project-summary');
        const modules = summary.modules || [];
        this.$.moduleCount.textContent = String(modules.length);
        this.$.libraryCount.textContent = String((summary.libraries || []).length);
        this.$.packCount.textContent = String((summary.contentPacks || []).length);
        this.$.moduleList.textContent = modules.map((item) => item.name).join(', ') || this.t('panel_no_modules');
        if (!options.silentResult) {
          this.setResult(summary);
        }
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

    async upgradeFramework() {
      this.setBusy(true, 'panel_status_upgrading');
      try {
        this.setResult(await this.call('upgrade-framework'));
        await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult(this.errorResult(error));
      } finally {
        this.setBusy(false);
      }
    },

    async upgradeCheck() {
      this.setBusy(true, 'panel_status_upgrading');
      try {
        this.setResult(await this.call('upgrade-check'));
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
  },
  ready() {
    shared.translate(this);
    this.$.refresh.addEventListener('click', () => this.refreshSummary());
    this.$.generate.addEventListener('click', () => this.generateAll());
    this.$.generateCheck.addEventListener('click', () => this.generateCheck());
    this.$.upgrade.addEventListener('click', () => this.upgradeFramework());
    this.$.upgradeCheck.addEventListener('click', () => this.upgradeCheck());
    this.$.clean.addEventListener('click', () => this.cleanGenerated());
    this.$.cleanPreview.addEventListener('click', () => this.cleanPreview());
    this.$.validate.addEventListener('click', () => this.validateProject());
    this.$.validateStrict.addEventListener('click', () => this.validateProjectStrict());
    this.$.diagnostics.addEventListener('click', () => this.runDiagnostics());
    this.$.runtimeSnapshot.addEventListener('click', () => this.runtimeSnapshot());
    this.$.smokeTest.addEventListener('click', () => this.smokeTest());
    this.refreshSummary();
  },
  beforeClose() {},
  close() {},
});
