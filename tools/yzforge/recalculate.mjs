import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { readWorkbook, formulaFingerprint } from './workbooks.mjs';
import { safePath } from './project.mjs';
const execute = promisify(execFile);

/** Recalculate owned copies with desktop Excel. Neither source workbooks nor the user's Excel session are saved. */
export async function recalculate(root, source) {
    const workbook = await readWorkbook(root, source);
    if (process.platform !== 'win32') throw Error('当前公式适配器需要 Windows 桌面 Excel；普通无公式 XLSX 可直接导出');
    const sources = [...new Set([source, ...workbook.config.inputs])];
    const fingerprint = await formulaFingerprint(root, source, workbook.config.inputs);
    const directory = await safePath(root, `.yzforge/recalculate/${randomUUID()}`);
    const entries = [],
        names = new Set();
    for (const input of sources) {
        const name = basename(input).toLowerCase();
        if (names.has(name)) throw Error('Excel 不支持同时打开同名工作簿，请重命名输入工作簿');
        names.add(name);
        const original = await safePath(root, input),
            bytes = await readFile(original),
            zip = await JSZip.loadAsync(bytes);
        if (
            Object.keys(zip.files).some((name) =>
                /vbaProject|connections\.xml|queryTables\/|xl\/macrosheets\//i.test(name),
            )
        )
            throw Error(`${input}: 配置重算不支持宏、外部查询或数据连接`);
        for (const file of Object.values(zip.files).filter((file) => /^xl\/worksheets\/.*\.xml$/.test(file.name))) {
            const xml = await file.async('string');
            if (
                /<f(?:\s[^>]*)?>[^<]*(?:WEBSERVICE|RTD|HYPERLINK|NOW|TODAY|RAND|RANDBETWEEN|CELL|INFO|INDIRECT)\s*\(/i.test(
                    xml,
                )
            )
                throw Error(`${input}: 配置公式不能依赖网络、系统环境或易变时间/随机值`);
        }
        const copy = resolve(directory, basename(input));
        entries.push({ original, copy });
    }
    await mkdir(directory, { recursive: true });
    for (const entry of entries) await copyFile(entry.original, entry.copy);
    const job = resolve(directory, 'job.json'),
        output = resolve(directory, 'result.json');
    await writeFile(job, JSON.stringify({ directory, entries, target: entries[0].copy, output }));
    const script = fileURLToPath(new URL('./recalculate-excel.ps1', import.meta.url));
    try {
        await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-JobFile', job], {
            windowsHide: true,
            timeout: 110000,
            maxBuffer: 1024 * 1024,
        });
    } catch (error) {
        throw Error(`公式重算未完成，请确认已安装桌面 Excel。源工作簿未修改。${error.stderr || error.message}`, {
            cause: error,
        });
    }
    const result = JSON.parse((await readFile(output, 'utf8')).replace(/^\uFEFF/, ''));
    if ((await formulaFingerprint(root, source, workbook.config.inputs)) !== fingerprint)
        throw Error('重算期间输入已变化，请重新计算');
    if (!result.engine?.startsWith('Microsoft Excel ') || !result.values) throw Error('计算引擎结果无效');
    const target = await safePath(root, `project-settings/generated/formulas/${fingerprint}.json`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
        target,
        JSON.stringify({ formatVersion: 1, fingerprint, source, inputs: workbook.config.inputs, ...result }, null, 2) +
            '\n',
    );
    return { source, engine: result.engine, fingerprint, formulas: Object.keys(result.values).length };
}
