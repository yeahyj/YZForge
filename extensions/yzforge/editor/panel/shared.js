'use strict';

const en = require('../../i18n/en');
const zh = require('../../i18n/zh');

const baseStyle = `
:host {
  --yz-radius-sm: 5px;
  --yz-radius: 8px;
  --yz-radius-lg: 11px;
  --yz-space: 12px;
  color: var(--color-normal-contrast);
  font: 12px/1.5 var(--font-normal);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--yz-space);
  min-width: 0;
  height: 100%;
  padding: 14px;
  overflow: auto;
  background: var(--color-normal-fill);
}

.shell::before {
  position: fixed;
  z-index: 20;
  top: 0;
  right: 0;
  left: 0;
  height: 2px;
  content: '';
  background: linear-gradient(90deg, transparent, var(--color-primary-fill), transparent);
  pointer-events: none;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 46px;
  padding: 0 2px 11px;
  border-bottom: 1px solid var(--color-normal-border);
}

.brand-lockup {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.brand-mark {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--color-primary-contrast);
  border: 1px solid var(--color-primary-border);
  border-radius: 9px;
  background: var(--color-primary-fill);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.16);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: -0.4px;
}

.title-stack {
  min-width: 0;
}

.eyebrow {
  margin-bottom: 1px;
  color: var(--color-primary-contrast);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.1px;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.2px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

p {
  margin: 2px 0 0;
  color: var(--color-normal-contrast-weaker);
}

.status-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.status-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: var(--color-success-fill, #4caf78);
  box-shadow: 0 0 0 3px rgba(76, 175, 120, 0.1);
}

.shell[data-state='busy'] .status-dot {
  background: var(--color-primary-fill);
  animation: yz-pulse 1.15s ease-in-out infinite;
}

.shell[data-state='error'] .status-dot {
  background: var(--color-danger-fill, #d85d68);
}

@keyframes yz-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.section {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius-lg);
  background: var(--color-normal-fill-emphasis);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.08);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title {
  color: var(--color-normal-contrast);
  font-size: 12px;
  font-weight: 650;
}

.section-description {
  margin-top: 2px;
  color: var(--color-normal-contrast-weaker);
  font-size: 10px;
}

.section-meta,
.state-pill,
.tag {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 1px 7px;
  color: var(--color-normal-contrast-weaker);
  border: 1px solid var(--color-normal-border);
  border-radius: 999px;
  background: var(--color-normal-fill);
  font-size: 10px;
  white-space: nowrap;
}

.state-pill[data-state='success'] {
  color: var(--color-success-contrast, #79d69e);
  border-color: var(--color-success-border, #397553);
}

.state-pill[data-state='error'] {
  color: var(--color-danger-contrast, #ff969e);
  border-color: var(--color-danger-border, #873d45);
}

.state-pill[data-state='warning'] {
  color: var(--color-warn-contrast, #e9bd65);
  border-color: var(--color-warn-border, #806631);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-height: 0;
}

label,
.field {
  display: grid;
  min-width: 0;
  gap: 5px;
}

label > span,
.field-label {
  color: var(--color-normal-contrast-weaker);
  font-size: 10px;
  font-weight: 550;
}

.field-hint,
.form-hint {
  color: var(--color-normal-contrast-weaker);
  font-size: 10px;
}

.form-hint[data-state='error'] {
  color: var(--color-danger-contrast, #ff969e);
}

input,
select {
  width: 100%;
  min-height: 31px;
  padding: 5px 9px;
  color: var(--color-normal-contrast);
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius-sm);
  outline: none;
  background: var(--color-normal-fill);
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

input:hover,
select:hover {
  border-color: var(--color-normal-border-emphasis, var(--color-primary-border));
}

input:focus,
select:focus {
  border-color: var(--color-primary-border);
  box-shadow: 0 0 0 2px rgba(65, 128, 255, 0.14);
  background: var(--color-normal-fill-emphasis);
}

input:disabled,
select:disabled {
  opacity: 0.58;
}

input[type='checkbox'] {
  width: 14px;
  min-height: 14px;
  margin: 0;
  padding: 0;
  accent-color: var(--color-primary-fill);
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 30px;
  padding: 5px 10px;
  color: var(--color-normal-contrast);
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius-sm);
  outline: none;
  background: var(--color-normal-fill-hover);
  cursor: pointer;
  font: inherit;
  font-weight: 550;
  transition: transform 100ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}

button:hover:not(:disabled) {
  border-color: var(--color-normal-border-emphasis, var(--color-primary-border));
  background: var(--color-normal-fill-important);
}

button:active:not(:disabled) {
  transform: translateY(1px);
}

button:focus-visible {
  border-color: var(--color-primary-border);
  box-shadow: 0 0 0 2px rgba(65, 128, 255, 0.16);
}

button:disabled {
  cursor: default;
  opacity: 0.48;
}

.primary,
.command-primary {
  color: var(--color-primary-contrast);
  border-color: var(--color-primary-border);
  background: var(--color-primary-fill);
}

.primary:hover:not(:disabled),
.command-primary:hover:not(:disabled) {
  background: var(--color-primary-fill-emphasis, var(--color-primary-fill));
  box-shadow: 0 4px 12px rgba(35, 96, 210, 0.2);
}

.danger {
  color: var(--color-danger-contrast, #ff969e);
  border-color: var(--color-danger-border, #873d45);
  background: transparent;
}

.icon-button {
  width: 31px;
  flex: 0 0 31px;
  padding: 0;
  font-size: 15px;
}

.tool-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.options-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-height: 28px;
  gap: 14px;
}

.options-row label,
.check-label {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}

.preview-card {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius);
  background: var(--color-normal-fill);
}

.preview-kicker {
  color: var(--color-normal-contrast-weaker);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.preview-value {
  min-width: 0;
  overflow: hidden;
  color: var(--color-normal-contrast);
  font: 11px/1.45 var(--font-mono, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result {
  min-height: 118px;
}

.result-list {
  display: grid;
  gap: 5px;
  max-height: 180px;
  overflow: auto;
}

.result-list:empty {
  display: none;
}

.result-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 31px;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: var(--yz-radius-sm);
  background: var(--color-normal-fill);
}

.result-row:hover {
  border-color: var(--color-normal-border);
}

.result-label {
  min-width: 0;
  overflow: hidden;
  color: var(--color-normal-contrast-weaker);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-code {
  max-width: 92px;
  overflow: hidden;
  padding: 1px 5px;
  color: var(--color-normal-contrast-weaker);
  border-radius: 3px;
  background: var(--color-normal-fill-emphasis);
  font: 9px/1.5 var(--font-mono, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-row button {
  min-height: 23px;
  padding: 2px 7px;
  font-size: 10px;
}

.empty-state {
  display: grid;
  min-height: 62px;
  place-items: center;
  padding: 10px;
  color: var(--color-normal-contrast-weaker);
  border: 1px dashed var(--color-normal-border);
  border-radius: var(--yz-radius);
  text-align: center;
}

.empty-state.hidden {
  display: none;
}

.raw-details {
  margin-top: 8px;
  border-top: 1px solid var(--color-normal-border);
}

.raw-details summary {
  padding: 8px 1px 0;
  color: var(--color-normal-contrast-weaker);
  cursor: pointer;
  font-size: 10px;
  user-select: none;
}

.raw-toolbar {
  display: flex;
  justify-content: flex-end;
  margin: 6px 0;
}

.raw-toolbar button {
  min-height: 23px;
  padding: 2px 7px;
  font-size: 10px;
}

pre {
  min-height: 90px;
  max-height: 300px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--color-normal-contrast-weaker);
  border: 1px solid var(--color-normal-border);
  border-radius: var(--yz-radius-sm);
  background: var(--color-normal-fill);
  font: 10px/1.55 var(--font-mono, monospace);
}

.hidden {
  display: none !important;
}

@media (max-width: 470px) {
  .shell { padding: 10px; }
  .form-grid,
  .tool-row { grid-template-columns: 1fr; }
  .topbar { align-items: flex-start; }
  .primary { width: 100%; }
  .brand-mark { display: none; }
}
`;

