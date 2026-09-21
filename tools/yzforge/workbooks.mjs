import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { dirname, relative, resolve, posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { files, json, safePath, withProjectLock } from './project.mjs';

export const workbookVersion = 2;
const columns = ['kind', 'id', 'sheet', 'bundle', 'primaryKey', 'enabled', 'field', 'name', 'value', 'unique'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identifier = (value) => /^[A-Za-z][A-Za-z0-9]*$/.test(value) && !['constructor', 'prototype'].includes(value);
const text = (value) => (value === null || value === undefined ? '' : String(value));
const bool = (value, fallback = true) => {
    if (value === null || value === undefined || value === '') return fallback;
    if ([true, 'true', 1, '1'].includes(value)) return true;
    if ([false, 'false', 0, '0'].includes(value)) return false;
    throw Error(`布尔值必须为 true/false：${value}`);
};
const cellValue = (cell) => {
    if (cell.value !== null && typeof cell.value === 'object') throw Error(`配置区域只接受普通值：${cell.address}`);
    return cell.value;
};
export function configRows(config) {
    const rows = [columns];
    for (const [id, value] of Object.entries({
        version: workbookVersion,
        module: config.module,
        bundle: config.bundle ?? 'default',
        enabled: config.enabled ?? true,
    }))
        rows.push(['setting', id, '', '', '', '', '', '', value]);
    for (const input of config.inputs ?? []) rows.push(['input', input]);
    for (const table of config.tables) {
        rows.push([
            'table',
            table.id,
            table.sheet,
            table.bundle ?? '',
            table.primaryKey ?? 'id',
            table.enabled !== false,
            '',
            '',
            table.public === true,
        ]);
        for (const [name, rule] of Object.entries(table.indexes ?? {}))
            rows.push(['index', table.id, '', '', '', '', rule.field, name, '', rule.unique === true]);
        for (const [field, rules] of Object.entries(table.constraints ?? {}))
            for (const [name, value] of Object.entries(rules))
                rows.push(['constraint', table.id, '', '', '', '', field, name, value]);
        if (table.shards)
            for (const [value, target] of Object.entries(table.shards.targets))
                rows.push(['shard', table.id, '', target, '', target !== null, table.shards.field, '', value]);
    }
    return rows;
}
function parseConfig(book, source) {
    const sheet = book.getWorksheet('__config');
    if (!sheet) throw Error(`${source}: 缺少 __config；请先接入 XLSX 模板或迁移旧表`);
    const header = columns.map((_, i) => text(sheet.getCell(1, i + 1).value));
    if (header.join('|') !== columns.join('|')) throw Error(`${source}: __config 表头与版本 2 模板不一致`);
    const settings = {},
        tables = [],
        rules = [],
        inputs = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
        const values = columns.map((_, i) => cellValue(sheet.getCell(n, i + 1)));
        if (values.every((value) => value === null || value === '')) continue;
        const row = Object.fromEntries(columns.map((key, i) => [key, values[i]]));
        if (row.kind === 'setting') {
            if (!['version', 'module', 'bundle', 'enabled'].includes(row.id) || row.id in settings)
                throw Error(`${source}: __config 第 ${n} 行设置重复或不支持`);
            settings[row.id] = row.value;
        } else if (row.kind === 'table') {
            if (tables.some((table) => table.id === row.id)) throw Error(`${source}: 重复的表标识 ${row.id}`);
            tables.push({
                id: text(row.id),
                sheet: text(row.sheet),
                bundle: text(row.bundle) || undefined,
                primaryKey: text(row.primaryKey) || 'id',
                enabled: bool(row.enabled),
                public: bool(row.value, false),
                indexes: {},
                constraints: {},
            });
        } else if (row.kind === 'input') inputs.push(text(row.id));
        else if (['index', 'constraint', 'shard'].includes(row.kind)) rules.push(row);
        else throw Error(`${source}: __config 第 ${n} 行 kind 不支持：${row.kind}`);
    }
    if (settings.version !== workbookVersion) throw Error(`${source}: 不支持的配置声明版本 ${settings.version}`);
    if (!/^[a-z][a-z0-9-]*$/.test(settings.module ?? '')) throw Error(`${source}: 工作簿必须属于一个模块`);
    for (const row of rules) {
        const table = tables.find((table) => table.id === row.id);
        if (!table) throw Error(`${source}: 规则引用不存在的表 ${row.id}`);
        if (row.kind === 'index') {
            if (!identifier(text(row.name)) || table.indexes[row.name])
                throw Error(`${source}: 重复或无效索引 ${row.name}`);
            table.indexes[row.name] = { field: text(row.field), unique: bool(row.unique, false) };
        } else if (row.kind === 'constraint') {
            const rules = (table.constraints[row.field] ??= {});
            if (row.name in rules) throw Error(`${source}: 重复约束 ${row.field}.${row.name}`);
            rules[row.name] = row.value;
        } else {
            table.shards ??= { field: text(row.field), targets: {} };
            if (table.shards.field !== row.field || text(row.value) in table.shards.targets)
                throw Error(`${source}: 分片字段不一致或重复目标`);
            table.shards.targets[text(row.value)] = bool(row.enabled) ? text(row.bundle) : null;
        }
    }
    return {
        module: settings.module,
        bundle: text(settings.bundle) || 'default',
        enabled: bool(settings.enabled),
        tables,
        inputs,
    };
}
function enumsOf(book, module, source) {
    const sheet = book.getWorksheet('__enums'),
        output = [];
    if (!sheet) return output;
    if (['enum', 'member', 'value', 'comment', 'public'].some((name, i) => sheet.getCell(1, i + 1).value !== name))
        throw Error(`${source}: __enums 表头错误`);
    for (let n = 2; n <= sheet.rowCount; n++) {
        const [name, member, value, comment, publicValue] = [1, 2, 3, 4, 5].map((i) => cellValue(sheet.getCell(n, i)));
        if (!name && !member && value === null) continue;
        if (
            !identifier(name) ||
            !identifier(member) ||
            !['string', 'number'].includes(typeof value) ||
            (typeof value === 'number' && !Number.isSafeInteger(value))
        )
            throw Error(`${source}: __enums 第 ${n} 行定义无效`);
        let enumeration = output.find((item) => item.name === name);
        const isPublic = bool(publicValue, false);
        if (!enumeration)
            output.push(
                (enumeration = { id: `${module}.${name}`, module, name, public: isPublic, members: {}, comments: {} }),
            );
        if (
            enumeration.public !== isPublic ||
            member in enumeration.members ||
            Object.values(enumeration.members).includes(value) ||
            Object.values(enumeration.members).some((existing) => typeof existing !== typeof value)
        )
            throw Error(`${source}: 枚举 ${name} 重复、类型混用或 public 不一致`);
        enumeration.members[member] = value;
        enumeration.comments[member] = text(comment);
    }
    return output;
}
export async function readWorkbook(root, source) {
    const target = await safePath(root, source);
    if (
        !source.replaceAll('\\', '/').startsWith('config-source/') ||
        !source.endsWith('.xlsx') ||
        source.split('/').pop().startsWith('~$')
    )
        throw Error('请选择 config-source 内的 XLSX 工作簿');
    const bytes = await readFile(target),
        book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const config = parseConfig(book, source);
    const sheets = book.worksheets
        .filter((sheet) => !sheet.name.startsWith('__'))
        .map((sheet) => ({
            name: sheet.name,
            fields: sheet
                .getRow(1)
                .values.slice(1)
                .filter((value) => typeof value === 'string' && !value.startsWith('#')),
        }));
    return { source, hash: hash(bytes), config, sheets, enums: enumsOf(book, config.module, source), book };
}
export async function workbookSources(root, { tolerant = false } = {}) {
    const workbooks = [],
        diagnostics = [],
        pending = [];
    let legacy = { tables: [] };
    try {
        legacy = await json(resolve(root, 'config-source/tables.json'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const target of (await files(resolve(root, 'config-source'), '.xlsx')).sort()) {
        if (target.split(/[\\/]/).pop().startsWith('~$')) continue;
        const source = relative(root, target).replaceAll('\\', '/');
        let item;
        try {
            item = await readWorkbook(root, source);
        } catch (error) {
            if (legacy.tables.some((table) => table.source === source) && error.message.includes('缺少 __config'))
                continue;
            pending.push({ source, error });
            continue;
        }
        workbooks.push(item);
    }
    const auxiliary = new Set(
        workbooks.flatMap((item) => item.config.inputs ?? []).map((input) => resolve(root, input).toLowerCase()),
    );
    for (const { source, error } of pending) {
        if (auxiliary.has(resolve(root, source).toLowerCase()) && error.message.includes('缺少 __config')) continue;
        if (!tolerant) throw error;
        diagnostics.push({ source, message: error.message });
    }
    const tables = [],
        enums = new Map();
    for (const item of workbooks) {
        if (!item.config.enabled) continue;
        for (const enumeration of item.enums) {
            if (enums.has(enumeration.id)) throw Error(`重复枚举 ${enumeration.id}`);
            enums.set(enumeration.id, enumeration);
        }
        for (const table of item.config.tables) {
            if (!table.enabled) continue;
            if (!item.sheets.some((sheet) => sheet.name === table.sheet))
                throw Error(`${item.source}: Sheet 不存在：${table.sheet}`);
            tables.push({
                ...table,
                id: table.id.includes('.') ? table.id : `${item.config.module}.${table.id}`,
                source: item.source,
                bundle: table.bundle ?? item.config.bundle,
                formatVersion: workbookVersion,
                workbookHash: item.hash,
                inputs: item.config.inputs,
            });
            if (tables.at(-1).id.split('.')[0] !== item.config.module) throw Error(`${item.source}: 表归属不能跨模块`);
        }
    }
    // Legacy input exists only until an explicit migration; never silently merge two authorities.
    for (const table of legacy.tables) {
        if (tables.some((item) => item.id === table.id)) throw Error(`新旧配置来源重复：${table.id}，请完成迁移`);
        tables.push({ ...table, formatVersion: 1 });
    }
    return { tables, enums, workbooks, diagnostics };
}
export async function createWorkbook(
    root,
    source,
    config,
    data = [
        ['id', 'name', 'enabled'],
        ['int', 'string', 'bool'],
        [null, null, true],
        ['编号', '名称', '启用'],
        [1, '示例', true],
    ],
    enums = [],
) {
    const target = await safePath(root, source),
        book = new ExcelJS.Workbook();
    book.creator = 'YZForge';
    book.addWorksheet('__config').addRows(configRows(config));
    const enumSheet = book.addWorksheet('__enums');
    enumSheet.addRows([['enum', 'member', 'value', 'comment', 'public'], ...enums]);
    for (const table of config.tables)
        book.addWorksheet(table.sheet).addRows(Array.isArray(data) ? data : data[table.sheet]);
    for (const sheet of book.worksheets) {
        sheet.views = [{ state: 'frozen', ySplit: sheet.name.startsWith('__') ? 1 : 4 }];
        sheet.getRow(1).font = { bold: true };
        sheet.columns.forEach((column) => {
            column.width = 22;
        });
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await book.xlsx.writeBuffer()), { flag: 'wx' });
    return readWorkbook(root, source);
}
function elements(xml, localName) {
    const result = [],
        parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', (tag) => {
        if (tag.local === localName)
            result.push(Object.fromEntries(Object.values(tag.attributes).map((a) => [a.name, a.value])));
    });
    parser.write(xml).close();
    return result;
}
const escapeXML = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function sheetData(rows) {
    return `<sheetData>${rows
        .map(
            (row, r) =>
                `<row r="${r + 1}">${row
                    .map((value, c) => {
                        if (value === null || value === undefined) return '';
                        const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
                        return typeof value === 'boolean'
                            ? `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
                            : typeof value === 'number'
                              ? `<c r="${ref}"><v>${value}</v></c>`
                              : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXML(value)}</t></is></c>`;
                    })
                    .join('')}</row>`,
        )
        .join('')}</sheetData>`;
}
/** Only the existing __config worksheet XML changes; every unrelated ZIP payload is verified byte for byte. */
export async function writeWorkbookConfig(root, source, config, expectedHash) {
    return withProjectLock(root, () => writeWorkbookConfigLocked(root, source, config, expectedHash));
}
async function writeWorkbookConfigLocked(root, source, config, expectedHash) {
    const target = await safePath(root, source),
        current = await readWorkbook(root, source);
    if (!expectedHash || current.hash !== expectedHash) throw Error(`${source}: 文件已变化，请刷新预览`);
    const bytes = await readFile(target),
        zip = await JSZip.loadAsync(bytes);
    const sheets = elements(await zip.file('xl/workbook.xml').async('string'), 'sheet');
    const sheet = sheets.find((item) => item.name === '__config');
    const relation = elements(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'Relationship').find(
        (item) => item.Id === sheet?.['r:id'],
    );
    if (!relation || relation.TargetMode === 'External') throw Error('不支持的工作簿配置页关系');
    const entry = relation.Target.startsWith('/')
        ? relation.Target.slice(1)
        : posix.normalize(posix.join('xl', relation.Target));
    if (!entry.startsWith('xl/worksheets/') || !zip.file(entry)) throw Error('不支持的配置页路径');
    const original = await zip.file(entry).async('string');
    if (
        /<(?:\w+:)?(?:mergeCells|tableParts|drawing|hyperlinks)\b/.test(original) ||
        !/<sheetData(?:\s[^>]*)?>[\s\S]*<\/sheetData>/.test(original)
    )
        throw Error('__config 含不支持安全写回的表格、合并或绘图结构');
    const rows = configRows(config);
    const changed = original
        .replace(/<sheetData(?:\s[^>]*)?>[\s\S]*?<\/sheetData>/, () => sheetData(rows))
        .replace(/<dimension\s+ref="[^"]*"\s*\/>/, `<dimension ref="A1:J${rows.length}"/>`);
    zip.file(entry, changed);
    const next = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const verification = await JSZip.loadAsync(next),
        before = await JSZip.loadAsync(bytes);
    for (const name of Object.keys(before.files))
        if (name !== entry && !before.files[name].dir) {
            if (
                !Buffer.from(await before.file(name).async('nodebuffer')).equals(
                    await verification.file(name).async('nodebuffer'),
                )
            )
                throw Error(`工作簿无关内容发生变化：${name}`);
        }
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(next);
    parseConfig(parsed, source);
    const backup = await safePath(root, `.yzforge/workbook-history/${Date.now()}-${randomUUID()}.xlsx`);
    await mkdir(dirname(backup), { recursive: true });
    await copyFile(target, backup);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, next, { flag: 'wx' });
    if (hash(await readFile(target)) !== expectedHash) throw Error(`${source}: 保存期间源文件改变，保留临时文件及备份`);
    await rename(temporary, target);
    const result = await readWorkbook(root, source);
    return { source, hash: result.hash, config: result.config, backup: relative(root, backup).replaceAll('\\', '/') };
}

export async function formulaFingerprint(root, source, inputs = []) {
    const records = [];
    for (const file of [...new Set([source, ...inputs])].sort()) {
        if (!file.startsWith('config-source/') || !file.endsWith('.xlsx'))
            throw Error(`计算输入必须为项目内 XLSX：${file}`);
        records.push([file, hash(await readFile(await safePath(root, file)))]);
    }
    return hash(JSON.stringify({ version: workbookVersion, exporter: 'yzforge-xlsx-2', inputs: records }));
}
export async function formulaResults(root, mapping, preview = false) {
    if (preview) return null;
    const fingerprint = await formulaFingerprint(root, mapping.source, mapping.inputs);
    const target = resolve(root, 'project-settings/generated/formulas', `${fingerprint}.json`);
    try {
        const snapshot = await json(target);
        if (snapshot.fingerprint !== fingerprint || !snapshot.engine || !snapshot.values) throw Error('公式快照无效');
        return snapshot.values;
    } catch (error) {
        if (error.code === 'ENOENT')
            throw Error(`${mapping.source}: 公式结果未验证或已陈旧，请在面板重算后导出`, { cause: error });
        throw error;
    }
}
