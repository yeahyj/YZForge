'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { generate } = require('./generate');
const { scanProject } = require('./scanner');
const { isTextChanged, readJsonc, toPosix, walk, writeTextIfChanged } = require('./fs-utils');
const { listSheets, readSheet } = require('./xlsx-reader');

const CONFIG_SOURCE_ROOT = 'config-source';
const CONFIG_EXCEL_ROOT = 'config-source/excel';
const CONFIG_PLAN_PATH = 'config-source/export-plan.json';
const CONFIG_META_KEY = '_yzforgeConfig';
const SUPPORTED_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'string[]', 'number[]', 'boolean[]', 'json']);
const SUPPORTED_RULES = new Set(['pk', 'client', 'optional', 'ignore']);

function lowerCamelCase(value) {
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

function pascalCase(value) {
  const name = lowerCamelCase(value);
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : '';
}

function stableId(value) {
  const name = lowerCamelCase(value);
  return /^[A-Za-z_$]/.test(name) ? name : `key${pascalCase(value) || 'Value'}`;
}

function normalizeRuleList(value) {
  const text = String(value || '').trim();
  if (!text) {
    return ['client'];
  }
  return text.split(/[,;|\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function normalizeConfigSourcePath(projectRoot, value) {
  const raw = toPosix(value || '');
  if (!raw || path.isAbsolute(raw)) {
    throw new Error(`Config source must be project-relative under ${CONFIG_EXCEL_ROOT}: ${raw || '<empty>'}`);
  }
  const root = path.resolve(projectRoot, CONFIG_EXCEL_ROOT);
  const absolute = path.resolve(projectRoot, raw);
  const relativeToRoot = path.relative(root, absolute);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Config source must stay under ${CONFIG_EXCEL_ROOT}: ${raw}`);
  }
  if (path.extname(absolute).toLowerCase() !== '.xlsx') {
    throw new Error(`Config source must be an .xlsx file: ${raw}`);
  }
  return toPosix(path.relative(projectRoot, absolute));
}

function isEmptyCell(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isEmptyRow(row) {
  return !row || row.every(isEmptyCell);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(text)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(text)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseArray(value, itemType) {
  if (Array.isArray(value)) {
    return value;
  }
  const text = String(value || '').trim();
  if (!text) {
    return [];
  }
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`Array field must contain an array: ${text}`);
    }
    return parsed;
  }
  return text.split(/[,;|]/).map((item) => {
    const trimmed = item.trim();
    if (itemType === 'number') {
      const number = Number(trimmed);
      if (!Number.isFinite(number)) {
        throw new Error(`Invalid number array item: ${trimmed}`);
      }
      return number;
    }
    if (itemType === 'boolean') {
      return parseBoolean(trimmed);
    }
    return trimmed;
  });
}

function convertCell(value, type) {
  if (type === 'string' || type === 'enum') {
    return String(value);
  }
  if (type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`Invalid number value: ${value}`);
    }
    return number;
  }
  if (type === 'boolean') {
    return parseBoolean(value);
  }
  if (type === 'string[]') {
    return parseArray(value, 'string');
  }
  if (type === 'number[]') {
    return parseArray(value, 'number');
  }
  if (type === 'boolean[]') {
    return parseArray(value, 'boolean');
  }
  if (type === 'json') {
    if (typeof value === 'string') {
      const text = value.trim();
      return text ? JSON.parse(text) : null;
    }
    return value;
  }
  throw new Error(`Unsupported field type: ${type}`);
}

function validateFieldName(name, table) {
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(`${table.source}#${table.sheet} field name must be camelCase: ${name}`);
  }
}

function parseHeader(planTable, rows) {
  const [names = [], types = [], rules = [], comments = []] = rows;
  const fields = [];
  const seen = new Set();
  for (let index = 0; index < names.length; index += 1) {
    const name = String(names[index] || '').trim();
    if (!name) {
      continue;
    }
    const fieldRules = normalizeRuleList(rules[index]);
    const unknownRules = fieldRules.filter((rule) => !SUPPORTED_RULES.has(rule));
    if (unknownRules.length > 0) {
      throw new Error(`${planTable.source}#${planTable.sheet} field ${name} has unsupported rule: ${unknownRules.join(', ')}`);
    }
    if (fieldRules.includes('ignore') && fieldRules.length > 1) {
      throw new Error(`${planTable.source}#${planTable.sheet} field ${name} cannot combine ignore with other rules.`);
    }
    if (name === 'id' && !fieldRules.includes('pk')) {
      throw new Error(`${planTable.source}#${planTable.sheet} field id must be marked pk.`);
    }
    if (fieldRules.includes('ignore')) {
      continue;
    }
    validateFieldName(name, planTable);
    if (seen.has(name)) {
      throw new Error(`${planTable.source}#${planTable.sheet} has duplicate field: ${name}`);
    }
    seen.add(name);
    const type = String(types[index] || '').trim().toLowerCase();
    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error(`${planTable.source}#${planTable.sheet} field ${name} has unsupported type: ${type || '<empty>'}`);
    }
    fields.push({
      name,
      type,
      rules: fieldRules,
      comment: String(comments[index] || '').trim(),
      column: index,
    });
  }
  const markedFields = fields.filter((field) => field.rules.includes('pk'));
  if (markedFields.length !== 1) {
    throw new Error(`${planTable.source}#${planTable.sheet} must have exactly one pk field.`);
  }
  return {
    fields,
    primaryKey: markedFields[0].name,
  };
}

function readPlan(projectRoot) {
  const planPath = path.join(projectRoot, CONFIG_PLAN_PATH);
  if (!fs.existsSync(planPath)) {
    return { schemaVersion: 1, tables: [] };
  }
  const plan = readJsonc(planPath);
  return {
    schemaVersion: plan.schemaVersion ?? 1,
    tables: Array.isArray(plan.tables) ? plan.tables : [],
  };
}

function writePlan(projectRoot, plan) {
  const normalized = {
    schemaVersion: 1,
    tables: plan.tables || [],
  };
  const target = path.join(projectRoot, CONFIG_PLAN_PATH);
  return writeTextIfChanged(target, `${JSON.stringify(normalized, null, 2)}\n`);
}

function createPlanTableId() {
  const value = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `cfg_${value}`;
}

function legacyTablePlanId(table) {
  return [
    table.scope?.kind,
    table.scope?.name,
    table.scope?.owner,
    table.table,
    table.source,
    table.sheet,
  ].filter(Boolean).join(':');
}

function tablePlanSortKey(table) {
  return table.label || legacyTablePlanId(table) || table.id || '';
}

function normalizePlanId(value) {
  const id = String(value || '').trim();
  if (!id) {
    return undefined;
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(`Config table rule id is invalid: ${id}`);
  }
  return id;
}

function normalizePlanLabel(value) {
  const label = String(value || '').trim();
  if (!label) {
    return undefined;
  }
  if (label.length > 80) {
    throw new Error(`Config table rule label is too long: ${label}`);
  }
  return label;
}

function saveConfigPlanTable(projectRoot, table) {
  const plan = readPlan(projectRoot);
  const normalized = normalizePlanTable(projectRoot, table);
  const legacyId = legacyTablePlanId(normalized);
  let index = normalized.id
    ? plan.tables.findIndex((item) => item.id === normalized.id)
    : -1;
  if (index < 0) {
    index = plan.tables.findIndex((item) => legacyTablePlanId(item) === legacyId);
  }
  const stableId = index >= 0
    ? plan.tables[index].id || normalized.id || createPlanTableId()
    : normalized.id || createPlanTableId();
  const nextTable = { ...normalized, id: stableId };
  if (index >= 0) {
    plan.tables[index] = nextTable;
  } else {
    plan.tables.push(nextTable);
  }
  plan.tables.sort((a, b) => tablePlanSortKey(a).localeCompare(tablePlanSortKey(b)));
  const changed = writePlan(projectRoot, plan);
  return { ok: true, changed: changed ? [CONFIG_PLAN_PATH] : [], plan, table: nextTable };
}

function deleteConfigPlanTable(projectRoot, table) {
  const id = normalizePlanId(table?.id);
  if (!id) {
    throw new Error('Config table rule id is required.');
  }
  const plan = readPlan(projectRoot);
  const deleted = plan.tables.find((item) => item.id === id);
  const nextTables = plan.tables.filter((item) => item.id !== id);
  if (nextTables.length === plan.tables.length) {
    throw new Error(`Config table rule not found: ${id}`);
  }
  const nextPlan = { ...plan, tables: nextTables };
  const changed = writePlan(projectRoot, nextPlan);
  return { ok: true, changed: changed ? [CONFIG_PLAN_PATH] : [], plan: nextPlan, deleted };
}

function saveConfigSource(projectRoot, options = {}) {
  const source = normalizeConfigSourcePath(projectRoot, options.source);
  const sourcePath = path.join(projectRoot, source);
  const availableSheets = new Set(listSheets(sourcePath));
  const requestedTables = Array.isArray(options.tables) ? options.tables : [];
  if (requestedTables.length === 0) {
    throw new Error(`Config source must include at least one sheet: ${source}`);
  }

  const plan = readPlan(projectRoot);
  const existingForSource = plan.tables.filter((table) => table.source === source);
  const existingById = new Map(existingForSource.filter((table) => table.id).map((table) => [table.id, table]));
  const existingBySheet = new Map(existingForSource.map((table) => [table.sheet, table]));
  const seenSheets = new Set();
  const nextTables = requestedTables.map((table) => {
    const sheet = String(table?.sheet || '').trim();
    if (!availableSheets.has(sheet)) {
      throw new Error(`Config sheet does not exist in ${source}: ${sheet || '<empty>'}`);
    }
    if (seenSheets.has(sheet)) {
      throw new Error(`Config source contains duplicate sheet rule: ${source}#${sheet}`);
    }
    seenSheets.add(sheet);
    const requestedId = normalizePlanId(table.id);
    const previous = (requestedId && existingById.get(requestedId)) || existingBySheet.get(sheet);
    if (requestedId && !previous && plan.tables.some((item) => item.id === requestedId)) {
      throw new Error(`Config table rule id belongs to another source: ${requestedId}`);
    }
    const normalized = normalizePlanTable(projectRoot, {
      ...table,
      source,
      id: previous?.id || requestedId,
      label: table.label ?? previous?.label,
    });
    return {
      ...normalized,
      id: normalized.id || createPlanTableId(),
    };
  });

  const tableKeys = new Set(plan.tables
    .filter((table) => table.source !== source)
    .map((table) => `${table.scope?.kind || ''}:${table.scope?.owner || ''}:${table.scope?.name || ''}:${table.table}`));
  const ruleIds = new Set();
  for (const table of nextTables) {
    if (ruleIds.has(table.id)) {
      throw new Error(`Config source contains a duplicate rule id: ${table.id}`);
    }
    ruleIds.add(table.id);
    const key = `${table.scope.kind}:${table.scope.owner || ''}:${table.scope.name || ''}:${table.table}`;
    if (tableKeys.has(key)) {
      throw new Error(`Config source produces a duplicate table key in one scope: ${table.table}`);
    }
    tableKeys.add(key);
  }

  const keptIds = new Set(nextTables.map((table) => table.id));
  const removed = existingForSource.filter((table) => !keptIds.has(table.id));
  const nextPlan = {
    ...plan,
    tables: plan.tables.filter((table) => table.source !== source).concat(nextTables),
  };
  nextPlan.tables.sort((a, b) => tablePlanSortKey(a).localeCompare(tablePlanSortKey(b)));
  const changed = writePlan(projectRoot, nextPlan);
  return {
    ok: true,
    changed: changed ? [CONFIG_PLAN_PATH] : [],
    plan: nextPlan,
    source,
    tables: nextTables,
    removed,
  };
}

function deleteConfigSource(projectRoot, options = {}) {
  const source = normalizeConfigSourcePath(projectRoot, options.source);
  const plan = readPlan(projectRoot);
  const removed = plan.tables.filter((table) => table.source === source);
  if (removed.length === 0) {
    throw new Error(`Config source has no saved rules: ${source}`);
  }
  const nextPlan = {
    ...plan,
    tables: plan.tables.filter((table) => table.source !== source),
  };
  const changed = writePlan(projectRoot, nextPlan);
  return {
    ok: true,
    changed: changed ? [CONFIG_PLAN_PATH] : [],
    plan: nextPlan,
    source,
    removed,
  };
}

function normalizePlanTable(projectRoot, table) {
  const source = normalizeConfigSourcePath(projectRoot, table.source);
  const scope = table.scope || {};
  const normalized = {
    id: normalizePlanId(table.id),
    label: normalizePlanLabel(table.label),
    source,
    sheet: String(table.sheet || '').trim(),
    table: lowerCamelCase(table.table || table.sheet),
    scope: {
      kind: scope.kind,
      name: scope.name,
      owner: scope.owner,
    },
    format: table.format || 'json',
    generateKeys: table.generateKeys !== false,
  };
  if (!normalized.sheet) {
    throw new Error('Config sheet is required.');
  }
  if (!normalized.table || !/^[a-z][A-Za-z0-9]*$/.test(normalized.table)) {
    throw new Error(`Config table name must be lower camel case: ${normalized.table}`);
  }
  if (normalized.format !== 'json') {
    throw new Error(`Config format is not implemented yet: ${normalized.format}`);
  }
  validateScope(projectRoot, normalized.scope);
  return normalized;
}

function validateScope(projectRoot, scope) {
  const project = scanProject(projectRoot);
  if (scope.kind === 'global') {
    return;
  }
  if (scope.kind === 'module' && project.modules.some((item) => item.name === scope.name)) {
    return;
  }
  if (scope.kind === 'library' && project.libraries.some((item) => item.name === scope.name)) {
    return;
  }
  if (scope.kind === 'content-pack' && project.contentPacks.some((item) => item.owner === scope.owner && item.name === scope.name)) {
    return;
  }
  throw new Error(`Config scope does not exist: ${JSON.stringify(scope)}`);
}

function outputConfigDir(scope) {
  if (scope.kind === 'global') {
    return 'assets/app/global/res/content/config';
  }
  if (scope.kind === 'module') {
    return `assets/modules/${scope.name}/res/content/config`;
  }
  if (scope.kind === 'library') {
    return `assets/libraries/${scope.name}/res/content/config`;
  }
  if (scope.kind === 'content-pack') {
    return `assets/content-packs/${scope.owner}/${scope.name}/res/content/config`;
  }
  throw new Error(`Unknown config scope kind: ${scope.kind}`);
}

function outputConfigPath(table) {
  return `${outputConfigDir(table.scope)}/${pascalCase(table.table)}.json`;
}

function configRowTypeName(table) {
  return `${pascalCase(table.table)}Row`;
}

function configPayloadRoots(projectRoot) {
  const project = scanProject(projectRoot);
  const roots = [];
  if (project.global) {
    roots.push('assets/app/global/res/content/config');
  }
  for (const module of project.modules) {
    roots.push(`assets/modules/${module.name}/res/content/config`);
  }
  for (const library of project.libraries) {
    roots.push(`assets/libraries/${library.name}/res/content/config`);
  }
  for (const pack of project.contentPacks) {
    roots.push(`assets/content-packs/${pack.owner}/${pack.name}/res/content/config`);
  }
  return roots;
}

function generatedConfigPayloads(projectRoot) {
  const files = [];
  for (const root of configPayloadRoots(projectRoot)) {
    for (const filePath of walk(path.join(projectRoot, root), (candidate) => candidate.endsWith('.json'))) {
      const relativePath = toPosix(path.relative(projectRoot, filePath));
      try {
        const payload = readJsonc(filePath);
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload[CONFIG_META_KEY]) {
          files.push(relativePath);
        }
      } catch (_error) {
        continue;
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function buildKeyConstName(table) {
  const scopePrefix = table.scope.kind === 'content-pack'
    ? `${table.scope.owner}${table.scope.name}`
    : table.scope.name || 'Global';
  const prefix = pascalCase(scopePrefix);
  const tableName = pascalCase(table.table);
  return `${tableName.startsWith(prefix) ? tableName : `${prefix}${tableName}`}Ids`;
}

function buildKeyTypeName(table) {
  const constName = buildKeyConstName(table);
  return constName.endsWith('Ids') ? `${constName.slice(0, -3)}Id` : `${constName}Value`;
}

function buildTable(projectRoot, table) {
  const sourcePath = path.join(projectRoot, table.source);
  const rows = readSheet(sourcePath, table.sheet);
  if (rows.length < 4) {
    throw new Error(`${table.source}#${table.sheet} must contain 4 header rows.`);
  }
  const header = parseHeader(table, rows.slice(0, 4));
  const rowType = configRowTypeName(table);
  const dataRows = [];
  const keyNames = new Set();

  for (let rowIndex = 4; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (isEmptyRow(row)) {
      continue;
    }
    const record = {};
    for (const field of header.fields) {
      const raw = row[field.column];
      const optional = field.rules.includes('optional');
      if (isEmptyCell(raw)) {
        if (field.name === header.primaryKey || !optional) {
          throw new Error(`${table.source}#${table.sheet} row ${rowIndex + 1} field ${field.name} is empty.`);
        }
        continue;
      }
      try {
        record[field.name] = convertCell(raw, field.type);
      } catch (error) {
        throw new Error(`${table.source}#${table.sheet} row ${rowIndex + 1} field ${field.name}: ${error.message}`);
      }
    }
    const primaryValue = record[header.primaryKey];
    if (isEmptyCell(primaryValue)) {
      throw new Error(`${table.source}#${table.sheet} row ${rowIndex + 1} primary key is empty.`);
    }
    const primaryKey = String(primaryValue);
    if (keyNames.has(primaryKey)) {
      throw new Error(`${table.source}#${table.sheet} duplicate primary key: ${primaryKey}`);
    }
    keyNames.add(primaryKey);
    dataRows.push(record);
  }

  return {
    path: outputConfigPath(table),
    payload: {
      [CONFIG_META_KEY]: {
        schemaVersion: 1,
        source: table.source,
        sheet: table.sheet,
        table: table.table,
        row: rowType,
        scope: table.scope,
        primaryKey: header.primaryKey,
        format: table.format,
        generateKeys: table.generateKeys,
        keyConst: buildKeyConstName(table),
        keyType: buildKeyTypeName(table),
        fields: header.fields.map(({ column, ...field }) => field),
      },
      rows: dataRows,
    },
  };
}

function buildConfig(projectRoot, options = {}) {
  const check = options.check === true;
  const plan = readPlan(projectRoot);
  const changed = [];
  const details = [];
  const seenOutputs = new Set();
  const tables = plan.tables.map((table) => normalizePlanTable(projectRoot, table));

  for (const table of tables) {
    const built = buildTable(projectRoot, table);
    if (seenOutputs.has(built.path)) {
      throw new Error(`Duplicate config output path: ${built.path}`);
    }
    seenOutputs.add(built.path);
    const content = `${JSON.stringify(built.payload, null, 2)}\n`;
    const filePath = path.join(projectRoot, built.path);
    const didChange = check ? isTextChanged(filePath, content) : writeTextIfChanged(filePath, content);
    if (didChange) {
      changed.push(built.path);
    }
    details.push({
      source: table.source,
      sheet: table.sheet,
      scope: table.scope,
      table: table.table,
      output: built.path,
      rows: built.payload.rows.length,
      changed: didChange,
    });
  }

  for (const stale of generatedConfigPayloads(projectRoot)) {
    if (seenOutputs.has(stale)) {
      continue;
    }
    changed.push(stale);
    if (!check) {
      fs.rmSync(path.join(projectRoot, stale), { force: true });
    }
  }

  const generated = generate(projectRoot, { check });
  return {
    ok: !check || (changed.length === 0 && generated.changed.length === 0),
    check,
    plan: CONFIG_PLAN_PATH,
    tables: details,
    changed: [...changed, ...generated.changed],
    generated,
  };
}

function scanConfigSources(projectRoot) {
  const root = path.join(projectRoot, CONFIG_EXCEL_ROOT);
  const files = walk(root, (filePath) => filePath.toLowerCase().endsWith('.xlsx'))
    .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
  return files.map((filePath) => {
    const relative = toPosix(path.relative(projectRoot, filePath));
    try {
      return {
        source: relative,
        sheets: listSheets(filePath),
      };
    } catch (error) {
      return {
        source: relative,
        sheets: [],
        error: error.message,
      };
    }
  });
}

function configDashboard(projectRoot) {
  const project = scanProject(projectRoot);
  return {
    planPath: CONFIG_PLAN_PATH,
    plan: readPlan(projectRoot),
    sources: scanConfigSources(projectRoot),
    scopes: {
      modules: project.modules.map((item) => item.name),
      libraries: project.libraries.map((item) => item.name),
      contentPacks: project.contentPacks.map((item) => ({
        owner: item.owner,
        name: item.name,
        id: item.id,
      })),
      global: Boolean(project.global),
    },
  };
}

module.exports = {
  CONFIG_META_KEY,
  CONFIG_PLAN_PATH,
  buildConfig,
  configDashboard,
  deleteConfigSource,
  readPlan,
  deleteConfigPlanTable,
  saveConfigSource,
  saveConfigPlanTable,
};