function getLocale() {
  const language = Editor.I18n && typeof Editor.I18n.getLanguage === 'function'
    ? Editor.I18n.getLanguage()
    : 'en';
  return String(language || '').toLowerCase().startsWith('zh') ? zh : en;
}

function t(panel, key) {
  return (panel.locale && panel.locale[key]) || en[key] || key;
}

function translate(panel) {
  panel.locale = getLocale();
  for (const element of panel.$.shell.querySelectorAll('[data-i18n]')) {
    element.textContent = t(panel, element.dataset.i18n);
  }
  for (const element of panel.$.shell.querySelectorAll('[data-i18n-title]')) {
    element.setAttribute('title', t(panel, element.dataset.i18nTitle));
  }
  for (const element of panel.$.shell.querySelectorAll('[data-i18n-placeholder]')) {
    element.setAttribute('placeholder', t(panel, element.dataset.i18nPlaceholder));
  }
}

function initialize(panel) {
  translate(panel);
  setStatus(panel, 'panel_status_ready', 'ready');
  const copy = panel.$.shell.querySelector('[data-result-copy]');
  if (copy) {
    copy.addEventListener('click', async () => {
      await copyText(panel.$.result?.textContent || '');
      const original = copy.textContent;
      copy.textContent = t(panel, 'panel_copied');
      setTimeout(() => { copy.textContent = original; }, 1000);
    });
  }
}

