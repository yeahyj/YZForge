'use strict';

const template = `
<section class="shell">
  <header class="topbar">
    <div>
      <h1>YZForge</h1>
      <p id="status">Ready</p>
    </div>
    <button id="refresh" class="icon-button" title="Refresh project summary">Refresh</button>
  </header>

  <section class="section">
    <div class="section-title">Create</div>
    <div class="form-grid">
      <label>
        <span>Kind</span>
        <select id="kind">
          <option value="module">Module</option>
          <option value="library">Library</option>
          <option value="content-pack">ContentPack</option>
          <option value="view">Module View</option>
          <option value="part">Part</option>
          <option value="model">Model</option>
          <option value="service">Service</option>
          <option value="flow">Flow</option>
        </select>
      </label>
      <label>
        <span>Name</span>
        <input id="name" placeholder="PascalCase" />
      </label>
      <label id="owner-row">
        <span>Owner</span>
        <select id="owner"></select>
      </label>
    </div>
    <div id="prefab-row" class="options-row">
      <label><input id="prefab" type="checkbox" checked /> Prefab</label>
      <label><input id="overwrite" type="checkbox" /> Overwrite</label>
    </div>
    <button id="create" class="primary">Create</button>
  </section>

  <section class="section action-row">
    <button id="generate">Generate All</button>
    <button id="validate">Validate</button>
  </section>

  <section class="section summary">
    <div class="section-title">Project</div>
    <div class="summary-grid">
      <div><strong id="module-count">0</strong><span>Modules</span></div>
      <div><strong id="library-count">0</strong><span>Libraries</span></div>
      <div><strong id="pack-count">0</strong><span>Packs</span></div>
    </div>
    <div id="module-list" class="list"></div>
  </section>

  <section class="section result">
    <div class="section-title">Result</div>
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
  grid-template-columns: 1fr 1fr;
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
    part: 'create-part',
    model: 'create-model',
    service: 'create-service',
    flow: 'create-flow',
  }[kind];
}

module.exports = Editor.Panel.define({
  template,
  style,
  $: {
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
    validate: '#validate',
    moduleCount: '#module-count',
    libraryCount: '#library-count',
    packCount: '#pack-count',
    moduleList: '#module-list',
    result: '#result',
  },
  methods: {
    setBusy(busy, label) {
      this.$.status.textContent = label || (busy ? 'Working' : 'Ready');
      for (const button of [this.$.refresh, this.$.create, this.$.generate, this.$.validate]) {
        button.disabled = busy;
      }
    },

    setResult(value) {
      this.$.result.textContent = typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2);
    },

    async call(message, payload) {
      return await Editor.Message.request('yzforge', message, payload);
    },

    updateVisibility() {
      const kind = this.$.kind.value;
      const needsOwner = !['module', 'library'].includes(kind);
      const needsPrefab = ['view', 'part'].includes(kind);
      this.$.ownerRow.classList.toggle('hidden', !needsOwner);
      this.$.prefabRow.classList.toggle('hidden', !needsPrefab);
    },

    async refreshSummary(options = {}) {
      this.setBusy(true, 'Refreshing');
      try {
        const summary = await this.call('get-project-summary');
        const modules = summary.modules || [];
        this.$.moduleCount.textContent = String(modules.length);
        this.$.libraryCount.textContent = String((summary.libraries || []).length);
        this.$.packCount.textContent = String((summary.contentPacks || []).length);
        this.$.moduleList.textContent = modules.map((item) => item.name).join(', ') || 'No modules';
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
      this.setBusy(true, `Creating ${kind}`);
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
      this.setBusy(true, 'Generating');
      try {
        this.setResult(await this.call('generate-all'));
        await this.refreshSummary({ silentResult: true });
      } catch (error) {
        this.setResult({ ok: false, error: error.message });
      } finally {
        this.setBusy(false);
      }
    },

    async validateProject() {
      this.setBusy(true, 'Validating');
      try {
        this.setResult(await this.call('validate-architecture'));
      } catch (error) {
        this.setResult({ ok: false, error: error.message });
      } finally {
        this.setBusy(false);
      }
    },
  },
  ready() {
    this.$.kind.addEventListener('change', () => this.updateVisibility());
    this.$.refresh.addEventListener('click', () => this.refreshSummary());
    this.$.create.addEventListener('click', () => this.createItem());
    this.$.generate.addEventListener('click', () => this.generateAll());
    this.$.validate.addEventListener('click', () => this.validateProject());
    this.updateVisibility();
    this.refreshSummary();
  },
  beforeClose() {},
  close() {},
});
