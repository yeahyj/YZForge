'use strict';

const en = require('../../i18n/en');
const zh = require('../../i18n/zh');

const baseStyle = `
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

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-height: 0;
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

.tool-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
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
  .form-grid,
  .tool-row {
    grid-template-columns: 1fr;
  }

  .primary {
    width: 100%;
  }
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

function resultRows(panel, value) {
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
      label: `${t(panel, 'clean_protected')}: ${item.path}`,
      url: item.url,
      path: item.path,
    }));
  }
  if (Array.isArray(value.protectedDetails) && value.protectedDetails.length > 0) {
    return value.protectedDetails.map((item) => ({
      label: `${t(panel, 'clean_protected')}: ${item.path}`,
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
}

function setResult(panel, value) {
  panel.$.resultList.innerHTML = '';
  for (const row of resultRows(panel, value)) {
    const item = document.createElement('div');
    item.className = 'result-row';
    const label = document.createElement('span');
    label.textContent = row.label || row.path || row.url || '';
    item.appendChild(label);
    if (row.url || row.path) {
      const button = document.createElement('button');
      button.textContent = t(panel, 'panel_locate');
      button.addEventListener('click', () => locateResult(panel, row));
      item.appendChild(button);
    }
    panel.$.resultList.appendChild(item);
  }
  panel.$.result.textContent = typeof value === 'string'
    ? value
    : JSON.stringify(value, null, 2);
}

async function call(message, payload) {
  return await Editor.Message.request('yzforge', message, payload);
}

async function locateResult(panel, row) {
  try {
    const result = await call('focus-asset', {
      url: row.url,
      path: row.path,
    });
    panel.$.status.textContent = result && result.selected
      ? t(panel, 'panel_status_ready')
      : t(panel, 'panel_status_working');
  } catch (error) {
    setResult(panel, { ok: false, error: error.message, target: row });
  }
}

module.exports = {
  baseStyle,
  call,
  errorResult,
  escapeHtml,
  setResult,
  t,
  translate,
};