function setStatus(panel, key, state = 'ready') {
  panel.$.shell.dataset.state = state;
  if (panel.$.status) {
    panel.$.status.textContent = t(panel, key);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function errorResult(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : String(error),
    details: error && Array.isArray(error.details) ? error.details : [],
    issueDetails: error && Array.isArray(error.issueDetails) ? error.issueDetails : [],
  };
}

function normalizeRows(items, fallback = {}) {
  return (items || []).map((item) => {
    if (!item || typeof item !== 'object') {
      return { label: String(item), ...fallback };
    }
    return {
      label: item.message || item.label || item.path || item.output || item.source || item.url || item.name || item.code || JSON.stringify(item),
      url: item.url,
      path: item.path || item.output,
      code: item.code || fallback.code,
      severity: item.severity || fallback.severity,
    };
  });
}

function resultRows(panel, value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.issueDetails) && value.issueDetails.length > 0) return normalizeRows(value.issueDetails);
  if (Array.isArray(value.failedDetails) && value.failedDetails.length > 0) return normalizeRows(value.failedDetails, { code: 'failed', severity: 'error' });
  if (Array.isArray(value.details) && value.details.length > 0) return normalizeRows(value.details);
  if (Array.isArray(value.removedDetails) && value.removedDetails.length > 0) return normalizeRows(value.removedDetails, { code: 'removed' });
  if (Array.isArray(value.changedDetails) && value.changedDetails.length > 0) return normalizeRows(value.changedDetails, { code: 'changed' });
  if (value.generated && Array.isArray(value.generated.changedDetails) && value.generated.changedDetails.length > 0) {
    return normalizeRows(value.generated.changedDetails, { code: 'generated' });
  }
  if (value.validation && Array.isArray(value.validation.issueDetails) && value.validation.issueDetails.length > 0) {
    return normalizeRows(value.validation.issueDetails);
  }
  if (value.clean && Array.isArray(value.clean.fileDetails) && value.clean.fileDetails.length > 0) {
    return normalizeRows(value.clean.fileDetails, { code: 'cleaned' });
  }
  if (value.clean && Array.isArray(value.clean.protectedDetails) && value.clean.protectedDetails.length > 0) {
    return normalizeRows(value.clean.protectedDetails, { code: t(panel, 'clean_protected') });
  }
  if (Array.isArray(value.protectedDetails) && value.protectedDetails.length > 0) {
    return normalizeRows(value.protectedDetails, { code: t(panel, 'clean_protected') });
  }
  if (Array.isArray(value.fileDetails) && value.fileDetails.length > 0) return normalizeRows(value.fileDetails);
  if (Array.isArray(value.changed) && value.changed.length > 0) return normalizeRows(value.changed, { code: 'changed' });
  if (Array.isArray(value.removed) && value.removed.length > 0) return normalizeRows(value.removed, { code: 'removed' });
  if (Array.isArray(value.tables) && value.tables.length > 0) return normalizeRows(value.tables, { code: 'table' });
  return [];
}

