import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';
import { digest, identifier, safePath } from '../project/project.mjs';
const empty = (value) => value === null || value === undefined || value === '';
const keyPattern = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$/;
const nameOf = (key) => identifier(key.replace(/[._]/g, '-'));

/** 独立工作簿类型；不经过普通配置表的字符串裁剪、类型行或公式计算。 */
export function parseLocalizationWorkbook(book, source) {
    const meta = book.getWorksheet('__localization');
    if (
        !meta ||
        meta.getCell('A1').value !== 'formatVersion' ||
        meta.getCell('B1').value !== 2 ||
        book.getWorksheet('__config')
    )
        throw Error(`${source}: 多语言工作簿声明无效或与普通配置表混用`);
    for (const sheet of book.worksheets)
        if (sheet.name !== 'texts' && !sheet.name.startsWith('__'))
            throw Error(`${source}: 不支持的多语言工作表 ${sheet.name}，文案应放在 texts 页`);
    const output = { texts: [], locales: [] };
    for (const [sheetName, headers] of [['texts', ['key', 'comment']]]) {
        const sheet = book.getWorksheet(sheetName);
        if (!sheet) throw Error(`${source}: 缺少 ${sheetName} 页`);
        // ExcelJS 的 values 可能是稀疏数组，逐列读取才能发现中间缺失的语言表头。
        const head = Array.from({ length: sheet.getRow(1).cellCount }, (_, i) => sheet.getCell(1, i + 1).value);
        if (headers.some((name, i) => head[i] !== name)) throw Error(`${source}: ${sheetName} 表头无效`);
        const locales = head.slice(headers.length);
        if (!locales.length) throw Error(`${source}: ${sheetName} 缺少语言列`);
        for (const [i, name] of locales.entries()) {
            if (typeof name !== 'string' || !name.trim() || name !== name.trim())
                throw Error(
                    `${source}: ${sheetName}!${sheet.getCell(1, headers.length + i + 1).address} 语言表头为空或无效`,
                );
        }
        if (new Set(locales).size !== locales.length) throw Error(`${source}: ${sheetName} 语言列重复`);
        output.locales = locales;
        const keys = new Set(),
            names = new Set();
        for (let n = 2; n <= sheet.rowCount; n++) {
            const cells = Array.from(
                { length: Math.max(head.length, sheet.getRow(n).cellCount) },
                (_, i) => sheet.getCell(n, i + 1).value,
            );
            if (cells.every(empty)) continue;
            if (cells.slice(head.length).some((value) => !empty(value)))
                throw Error(`${source}: ${sheetName}:${n} 存在无表头数据`);
            const key = cells[0];
            if (typeof key !== 'string' || !keyPattern.test(key) || keys.has(key))
                throw Error(`${source}: ${sheetName}:${n} 文案键重复或无效`);
            const name = nameOf(key);
            if (names.has(name)) throw Error(`${source}: 生成标识冲突 ${name}`);
            keys.add(key);
            names.add(name);
            const values = {};
            for (const [i, locale] of locales.entries()) {
                const value = cells[headers.length + i];
                if (empty(value)) continue;
                if (typeof value !== 'string')
                    throw Error(`${source}: ${sheetName}:${n}/${locale} 必须为纯文本，数字和公式请转成文本`);
                // 空单元格表示缺译；显式空串与字面标记各有独立写法。
                values[locale] = value === '#EMPTY' ? '' : value.startsWith('##') ? value.slice(1) : value;
            }
            output.texts.push({ key, name, values });
        }
    }
    return output;
}
export async function renderLocalizationWorkbook(source, locales, rows) {
    if (!source.startsWith('config-source/') || !source.endsWith('.xlsx'))
        throw Error('多语言源文件必须位于 config-source');
    if (Object.keys(rows ?? {}).some((key) => key !== 'texts')) throw Error('多语言工作簿只接受 texts 文案');
    const book = new ExcelJS.Workbook();
    book.creator = 'YZForge';
    book.created = book.modified = new Date(0);
    book.addWorksheet('__localization').addRows([['formatVersion', 2]]);
    book.addWorksheet('__help').addRows([
        ['空单元格表示缺译；#EMPTY 表示有意留空；##EMPTY 输出字面 #EMPTY。'],
        ['保留空格和换行，禁止公式或数字值。参数使用 {name}，两种语言参数必须一致。'],
        ['这里只维护文案；资源按各语言 dynamic 下相同相对路径自动对应，key 不含扩展名。'],
        ['dynamic/fonts/default 为可选的语言默认字体；文案回退时使用默认语言的字体。'],
        ['工作簿归属由模块资源包声明管理，新增语言由工作台安全追加 texts 语言列。'],
    ]);
    book.addWorksheet('texts').addRows([
        ['key', 'comment', ...locales],
        ...(rows?.texts ?? [['sample.greeting', '示例文案', '你好', ...locales.slice(1).map(() => null)]]),
    ]);
    for (const sheet of book.worksheets) {
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.getRow(1).font = { bold: true };
        sheet.columns.forEach((column) => {
            column.width = 32;
        });
    }
    parseLocalizationWorkbook(book, source);
    return Buffer.from(await book.xlsx.writeBuffer());
}
export async function createLocalizationWorkbook(root, source, locales, rows) {
    const bytes = await renderLocalizationWorkbook(source, locales, rows);
    const target = await safePath(root, source);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
    return { source, hash: digest(await readFile(target)) };
}
