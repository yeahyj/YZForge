import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { digest, identifier, pascal, safePath } from './project.mjs';
import settingsTools from './settings.cjs';

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const empty = (value) => value === null || value === undefined || value === '';
const keyPattern = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$/;
const parameterPattern = /\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g;
const kinds = [
    'Prefab',
    'SpriteFrame',
    'Texture2D',
    'ImageAsset',
    'AudioClip',
    'JsonAsset',
    'TextAsset',
    'Material',
    'SpriteAtlas',
    'Font',
    'SceneAsset',
];
const forward = (path) => path.replaceAll('\\', '/');
const parameters = (text) =>
    [...new Set([...text.matchAll(parameterPattern)].map((match) => match[1]).filter(Boolean))].sort();
const nameOf = (key) => identifier(key.replace(/[._]/g, '-'));

/** 独立工作簿类型；不经过普通配置表的字符串裁剪、类型行或公式计算。 */
export function parseLocalizationWorkbook(book, source) {
    const meta = book.getWorksheet('__localization');
    if (
        !meta ||
        meta.getCell('A1').value !== 'formatVersion' ||
        meta.getCell('B1').value !== 1 ||
        book.getWorksheet('__config')
    )
        throw Error(`${source}: 多语言工作簿声明无效或与普通配置表混用`);
    const output = { texts: [], assets: [], locales: [] };
    for (const [sheetName, headers] of [
        ['texts', ['key', 'comment']],
        ['assets', ['key', 'type', 'comment']],
    ]) {
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
        if (sheetName === 'texts') output.locales = locales;
        else if (JSON.stringify(locales) !== JSON.stringify(output.locales))
            throw Error(`${source}: 文案和资源页语言列必须一致`);
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
            if (
                typeof key !== 'string' ||
                (!keyPattern.test(key) && !(sheetName === 'assets' && key === '$font')) ||
                keys.has(key)
            )
                throw Error(`${source}: ${sheetName}:${n} 文案/资源键重复或无效`);
            const name = key === '$font' ? '$font' : nameOf(key);
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
                values[locale] =
                    sheetName === 'texts' && value === '#EMPTY' ? '' : value.startsWith('##') ? value.slice(1) : value;
            }
            const type = sheetName === 'assets' ? cells[1] : undefined;
            if (sheetName === 'assets' && (!kinds.includes(type) || (key === '$font' && type !== 'Font')))
                throw Error(`${source}: ${sheetName}:${n} 资源类型无效`);
            output[sheetName].push({ key, name, type, values });
        }
    }
    return output;
}
export async function createLocalizationWorkbook(root, source, locales, rows) {
    if (!source.startsWith('config-source/') || !source.endsWith('.xlsx'))
        throw Error('多语言源文件必须位于 config-source');
    const book = new ExcelJS.Workbook();
    book.creator = 'YZForge';
    book.addWorksheet('__localization').addRows([['formatVersion', 1]]);
    book.addWorksheet('__help').addRows([
        ['空单元格表示缺译；#EMPTY 表示有意留空；##EMPTY 输出字面 #EMPTY。'],
        ['保留空格和换行，禁止公式或数字值。参数使用 {name}，两种语言参数必须一致。'],
        ['资源填写 Creator UUID（精灵帧含 @ 子资源 ID），或 @模块/包/类型/逻辑路径。'],
        ['assets 页 $font / Font 为该语言字体；文案回退时使用默认语言的字体。'],
        ['工作簿归属和存放位置由模块资源包声明统一管理。新增语言须在 texts 和 assets 页添加同名列。'],
    ]);
    book.addWorksheet('texts').addRows([
        ['key', 'comment', ...locales],
        ...(rows?.texts ?? [['sample.greeting', '示例文案', '你好', ...locales.slice(1).map(() => null)]]),
    ]);
    book.addWorksheet('assets').addRows([['key', 'type', 'comment', ...locales], ...(rows?.assets ?? [])]);
    for (const sheet of book.worksheets) {
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.getRow(1).font = { bold: true };
        sheet.columns.forEach((column) => {
            column.width = 32;
        });
    }
    parseLocalizationWorkbook(book, source);
    const target = await safePath(root, source);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await book.xlsx.writeBuffer()), { flag: 'wx' });
    return { source, hash: digest(await readFile(target)) };
}
export function localizationOutputPaths(root, modules) {
    return modules.flatMap((module) =>
        Object.entries(module.bundles).flatMap(([base, bundle]) =>
            Object.entries(bundle.localization?.variants ?? {}).map(([locale, group]) => {
                if (!module.bundles[group]) throw Error(`${module.id}/${base}: 语言存放包不存在 ${group}`);
                return forward(
                    relative(
                        root,
                        resolve(
                            module.directory,
                            module.bundles[group].root,
                            'dynamic/i18n',
                            base,
                            `${locale.toLowerCase()}.json`,
                        ),
                    ),
                );
            }),
        ),
    );
}
/** 基包是唯一归属源；专用语言包信息由这里反推，不写第二份声明。 */
export function localizationDeclarations(modules, settings) {
    const config = settingsTools.localizationSettings(settings);
    const declarations = [],
        owners = new Map(),
        sources = new Set();
    for (const module of modules)
        for (const [base, bundle] of Object.entries(module.bundles)) {
            const declaration = bundle.localization;
            if (!declaration) continue;
            if (!config) throw Error('请先在项目设置登记默认语言与支持语言');
            if (
                Object.keys(declaration).some((name) => !['source', 'variants'].includes(name)) ||
                typeof declaration.source !== 'string' ||
                !declaration.source.startsWith(`config-source/${module.id}/`) ||
                !declaration.source.endsWith('.xlsx') ||
                sources.has(declaration.source)
            )
                throw Error(`${module.id}/${base}: 工作簿归属无效或重复`);
            if (
                !declaration.variants ||
                typeof declaration.variants !== 'object' ||
                Array.isArray(declaration.variants) ||
                !has(declaration.variants, config.defaultLocale)
            )
                throw Error(`${module.id}/${base}: 必须配置默认语言存放位置`);
            sources.add(declaration.source);
            for (const [locale, group] of Object.entries(declaration.variants)) {
                if (!config.locales.includes(locale) || !module.bundles[group])
                    throw Error(`${module.id}/${base}: 语言或资源包未登记 ${locale}/${group}`);
                if (group !== base) {
                    const id = `${module.id}/${group}`;
                    if (owners.has(id) || module.bundles[group].localization)
                        throw Error(`${id}: 专用语言包只能属于一个基包的一种语言`);
                    owners.set(id, { base, locale, module: module.id });
                    if (Object.values(module.views ?? {}).some((view) => view.prefab?.startsWith(id + '/')))
                        throw Error(`${id}: 已有业务界面，不能作为专用语言包`);
                }
            }
            declarations.push({ module, base, bundle, ...declaration });
        }
    return { config, declarations, owners };
}
export function compileLocalization(root, modules, settings, sources, registry) {
    const { config, declarations, owners } = localizationDeclarations(modules, settings);
    const output = {},
        bundles = {},
        reports = [];
    const workbooks = new Map(
        (sources.localizationWorkbooks ?? []).filter((item) => item.config.enabled).map((item) => [item.source, item]),
    );
    for (const item of sources.tables) {
        const module = item.id.split('.')[0];
        for (const group of item.shards ? Object.values(item.shards.targets) : [item.bundle ?? 'default'])
            if (owners.has(`${module}/${group}`)) throw Error(`${module}/${group}: 普通配置表不能占用专用语言包`);
    }
    for (const declaration of declarations) {
        const { module, base, bundle, source, variants } = declaration;
        const workbook = workbooks.get(source);
        if (!workbook) throw Error(`${source}: 未找到有效多语言工作簿`);
        workbooks.delete(source);
        const data = workbook.localization,
            namespace = `${module.id}/${base}`;
        if (
            data.locales.some((locale) => !config.locales.includes(locale)) ||
            Object.keys(variants).some((locale) => !data.locales.includes(locale))
        )
            throw Error(`${source}: 语言列与项目/资源包声明不一致`);
        const defaults = config.defaultLocale;
        for (const row of [...data.texts, ...data.assets]) {
            if (!has(row.values, defaults)) throw Error(`${source}: 默认语言缺少 ${row.key}`);
            if (row.type) continue;
            const expected = parameters(row.values[defaults]).join(',');
            for (const [locale, value] of Object.entries(row.values))
                if (parameters(value).join(',') !== expected) throw Error(`${source}: ${row.key}/${locale} 参数不一致`);
        }
        const contract = digest({
            namespace,
            texts: data.texts.map((row) => [row.key, parameters(row.values[defaults])]).sort(),
            assets: data.assets
                .filter((row) => row.key !== '$font')
                .map((row) => [row.key, row.type])
                .sort(),
        });
        const definition = { namespace, contract, catalogs: {} };
        bundles[bundle.id] = definition;
        const resolveAsset = (value, type, locale) => {
            const entry = value.startsWith('@')
                ? [...registry].find(([id]) => id === value.slice(1))
                : [...registry].find(([, record]) => record.uuid === value && record.type === type);
            if (!entry || entry[1].type !== type) throw Error(`${source}: ${locale} 资源不存在或类型不符：${value}`);
            const [id] = entry,
                owner = owners.get(id.split('/').slice(0, 2).join('/'));
            if (owner && (owner.module !== module.id || owner.base !== base || owner.locale !== locale))
                throw Error(`${source}: 不能引用其他语言专用包：${value}`);
            return { id, type };
        };
        for (const locale of data.locales) {
            // 即使尚未启用该语言，也校验已填写的资源引用。
            const assets = {},
                texts = {};
            let font = null;
            for (const row of data.texts) if (has(row.values, locale)) texts[row.key] = row.values[locale];
            for (const row of data.assets)
                if (has(row.values, locale)) {
                    const key = resolveAsset(row.values[locale], row.type, locale);
                    if (row.key === '$font') font = key;
                    else assets[row.key] = key;
                }
            const group = variants[locale];
            reports.push({
                namespace,
                source,
                locale,
                storage: group ?? null,
                total: data.texts.length,
                translated: Object.keys(texts).length,
                assets: Object.keys(assets).length,
            });
            if (!group) continue;
            const catalog = { formatVersion: 2, namespace, locale, contract, texts, assets, font };
            const revision = digest(catalog);
            const path = `dynamic/i18n/${base}/${locale.toLowerCase()}`;
            definition.catalogs[locale] = { bundle: module.bundles[group].id, path, revision };
            output[`${forward(relative(root, module.directory))}/${module.bundles[group].root}/${path}.json`] =
                JSON.stringify({ ...catalog, revision }, null, 2) + '\n';
        }
        const generated = `${forward(relative(root, module.directory))}/contracts/generated`;
        const framework = forward(relative(resolve(root, generated), resolve(root, 'assets/framework')));
        const texts = data.texts.map(
            (row) =>
                `    ${row.name}: ${JSON.stringify({ namespace, key: row.key, contract, parameters: parameters(row.values[defaults]) })} as TextKey<${
                    parameters(row.values[defaults])
                        .map((name) => JSON.stringify(name))
                        .join(' | ') || 'never'
                }>,`,
        );
        const assets = data.assets
            .filter((row) => row.key !== '$font')
            .map(
                (row) =>
                    `    ${row.name}: ${JSON.stringify({ namespace, key: row.key, contract, type: row.type })} as LocalizedAssetKey<${JSON.stringify(row.type)}>,`,
            );
        output[`${generated}/localization-${base}.ts`] =
            `// 根据多语言工作簿生成；修改源工作簿后通过工作台生成。\nimport type { TextKey, LocalizedAssetKey } from '${framework}/localization/localization';\n/** ${namespace} 的文案与语言资源合同，不加载任何内容。 */\nexport const ${pascal(module.id)}${base === 'default' ? '' : pascal(base)}I18n = {\n  text: {\n${texts.join('\n')}\n  },\n  asset: {\n${assets.join('\n')}\n  },\n} as const;\n`;
    }
    if (workbooks.size) throw Error(`多语言工作簿尚未归属资源包：${[...workbooks.keys()].join(', ')}`);
    return { output, reports, release: config ? { ...config, bundles } : undefined };
}