function resultState(value) {
  if (value && typeof value === 'object') {
    if (value.cancelled === true) return 'info';
    if (value.ok === false || value.error || (Array.isArray(value.issues) && value.issues.length > 0)) return 'error';
    if (value.warning || (Array.isArray(value.warnings) && value.warnings.length > 0)) return 'warning';
    if (value.ok === true) return 'success';
    if (Object.prototype.hasOwnProperty.call(value, 'changed')
      || Object.prototype.hasOwnProperty.call(value, 'removed')
      || Object.prototype.hasOwnProperty.call(value, 'generated')) return 'success';
  }
  return 'info';
}

function resultSummary(panel, value, rows) {
  const state = resultState(value);
  if (state === 'error') {
    if (value && typeof value === 'object' && value.error) return String(value.error);
    const issueCount = rows.length
      || (Array.isArray(value?.issues) ? value.issues.length : 0)
      || (Array.isArray(value?.failed) ? value.failed.length : 0);
    return t(panel, 'panel_result_failed').replace('{count}', String(issueCount));
  }
  if (state === 'warning') return t(panel, 'panel_result_warning');
  if (state === 'success') {
    const changed = value && typeof value === 'object' && Array.isArray(value.changed)
      ? value.changed.length
      : (Array.isArray(value?.removed) ? value.removed.length : undefined);
    return t(panel, typeof changed === 'number' && changed > 0 ? 'panel_result_changed' : 'panel_result_success')
      .replace('{count}', String(changed || 0));
  }
  return t(panel, 'panel_result_info');
}

function setResult(panel, value) {
  const rows = resultRows(panel, value);
  panel.$.resultList.innerHTML = '';
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'result-row';
    if (row.code) {
      const code = document.createElement('span');
      code.className = 'result-code';
      code.textContent = row.code;
      code.title = row.code;
      item.appendChild(code);
    } else {
      const marker = document.createElement('span');
      marker.className = 'status-dot';
      item.appendChild(marker);
    }
    const label = document.createElement('span');
    label.className = 'result-label';
    label.textContent = row.label || row.path || row.url || '';
    label.title = label.textContent;
    item.appendChild(label);
    if (row.url || row.path) {
      const button = document.createElement('button');
      button.textContent = t(panel, 'panel_locate');
      button.addEventListener('click', () => locateResult(panel, row));
      item.appendChild(button);
    } else {
      item.appendChild(document.createElement('span'));
    }
    panel.$.resultList.appendChild(item);
  }

  const state = resultState(value);
  const root = panel.$.shell.querySelector('.result');
  const pill = root?.querySelector('[data-result-state]');
  const summary = root?.querySelector('[data-result-summary]');
  const empty = root?.querySelector('[data-result-empty]');
  const details = root?.querySelector('.raw-details');
  if (pill) {
    pill.dataset.state = state;
    pill.textContent = t(panel, `panel_result_state_${state}`);
  }
  if (summary) summary.textContent = resultSummary(panel, value, rows);
  if (empty) empty.classList.add('hidden');
  if (details) {
    details.classList.remove('hidden');
    details.open = state === 'error';
  }
  panel.$.result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  setStatus(panel, state === 'error' ? 'panel_status_failed' : 'panel_status_ready', state === 'error' ? 'error' : 'ready');
}

async function copyText(value) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

async function call(message, payload) {
  return await Editor.Message.request('yzforge', message, payload);
}

async function locateResult(panel, row) {
  try {
    const result = await call('focus-asset', { url: row.url, path: row.path });
    setStatus(panel, result && result.selected ? 'panel_status_ready' : 'panel_status_working', 'ready');
  } catch (error) {
    setResult(panel, { ok: false, error: error.message, target: row });
  }
}

module.exports = {
  baseStyle,
  call,
  errorResult,
  escapeHtml,
  initialize,
  resultRows,
  setResult,
  setStatus,
  t,
  translate,
};
