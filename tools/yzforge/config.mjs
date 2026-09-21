import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { digest, identifier, pascal, safePath } from './project.mjs';
import { workbookSources, formulaResults } from './workbooks.mjs';

// 表格说明写入 TSDoc 前按单行处理，避免说明中的注释结束符改变生成脚本。
const commentText = (value) =>
    String(value)
        .replace(/\*\//g, '* /')
        .replace(/[\r\n\u2028\u2029]+/g, ' ');

/** RFC4180-style CSV parser: quoted commas/newlines and doubled quotes are preserved. */
export function parseCSV(input) {
    const rows = [],
        row = [];
    let value = '',
        quoted = false,
        closed = false;
    input = input.replace(/^\uFEFF/, '');
    for (let i = 0; i <= input.length; i++) {
        const char = input[i];
        if (quoted) {
            if (char === '"' && input[i + 1] === '"') {
                value += '"';
                i++;
            } else if (char === '"') {
                quoted = false;
                closed = true;
            } else if (char === undefined) throw Error('Unterminated CSV quote');
            else value += char;
        } else if (char === '"' && value === '' && !closed) quoted = true;
        else if (char === ',' || char === '\n' || char === '\r' || char === undefined) {
            row.push(value);
            value = '';
            closed = false;
            if (char !== ',') {
                rows.push([...row]);
                row.length = 0;
                if (char === '\r' && input[i + 1] === '\n') i++;
            }
        } else {
            if (closed || char === '"') throw Error('Unexpected character after CSV quote');
            value += char;
        }
    }
    return rows;
}
export function fieldType(text, context) {
    if (typeof text !== 'string') throw Error('Field type must be text');
    let source = text.trim(),
        nullable = false,
        array = false;
    if (source.endsWith('?')) {
        nullable = true;
        source = source.slice(0, -1);
    }
    if (source.endsWith('[]')) {
        array = true;
        source = source.slice(0, -2);
    }
    let schema;
    if (['int', 'float', 'bool', 'string', 'vec2', 'vec3', 'color'].includes(source)) schema = { kind: source };
    else {
        const match = /^(enum|ref|asset)<([^<>]+)>$/.exec(source);
        if (!match) throw Error(`Unsupported field type: ${text}`);
        if (match[1] === 'enum') {
            if (context?.version === 2) {
                const id = match[2].includes('.') ? match[2] : `${context.module}.${match[2]}`;
                const enumeration = context.enums.get(id);
                if (!enumeration || (enumeration.module !== context.module && !enumeration.public))
                    throw Error(`Unknown or private named enum: ${id}`);
                schema = { kind: 'enum', values: Object.values(enumeration.members), enumId: id };
            } else {
                const values = match[2].split(',').map((value) => value.trim());
                if (values.some((value) => !value) || new Set(values).size !== values.length)
                    throw Error(`Invalid enum: ${text}`);
                schema = { kind: 'enum', values };
            }
        } else if (match[1] === 'asset') {
            if (
                ![
                    'SpriteFrame',
                    'Prefab',
                    'Texture2D',
                    'ImageAsset',
                    'AudioClip',
                    'JsonAsset',
                    'TextAsset',
                    'Material',
                    'SpriteAtlas',
                    'Font',
                    'SceneAsset',
                ].includes(match[2])
            )
                throw Error(`Unsupported asset kind: ${text}`);
            schema = { kind: 'asset', assetType: match[2] };
        } else schema = { kind: 'ref', target: match[2] };
    }
    if (array) schema = { kind: 'array', element: schema };
    if (nullable) schema.nullable = true;
    return schema;
}
const empty = (value) => value === '' || value === null || value === undefined;
const strictNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
        return Number(value);
    throw Error(`Invalid number: ${value}`);
};
export function convert(value, schema, context) {
    if (value === null && schema.nullable) return null;
    switch (schema.kind) {
        case 'int':
        case 'float':
            return strictNumber(value);
        case 'string':
            if (typeof value !== 'string') throw Error('Text fields require text cells (format numeric IDs as text)');
            return value;
        case 'enum':
            return typeof schema.values?.[0] === 'number'
                ? strictNumber(value)
                : convert(value, { kind: 'string' }, context);
        case 'bool':
            if ([true, 'true', '1', 1].includes(value)) return true;
            if ([false, 'false', '0', 0].includes(value)) return false;
            throw Error('Use true/false or 1/0');
        case 'array': {
            const parsed = typeof value === 'string' ? JSON.parse(value) : value;
            if (!Array.isArray(parsed)) throw Error('Expected a JSON array');
            return parsed.map((item) => convert(item, schema.element, context));
        }
        case 'ref':
            return schema.keyKind === 'int' ? strictNumber(value) : convert(value, { kind: 'string' }, context);
        case 'asset':
            return context.asset(value, schema.assetType);
        case 'vec2':
        case 'vec3': {
            const parsed = typeof value === 'string' ? JSON.parse(value) : value;
            const names = schema.kind === 'vec2' ? ['x', 'y'] : ['x', 'y', 'z'];
            if (!Array.isArray(parsed) || parsed.length !== names.length)
                throw Error(`Expected ${names.length} vector numbers`);
            return Object.fromEntries(names.map((name, index) => [name, strictNumber(parsed[index])]));
        }
        case 'color': {
            if (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))
                throw Error('Use #RRGGBB or #RRGGBBAA');
            const hex = value.length === 7 ? `${value}FF` : value;
            return Object.fromEntries(
                ['r', 'g', 'b', 'a'].map((name, index) => [
                    name,
                    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16),
                ]),
            );
        }
        default:
            throw Error(`Unsupported field kind ${schema.kind}`);
    }
}
async function readRows(root, mapping, preview) {
    const path = await safePath(root, mapping.source);
    if (!mapping.source.replaceAll('\\', '/').startsWith('config-source/'))
        throw Error('Table source must be under config-source');
    if (extname(path).toLowerCase() === '.csv') return parseCSV(await readFile(path, 'utf8'));
    if (extname(path).toLowerCase() !== '.xlsx') throw Error('Only .xlsx and UTF-8 .csv are supported');
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(path);
    const sheet = mapping.sheet ? book.getWorksheet(mapping.sheet) : book.worksheets[0];
    if (!sheet) throw Error(`Missing sheet ${mapping.sheet}`);
    const result = [];
    let verified;
    for (let r = 1; r <= sheet.rowCount; r++) {
        const row = [];
        for (let c = 1; c <= sheet.columnCount; c++) {
            const cell = sheet.getCell(r, c);
            if (cell.isMerged && r >= 5)
                throw Error(`${mapping.source}:${sheet.name}!${cell.address}: merged data cells are not supported`);
            if (cell.type === ExcelJS.ValueType.Formula) {
                if (mapping.formatVersion !== 2)
                    throw Error(
                        `${mapping.source}:${sheet.name}!${cell.address}: migrate legacy formulas to XLSX v2 first`,
                    );
                if (r < 5 || sheet.name.startsWith('__'))
                    throw Error(
                        `${mapping.source}:${sheet.name}!${cell.address}: formulas are only allowed in data cells`,
                    );
                if (verified === undefined) verified = await formulaResults(root, mapping, preview);
                const value = preview ? cell.result : verified[`${sheet.name}!${cell.address}`];
                if (value === undefined || value === null || typeof value === 'object')
                    throw Error(`${mapping.source}:${sheet.name}!${cell.address}: formula result missing or invalid`);
                row.push(value);
                continue;
            }
            if (cell.value instanceof Date)
                throw Error(
                    `${mapping.source}:${sheet.name}!${cell.address}: use literal values and explicit ISO text`,
                );
            if (typeof cell.value === 'object' && cell.value !== null)
                throw Error(
                    `${mapping.source}:${sheet.name}!${cell.address}: unsupported rich/formula cell; use plain values`,
                );
            row.push(cell.value);
        }
        result.push(row);
    }
    return result;
}
function typeScript(schema) {
    let type;
    switch (schema.kind) {
        case 'int':
        case 'float':
            type = 'number';
            break;
        case 'bool':
            type = 'boolean';
            break;
        case 'string':
            type = 'string';
            break;
        case 'enum':
            type = schema.enumId
                ? schema.enumId.replaceAll('.', '_')
                : schema.values.map((value) => JSON.stringify(value)).join(' | ');
            break;
        case 'ref':
            type = schema.keyKind === 'int' ? 'number' : 'string';
            break;
        case 'array':
            type = `readonly (${typeScript(schema.element)})[]`;
            break;
        case 'asset':
            type = `AssetKey<${JSON.stringify(schema.assetType)}>`;
            break;
        case 'vec2':
            type = '{ readonly x: number; readonly y: number }';
            break;
        case 'vec3':
            type = '{ readonly x: number; readonly y: number; readonly z: number }';
            break;
        case 'color':
            type = '{ readonly r: number; readonly g: number; readonly b: number; readonly a: number }';
            break;
    }
    return schema.nullable ? `${type} | null` : type;
}
export async function compileTables(root, projectModules, runtime, registry, options = {}) {
    const source = options.sources ?? (await workbookSources(root));
    const definitions = new Map(),
        tables = [],
        output = {},
        routes = {},
        reports = [];
    const targets = new Map(projectModules.map((module) => [module.id, module]));
    for (const mapping of source.tables) {
        if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(mapping.id) || definitions.has(mapping.id))
            throw Error(`Invalid or duplicate tableId ${mapping.id}`);
        const module = targets.get(mapping.id.split('.')[0]);
        if (!module) throw Error(`Unknown table module ${mapping.id}`);
        const rows = await readRows(root, mapping, options.preview === true);
        if (rows.length < 4) throw Error(`${mapping.source}: four header rows are required`);
        const fields = {},
            columns = [];
        rows[0].forEach((name, index) => {
            if (empty(name) || String(name).startsWith('#')) return;
            if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || name in fields)
                throw Error(`${mapping.source}: invalid/duplicate column ${name}`);
            const schema = fieldType(rows[1]?.[index], {
                version: mapping.formatVersion,
                module: module.id,
                enums: source.enums,
            });
            for (const [rule, value] of Object.entries(mapping.constraints?.[name] ?? {})) {
                if (!['min', 'max', 'minLength', 'maxLength', 'format'].includes(rule))
                    throw Error(`${mapping.id}.${name}: unsupported constraint ${rule}`);
                if (
                    rule !== 'format' &&
                    (!Number.isFinite(value) || (/Length$/.test(rule) && (!Number.isSafeInteger(value) || value < 0)))
                )
                    throw Error(`${mapping.id}.${name}: invalid ${rule}`);
                if (rule === 'format' && !['date', 'date-time'].includes(value))
                    throw Error(`${mapping.id}.${name}: unsupported format`);
                if (
                    (['min', 'max'].includes(rule) && !['int', 'float'].includes(schema.kind)) ||
                    (['minLength', 'maxLength'].includes(rule) && !['string', 'array'].includes(schema.kind)) ||
                    (rule === 'format' && schema.kind !== 'string')
                )
                    throw Error(`${mapping.id}.${name}: ${rule} is not supported for ${schema.kind}`);
                schema[rule] = value;
            }
            fields[name] = schema;
            columns.push({
                name,
                index,
                schema,
                defaultValue: rows[2]?.[index],
                comment: String(rows[3]?.[index] ?? ''),
            });
        });
        for (const field of Object.keys(mapping.constraints || {}))
            if (!fields[field]) throw Error(`${mapping.id}: constraint targets an undeclared field ${field}`);
        const pk = mapping.primaryKey ?? 'id';
        if (!fields[pk] || !['int', 'string'].includes(fields[pk].kind) || fields[pk].nullable)
            throw Error(`${mapping.id}: primaryKey requires non-null int/string`);
        const definition = { id: mapping.id, primaryKey: pk, fields, indexes: mapping.indexes ?? {} };
        definitions.set(mapping.id, definition);
        tables.push({ mapping, module, rows, columns, definition, groups: new Map(), all: [] });
    }
    const bindRefs = (schema, module) => {
        if (schema.kind === 'array') return bindRefs(schema.element, module);
        if (schema.kind !== 'ref') return;
        schema.target = schema.target.includes('.') ? schema.target : `${module}.${schema.target}`;
        const target = definitions.get(schema.target);
        if (!target) throw Error(`Missing foreign table: ${schema.target}`);
        schema.keyKind = target.fields[target.primaryKey].kind;
    };
    for (const table of tables) {
        for (const schema of Object.values(table.definition.fields)) bindRefs(schema, table.module.id);
        table.definition.schemaHash = digest(table.definition);
        const { mapping, module, rows, columns, definition } = table;
        const targets = mapping.shards
            ? Object.values(mapping.shards.targets).filter(Boolean)
            : [mapping.bundle ?? 'default'];
        if (mapping.shards && !columns.some((column) => column.name === mapping.shards.field))
            throw Error(`${mapping.id}: shard routing field is not declared in the workbook`);
        for (const group of targets) {
            if (!module.bundles[group]) throw Error(`${mapping.id}: unknown bundle group ${group}`);
            table.groups.set(group, []);
        }
        const allIds = new Set();
        for (let position = 4; position < rows.length; position++) {
            const raw = rows[position];
            if (raw.every(empty)) continue;
            const group = mapping.shards
                ? mapping.shards.targets[
                      String(raw[columns.find((column) => column.name === mapping.shards.field)?.index])
                  ]
                : (mapping.bundle ?? 'default');
            if (group === null) continue; // Explicitly disabled shard; absent mapping is still an error.
            if (!table.groups.has(group)) throw Error(`${mapping.source}: row ${position + 1}: unmapped shard value`);
            const row = {};
            for (const column of columns) {
                let value = raw[column.index];
                if (empty(value)) value = column.defaultValue;
                if (empty(value)) {
                    if (column.schema.nullable) value = null;
                    else throw Error(`${mapping.source}: row ${position + 1}, ${column.name}: required value is empty`);
                }
                try {
                    row[column.name] = convert(value, column.schema, {
                        asset: (name, type) => {
                            const complete = typeof name === 'string' && name.split('/').length >= 4;
                            let key = runtime.logicalKey(name, type, complete ? undefined : `${module.id}/${group}`);
                            if (!complete && !String(name).includes('/')) {
                                const matches = [...registry].filter(
                                    ([id, entry]) =>
                                        id.startsWith(`${module.id}/${group}/`) &&
                                        entry.type === type &&
                                        id.split('/').pop() === name,
                                );
                                if (matches.length > 1)
                                    throw Error(
                                        `Ambiguous asset name ${name}: ${matches.map(([id]) => id).join(', ')}`,
                                    );
                                if (matches.length === 1) key = { id: matches[0][0], type };
                            }
                            if (!registry.has(key.id) || registry.get(key.id).type !== type)
                                throw Error(`Asset is not registered as ${type}: ${key.id}`);
                            return key;
                        },
                    });
                    runtime.validateValue(row[column.name], column.schema, column.name);
                } catch (error) {
                    throw Error(
                        `${mapping.source}:${mapping.sheet ?? ''}: row ${position + 1}, column ${column.index + 1} (${column.name}): ${error.message}`,
                        { cause: error },
                    );
                }
            }
            if (allIds.has(row[definition.primaryKey]))
                throw Error(`${mapping.id}: duplicate primary key across shards: ${row[definition.primaryKey]}`);
            allIds.add(row[definition.primaryKey]);
            table.groups.get(group).push(row);
            table.all.push({ row, group });
        }
    }
    const targetTable = new Map(tables.map((table) => [table.mapping.id, table]));
    const checkRef = (value, schema, own, group, field) => {
        if (value === null) return;
        if (schema.kind === 'array') {
            for (const item of value) checkRef(item, schema.element, own, group, field);
            return;
        }
        if (schema.kind !== 'ref') return;
        const target = targetTable.get(schema.target),
            match = target.all.find((item) => item.row[target.definition.primaryKey] === value);
        if (!match) throw Error(`${own.mapping.id}.${field}: missing foreign key ${schema.target}=${value}`);
        const soft = own.mapping.formatVersion === 2 || own.mapping.references?.[field]?.mode === 'soft';
        if (
            !soft &&
            match.group !== 'default' &&
            target.module.bundles[match.group].id !== own.module.bundles[group].id
        )
            throw Error(`${own.mapping.id}.${field}: strong foreign keys cannot cross sibling resource bundles`);
        if (
            own.mapping.formatVersion !== 2 &&
            target.module.id !== own.module.id &&
            target.module.id !== 'shared' &&
            !own.module.dependencies.includes(target.module.id)
        )
            throw Error(`${own.mapping.id}.${field}: declare module dependency on ${target.module.id}`);
    };
    for (const table of tables) {
        const { mapping, module, definition } = table;
        for (const { row, group } of table.all)
            for (const [name, schema] of Object.entries(definition.fields))
                checkRef(row[name], schema, table, group, name);
        const name = pascal(mapping.id.split('.')[1]);
        const generated = `${relative(root, module.directory).replaceAll('\\', '/')}/${module.layoutVersion === 2 ? (mapping.public ? 'contracts' : 'code') + '/' : ''}generated/config`;
        const framework = relative(resolve(root, generated), resolve(root, 'assets/framework')).replaceAll('\\', '/');
        const rowType = Object.entries(definition.fields)
            .map(([field, schema]) => {
                const comment = table.columns
                    .find((column) => column.name === field)
                    ?.comment.replace(/\*\//g, '* /')
                    .replace(/[\r\n]+/g, ' ');
                return `  /** ${commentText(comment || `${field} 字段`)}；${schema.nullable ? '允许 null' : '不可为空'}，加载后只读。 */\n  readonly ${field}: ${typeScript(schema)};`;
            })
            .join('\n');
        const indexes = Object.entries(definition.indexes)
            .map(
                ([id, index]) =>
                    `  /** ${commentText(index.field)} 字段的${index.unique ? '唯一' : '分组'}索引；table.by('${identifier(id)}', value) 始终返回只读行数组。 */\n  readonly ${identifier(id)}: ${typeScript(definition.fields[index.field])};`,
            )
            .join('\n');
        const usedEnums = new Set();
        const collectEnum = (schema) => {
            if (schema.enumId) usedEnums.add(schema.enumId);
            if (schema.element) collectEnum(schema.element);
        };
        Object.values(definition.fields).forEach(collectEnum);
        const enumImports = [];
        for (const id of usedEnums) {
            const enumeration = source.enums.get(id),
                owner = targets.get(enumeration.module);
            if (!owner || (mapping.public && !enumeration.public))
                throw Error(`Public table ${mapping.id} cannot expose private enum ${id}`);
            const enumPath = resolve(
                owner.directory,
                enumeration.public ? 'contracts/generated/enums' : 'code/generated/enums',
                `${enumeration.name}.ts`,
            );
            const importPath = relative(resolve(root, generated), enumPath).replaceAll('\\', '/').replace(/\.ts$/, '');
            enumImports.push(
                `import type { ${enumeration.name} as ${id.replaceAll('.', '_')} } from '${importPath.startsWith('.') ? importPath : './' + importPath}';`,
            );
        }
        output[`${generated}/${name}.types.ts`] =
            `// 由 XLSX 自动生成，请修改源工作簿中的字段类型与说明。\nimport type { AssetKey } from '${framework}/assets/asset-types';\n${enumImports.join('\n')}\n/** ${mapping.id} 的主键类型，对应字段 ${definition.primaryKey}；查询时不隐式转换字符串和数字。 */\nexport type ${name}Id = ${typeScript(definition.fields[definition.primaryKey])};\n/** ${mapping.id} 的单行结构。config.load 后的数据递归只读，不用于保存可变玩家状态。 */\nexport interface ${name}Row {\n${rowType}\n}\n/** ${mapping.id} 声明的索引及查询值类型，供 ConfigTable.by 推导参数。 */\nexport interface ${name}Indexes {\n${indexes}\n}\n`;
        output[`${generated}/${name}.table.ts`] =
            `// 自动生成的配置合同，JSON 数据行留在资源 Bundle。\nimport { defineTable } from '${framework}/config/schema';\nimport type { ${name}Row, ${name}Id, ${name}Indexes } from './${name}.types';\n/**\n * ${mapping.id} 的轻量加载合同，import 本常量不会加载数据。\n * 使用 ctx.config.load(${name}Table, owner) 按需取得只读表；多分片时用选项选择 bundle。\n * owner 决定表句柄使用期限，界面临时数据传 show.scope。\n * @example\n * const table = await this.ctx.config.load(${name}Table, show.scope);\n * const rows = table.all(); // 按主键排序的只读数据行\n */\nexport const ${name}Table = defineTable<${name}Row, ${name}Id, ${name}Indexes>(${JSON.stringify(definition, null, 2)});\n`;
        routes[mapping.id] = [];
        for (const [group, rows] of table.groups) {
            rows.sort((a, b) => {
                const x = a[definition.primaryKey],
                    y = b[definition.primaryKey];
                return typeof x === 'number' ? x - y : x < y ? -1 : x > y ? 1 : 0;
            });
            const dataRevision = digest(rows),
                envelope = {
                    formatVersion: 1,
                    tableId: mapping.id,
                    schemaHash: definition.schemaHash,
                    dataRevision,
                    rows,
                };
            runtime.parseTable(envelope, definition, dataRevision);
            const bundle = module.bundles[group],
                path = `${module.layoutVersion === 2 ? 'dynamic/' : ''}config/${mapping.id.split('.')[1]}`;
            const target = relative(root, resolve(module.directory, bundle.root, `${path}.json`)).replaceAll('\\', '/');
            if (Object.keys(output).some((key) => key.toLowerCase() === target.toLowerCase()))
                throw Error(`Output path collision: ${target}`);
            output[target] = JSON.stringify(envelope, null, 2) + '\n';
            routes[mapping.id].push({ bundle: bundle.id, path, dataRevision });
        }
        reports.push({
            id: mapping.id,
            source: mapping.source,
            rows: table.all.length,
            shards: [...table.groups.keys()],
        });
    }
    for (const module of projectModules) {
        const own = tables.filter((table) => table.module.id === module.id);
        if (!own.length) continue;
        const directory = `${relative(root, module.directory).replaceAll('\\', '/')}/${module.layoutVersion === 2 ? 'code/' : ''}generated/config`;
        output[`${directory}/tables.ts`] =
            '// 自动生成的配置表引用集合，不包含 JSON 数据行。\n' +
            own
                .map((table) => {
                    const name = pascal(table.mapping.id.split('.')[1]);
                    const prefix =
                        module.layoutVersion === 2 && table.mapping.public
                            ? '../../../contracts/generated/config/'
                            : './';
                    return `import { ${name}Table } from '${prefix}${name}.table';`;
                })
                .join('\n') +
            `\n/** ${module.id} 模块的表合同集合；可传给 config.loadMany，实际 JSON 按需加载。 */\nexport const ${pascal(module.id)}Tables = {\n` +
            own
                .map((table) => {
                    const id = table.mapping.id.split('.')[1];
                    return `  /** ${table.mapping.id} 的加载合同；用 config.load 或 loadMany 取得可查询的数据。 */\n  ${identifier(id)}: ${pascal(id)}Table,`;
                })
                .join('\n') +
            '\n} as const;\n';
    }
    for (const enumeration of source.enums.values()) {
        const owner = targets.get(enumeration.module);
        if (!owner) throw Error(`Unknown enum module ${enumeration.module}`);
        const directory = relative(
            root,
            resolve(owner.directory, enumeration.public ? 'contracts/generated/enums' : 'code/generated/enums'),
        ).replaceAll('\\', '/');
        output[`${directory}/${enumeration.name}.ts`] =
            `// 根据 XLSX 的 __enums 自动生成，成员值属于稳定数据合同。\n/** ${enumeration.id} 的命名枚举值，可在表字段类型 enum<${enumeration.name}> 中使用；不加载表数据。 */\nexport const ${enumeration.name} = {\n${Object.entries(
                enumeration.members,
            )
                .map(
                    ([member, value]) =>
                        `  /** ${commentText(enumeration.comments?.[member] || `${enumeration.name}.${member}`)}；配置中实际保存 ${commentText(JSON.stringify(value))}。 */\n  ${JSON.stringify(member)}: ${JSON.stringify(value)},`,
                )
                .join(
                    '\n',
                )}\n} as const;\n/** ${enumeration.name} 所有成员值的联合类型，与上方同名值对象分别用于类型声明和取值。 */\nexport type ${enumeration.name} = (typeof ${enumeration.name})[keyof typeof ${enumeration.name}];\n`;
    }
    return { output, routes, reports, previewOnly: options.preview === true };
}
