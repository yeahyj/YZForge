'use strict';

const { isPascalCase, kebabCase } = require('../fs-utils');

function expectedBundle(kind, descriptor) {
  if (kind === 'module') {
    return `yzforge-module-${kebabCase(descriptor.name)}`;
  }
  if (kind === 'library') {
    return `yzforge-lib-${kebabCase(descriptor.name)}`;
  }
  return `yzforge-content-pack-${kebabCase(descriptor.owner)}-${kebabCase(descriptor.name)}`;
}

const DESCRIPTOR_FIELDS = {
  module: ['$schema', 'schemaVersion', 'kind', 'name', 'bundle', 'entry', 'public', 'enterParams', 'libraries'],
  library: ['$schema', 'schemaVersion', 'kind', 'name', 'bundle', 'entry', 'public', 'libraries'],
  'content-pack': ['$schema', 'schemaVersion', 'kind', 'id', 'owner', 'name', 'bundle', 'libraries'],
};

function validateDescriptorShape(kind, descriptor, label, issues) {
  const fields = DESCRIPTOR_FIELDS[kind];
  for (const field of fields) {
    if (descriptor[field] === undefined) {
      issues.push(`${label} schema requires property '${field}'.`, {
        path: descriptor.projectPath,
        code: 'descriptor.schema',
        field,
      });
    }
  }
  const internalFields = new Set(['filePath', 'projectPath', 'dir']);
  for (const field of Object.keys(descriptor)) {
    if (!fields.includes(field) && !internalFields.has(field)) {
      issues.push(`${label} schema rejects unknown property '${field}'.`, {
        path: descriptor.projectPath,
        code: 'descriptor.schema',
        field,
      });
    }
  }
  if (!Array.isArray(descriptor.libraries)
    || descriptor.libraries.some((name) => !isPascalCase(name))
    || new Set(descriptor.libraries).size !== descriptor.libraries.length) {
    issues.push(`${label} libraries must be a unique PascalCase string array.`, {
      path: descriptor.projectPath,
      code: 'descriptor.schema',
      field: 'libraries',
    });
  }
  if (kind === 'module') {
    if (descriptor.entry !== 'code/generated/entry.ts') issues.push(`${label} entry must be 'code/generated/entry.ts'.`);
    if (descriptor.public !== 'code/public.ts') issues.push(`${label} public must be 'code/public.ts'.`);
    if (!isPascalCase(descriptor.enterParams)) issues.push(`${label} enterParams must be PascalCase.`);
  }
  if (kind === 'library') {
    if (descriptor.entry !== 'code/generated/entry.ts') issues.push(`${label} entry must be 'code/generated/entry.ts'.`);
    if (descriptor.public !== 'code/public.ts') issues.push(`${label} public must be 'code/public.ts'.`);
  }
  if (kind === 'content-pack' && !/^[a-z0-9-]+\.[a-z0-9-]+$/.test(descriptor.id || '')) {
    issues.push(`${label} id must match '<owner-kebab>.<name-kebab>'.`, {
      path: descriptor.projectPath,
      code: 'descriptor.schema',
      field: 'id',
    });
  }
}

function validateDescriptor(kind, descriptor, known, issues) {
  const label = `${kind}:${descriptor.name || descriptor.id}`;
  validateDescriptorShape(kind, descriptor, label, issues);
  const expectedPath = kind === 'module'
    ? `assets/modules/${descriptor.name}/module.json`
    : kind === 'library'
      ? `assets/libraries/${descriptor.name}/library.json`
      : `assets/content-packs/${descriptor.owner}/${descriptor.name}/content-pack.json`;
  if (descriptor.projectPath !== expectedPath) {
    issues.push(`${label} descriptor path must be '${expectedPath}', got '${descriptor.projectPath}'.`, {
      path: descriptor.projectPath,
      code: 'descriptor.path_mismatch',
      target: expectedPath,
    });
  }
  const expectedSchema = kind === 'content-pack'
    ? '../../../../schemas/yzforge.scope.schema.json'
    : '../../../schemas/yzforge.scope.schema.json';
  if (descriptor.$schema !== expectedSchema) {
    issues.push(`${label} must reference the V2 scope schema '${expectedSchema}'.`);
  }
  if (descriptor.schemaVersion !== 2) {
    issues.push(`${label} schemaVersion must be 2.`);
  }
  if (descriptor.kind !== kind) {
    issues.push(`${label} kind must be '${kind}'.`);
  }
  if (!isPascalCase(descriptor.name)) {
    issues.push(`${label} name must be PascalCase.`);
  }
  if (kind === 'content-pack' && !isPascalCase(descriptor.owner)) {
    issues.push(`${label} owner must be PascalCase.`);
  }
  const expected = expectedBundle(kind, descriptor);
  if (descriptor.bundle !== expected) {
    issues.push(`${label} bundle must be '${expected}', got '${descriptor.bundle}'.`);
  }
  for (const library of descriptor.libraries || []) {
    if (!known.libraries.has(library)) {
      issues.push(`${label} declares missing library '${library}'.`);
    }
  }
}

module.exports = {
  expectedBundle,
  validateDescriptor,
};
