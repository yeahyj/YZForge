'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlAttributes(source) {
  const attrs = {};
  const pattern = /([A-Za-z_][\w:.-]*)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function columnIndex(cellRef) {
  const match = String(cellRef || '').match(/^([A-Z]+)/i);
  if (!match) {
    return 0;
  }
  let index = 0;
  for (const char of match[1].toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function normalizeZipPath(value) {
  const parts = [];
  for (const part of String(value || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function resolveZipTarget(fromPath, target) {
  if (String(target || '').startsWith('/')) {
    return normalizeZipPath(target);
  }
  return normalizeZipPath(`${path.posix.dirname(fromPath)}/${target}`);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === signature) {
      return offset;
    }
  }
  throw new Error('Invalid xlsx file: end of central directory not found.');
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = readUInt16(buffer, eocd + 10);
  let cursor = readUInt32(buffer, eocd + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(buffer, cursor) !== 0x02014b50) {
      throw new Error(`Invalid xlsx file: central directory entry ${index} is corrupt.`);
    }
    const compression = readUInt16(buffer, cursor + 10);
    const compressedSize = readUInt32(buffer, cursor + 20);
    const fileNameLength = readUInt16(buffer, cursor + 28);
    const extraLength = readUInt16(buffer, cursor + 30);
    const commentLength = readUInt16(buffer, cursor + 32);
    const localHeaderOffset = readUInt32(buffer, cursor + 42);
    const name = buffer.slice(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');

    if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid xlsx file: local header missing for ${name}.`);
    }
    const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (compression === 0) {
      data = compressed;
    } else if (compression === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported xlsx compression method ${compression}: ${name}.`);
    }
    entries.set(normalizeZipPath(name), data);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function readXml(entries, filePath) {
  const value = entries.get(normalizeZipPath(filePath));
  return value ? value.toString('utf8') : '';
}

function parseRelationships(xml, basePath) {
  const rels = new Map();
  const pattern = /<Relationship\b([^>]*)\/?>/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    const attrs = xmlAttributes(match[1]);
    if (attrs.Id && attrs.Target) {
      rels.set(attrs.Id, resolveZipTarget(basePath, attrs.Target));
    }
  }
  return rels;
}

function parseSharedStrings(xml) {
  const strings = [];
  const siPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let si;
  while ((si = siPattern.exec(xml)) !== null) {
    const pieces = [];
    const tPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tPattern.exec(si[1])) !== null) {
      pieces.push(decodeXml(t[1]));
    }
    strings.push(pieces.join(''));
  }
  return strings;
}

function parseCellValue(cellXml, attrs, sharedStrings) {
  const inlineMatch = cellXml.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
  if (inlineMatch) {
    const pieces = [];
    const tPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tPattern.exec(inlineMatch[1])) !== null) {
      pieces.push(decodeXml(t[1]));
    }
    return pieces.join('');
  }

  const valueMatch = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  const raw = valueMatch ? decodeXml(valueMatch[1]) : '';
  if (attrs.t === 's') {
    return sharedStrings[Number(raw)] ?? '';
  }
  if (attrs.t === 'b') {
    return raw === '1';
  }
  if (attrs.t === 'str') {
    return raw;
  }
  if (raw === '') {
    return '';
  }
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let row;
  while ((row = rowPattern.exec(xml)) !== null) {
    const values = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cell;
    while ((cell = cellPattern.exec(row[1])) !== null) {
      const attrs = xmlAttributes(cell[1]);
      const index = columnIndex(attrs.r);
      values[index] = parseCellValue(cell[0], attrs, sharedStrings);
    }
    rows.push(values.map((value) => value ?? ''));
  }
  return rows;
}

function readWorkbook(filePath) {
  const entries = readZipEntries(filePath);
  const workbookXml = readXml(entries, 'xl/workbook.xml');
  const relationships = parseRelationships(readXml(entries, 'xl/_rels/workbook.xml.rels'), 'xl/workbook.xml');
  const sharedStrings = parseSharedStrings(readXml(entries, 'xl/sharedStrings.xml'));
  const sheets = [];
  const sheetPattern = /<sheet\b([^>]*)\/?>/g;
  let sheet;
  while ((sheet = sheetPattern.exec(workbookXml)) !== null) {
    const attrs = xmlAttributes(sheet[1]);
    const relId = attrs['r:id'];
    const target = relationships.get(relId);
    if (!attrs.name || !target) {
      continue;
    }
    sheets.push({
      name: attrs.name,
      rows: parseSheetRows(readXml(entries, target), sharedStrings),
    });
  }
  return { sheets };
}

function listSheets(filePath) {
  return readWorkbook(filePath).sheets.map((sheet) => sheet.name);
}

function readSheet(filePath, sheetName) {
  const workbook = readWorkbook(filePath);
  const sheet = workbook.sheets.find((item) => item.name === sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }
  return sheet.rows;
}

module.exports = {
  listSheets,
  readSheet,
  readWorkbook,
};
