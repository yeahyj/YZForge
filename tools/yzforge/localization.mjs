import { relative, resolve, extname, isAbsolute } from 'node:path';
import { digest, pascal } from './project.mjs';
import settingsTools from './settings.cjs';
import localizationLayout from './localization-layout.cjs';

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const parameterPattern = /\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g;
const forward = (path) => path.replaceAll('\\', '/');
const parameters = (text) =>
    [...new Set([...text.matchAll(parameterPattern)].map((match) => match[1]).filter(Boolean))].sort();

export { parseLocalizationWorkbook, createLocalizationWorkbook } from './localization-workbook.mjs';

export function localizationOutputPaths(root, modules) {
    return modules.flatMap((module) =>
        Object.entries(module.bundles).flatMap(([base, bundle]) =>
            Object.entries(bundle.localization?.locales ?? {}).map(([locale, variant]) => {
                const target = localizationLayout.languageBundle(module, base, locale, variant);
                return forward(relative(root, resolve(module.directory, target.root, 'yz-locale.json')));
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
    for (const module of modules.map(localizationLayout.expandModule))
        for (const [base, bundle] of Object.entries(module.bundles)) {
            const declaration = bundle.localization;
            if (!declaration) continue;
            if (!config) throw Error('请先在项目设置登记默认语言与支持语言');
            if (
                Object.keys(declaration).some((name) => !['source', 'locales'].includes(name)) ||
                (has(declaration, 'source') &&
                    (typeof declaration.source !== 'string' ||
                        !declaration.source.startsWith(`config-source/${module.id}/`) ||
                        !declaration.source.endsWith('.xlsx') ||
                        sources.has(declaration.source)))
            )
                throw Error(`${module.id}/${base}: 工作簿归属无效或重复`);
            if (!has(declaration.locales, config.defaultLocale))
                throw Error(`${module.id}/${base}: 必须配置默认语言存放位置`);
            if (declaration.source) sources.add(declaration.source);
            const variants = {};
            for (const [locale, variant] of Object.entries(declaration.locales)) {
                const { group } = localizationLayout.languageBundle(module, base, locale, variant);
                variants[locale] = group;
                if (!config.locales.includes(locale))
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
            declarations.push({ module, base, bundle, source: declaration.source, variants });
        }
    return { config, declarations, owners };
}
/** 用当前物理路径配对；资源 UUID/旧逻辑名不参与语言 key 的生成。 */
export function languageResources(module, group, registry, metadata) {
    const directory = resolve(module.directory, module.bundles[group].root, 'dynamic');
    const entries = [...registry].filter(([id]) => id.startsWith(`${module.id}/${group}/`));
    const typesBySource = new Map();
    for (const [, record] of entries) {
        const asset = metadata.get(record.uuid);
        if (!asset) throw Error(`语言资源尚未导入：${record.uuid}`);
        if (!typesBySource.has(asset.source)) typesBySource.set(asset.source, new Set());
        typesBySource.get(asset.source).add(record.type);
    }
    const assets = {},
        seen = new Map();
    let font = null;
    for (const [id, record] of entries) {
        const asset = metadata.get(record.uuid),
            types = typesBySource.get(asset.source);
        // 一张图片只暴露实际使用的入口，避免引擎导入的三层对象争用同一个路径。
        if (['ImageAsset', 'Texture2D'].includes(record.type) && types.has('SpriteFrame')) continue;
        if (record.type === 'ImageAsset' && types.has('Texture2D')) continue;
        const local = forward(relative(directory, asset.source));
        if (!local || local.startsWith('../') || isAbsolute(local)) throw Error(`语言资源不在 dynamic 内：${id}`);
        const frame =
            metadata.get(record.uuid.split('@')[0])?.importer === 'sprite-atlas' && record.type === 'SpriteFrame'
                ? asset.suffix.replace(/^\//, '').replace(/\.[^./]+$/, '')
                : '';
        const key = local.slice(0, local.length - extname(local).length) + (frame ? '/' + frame : '');
        if (!key.split('/').every((part) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(part)))
            throw Error(`无效语言资源路径：${local}；请使用英文字母、数字、短横线和下划线`);
        if (seen.has(key.toLowerCase()))
            throw Error(`语言资源 key 冲突（含大小写/扩展名）：${key} / ${seen.get(key.toLowerCase())}`);
        seen.set(key.toLowerCase(), local);
        const value = { id, type: record.type };
        if (key === 'fonts/default') {
            if (record.type !== 'Font') throw Error(`${id}: fonts/default 必须是字体`);
            font = value;
        } else assets[key] = value;
    }
    return { assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))), font };
}

export function compileLocalization(root, modules, settings, sources, registry, metadata = new Map()) {
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
        const workbook = source ? workbooks.get(source) : undefined;
        if (source && !workbook) throw Error(`${source}: 未找到有效多语言工作簿`);
        if (source) workbooks.delete(source);
        const data = workbook?.localization ?? { texts: [], locales: Object.keys(variants) },
            namespace = `${module.id}/${base}`;
        if (
            data.locales.some((locale) => !config.locales.includes(locale)) ||
            Object.keys(variants).some((locale) => !data.locales.includes(locale))
        )
            throw Error(`${source}: 语言列与项目/资源包声明不一致`);
        const defaults = config.defaultLocale;
        for (const row of data.texts) {
            if (!has(row.values, defaults)) throw Error(`${source}: 默认语言缺少 ${row.key}`);
            const expected = parameters(row.values[defaults]).join(',');
            for (const [locale, value] of Object.entries(row.values))
                if (parameters(value).join(',') !== expected) throw Error(`${source}: ${row.key}/${locale} 参数不一致`);
        }
        const resources = Object.fromEntries(
            Object.entries(variants).map(([locale, group]) => [
                locale,
                languageResources(module, group, registry, metadata),
            ]),
        );
        const defaultAssets = resources[defaults].assets;
        for (const [locale, { assets }] of Object.entries(resources))
            for (const [key, value] of Object.entries(assets)) {
                if (!has(defaultAssets, key)) throw Error(`${namespace}/${locale}: 默认语言缺少资源路径 ${key}`);
                if (defaultAssets[key].type !== value.type)
                    throw Error(`${namespace}/${locale}: 资源类型不一致 ${key}`);
            }
        const contract = digest({
            namespace,
            texts: data.texts.map((row) => [row.key, parameters(row.values[defaults])]).sort(),
            assets: Object.entries(defaultAssets)
                .map(([key, value]) => [key, value.type])
                .sort(),
        });
        const definition = { namespace, contract, catalogs: {} };
        bundles[bundle.id] = definition;
        for (const locale of data.locales) {
            // 停用的语言保留文案列；资源仅扫描已启用的语言目录。
            const { assets, font } = resources[locale] ?? { assets: {}, font: null },
                texts = {};
            for (const row of data.texts) if (has(row.values, locale)) texts[row.key] = row.values[locale];
            const group = variants[locale];
            reports.push({
                namespace,
                source,
                locale,
                storage: group ?? null,
                total: data.texts.length,
                translated: Object.keys(texts).length,
                assets: Object.keys(assets).length,
                assetKeys: Object.keys(assets),
                missingAssets: Object.keys(defaultAssets).filter((key) => !has(assets, key)),
                font: font?.id ?? null,
            });
            if (!group) continue;
            const catalog = { formatVersion: 2, namespace, locale, contract, texts, assets, font };
            const revision = digest(catalog);
            const path = 'yz-locale';
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
        const assets = Object.entries(defaultAssets).map(
            ([key, value]) =>
                `    ${JSON.stringify(key)}: ${JSON.stringify({ namespace, key, contract, type: value.type })} as LocalizedAssetKey<${JSON.stringify(value.type)}>,`,
        );
        output[`${generated}/localization-${base}.ts`] =
            `// 根据文案工作簿与语言 dynamic 相对路径生成；通过工作台更新。\nimport type { TextKey, LocalizedAssetKey } from '${framework}/localization/localization';\n/** ${namespace} 的文案与语言资源合同，不加载任何内容。 */\nexport const ${pascal(module.id)}${base === 'default' ? '' : pascal(base)}I18n = {\n  text: {\n${texts.join('\n')}\n  },\n  asset: {\n${assets.join('\n')}\n  },\n} as const;\n`;
    }
    if (workbooks.size) throw Error(`多语言工作簿尚未归属资源包：${[...workbooks.keys()].join(', ')}`);
    return { output, reports, release: config ? { ...config, bundles } : undefined };
}
