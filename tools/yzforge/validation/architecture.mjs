import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { files } from '../project/project.mjs';

const forward = (file) => file.replaceAll('\\', '/');
function imports(file, text) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const result = [];
    function visit(node) {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        )
            result.push(node.moduleSpecifier.text);
        if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
        )
            result.push(node.arguments[0].text);
        ts.forEachChild(node, visit);
    }
    visit(source);
    return result;
}
/** 验证真正发出的值导入；类型导入另由公开契约和 core 边界检查。 */
export async function architectureCheck(root, modules) {
    const framework = forward(resolve(root, 'assets/framework')) + '/';
    const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, root);
    const targetOf = (from, spec) => {
        const file = ts.resolveModuleName(spec, from, parsed.options, ts.sys).resolvedModule?.resolvedFileName;
        return file ? forward(file) : undefined;
    };
    const graph = new Map(),
        errors = [];
    const runtime = (file) => {
        if (graph.has(file)) return graph.get(file);
        const text = ts.sys.readFile(file);
        if (text === undefined) return [];
        const emitted = ts.transpileModule(text, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.ESNext,
                experimentalDecorators: true,
            },
        }).outputText;
        const edges = imports(file, emitted).map((spec) => ({ spec, target: targetOf(file, spec) }));
        graph.set(file, edges);
        return edges;
    };
    for (const file of await files(resolve(root, 'assets/framework'), '.ts')) {
        const from = forward(file),
            core = from.startsWith(framework + 'core/');
        if (core)
            for (const spec of imports(file, ts.sys.readFile(file))) {
                const target = targetOf(file, spec);
                if (spec === 'cc' || spec.startsWith('cc/') || (target && !target.startsWith(framework + 'core/')))
                    errors.push(`${relative(root, file)}: core 只能依赖自身基础机制：${spec}`);
            }
        for (const edge of runtime(from))
            if (
                from.startsWith(framework + 'components/') &&
                edge.target?.startsWith(framework) &&
                !['components/', 'core/'].some((dir) => edge.target.startsWith(framework + dir))
            )
                errors.push(`${relative(root, file)}: 组件基础设施不能加载上层实现：${edge.spec}`);
    }
    const visited = new Set(),
        visiting = new Set();
    const walk = (file, chain) => {
        if (visiting.has(file)) {
            errors.push('框架运行时循环依赖：' + [...chain, file].map((f) => relative(root, f)).join(' -> '));
            return;
        }
        if (visited.has(file)) return;
        visiting.add(file);
        for (const edge of runtime(file)) if (edge.target?.startsWith(framework)) walk(edge.target, [...chain, file]);
        visiting.delete(file);
        visited.add(file);
    };
    for (const file of graph.keys()) walk(file, []);
    for (const module of modules) {
        if (module.code?.mode === 'none' && (await files(resolve(module.directory, 'code'))).length)
            errors.push(`${module.id}: 纯资源模块不允许 code 目录内容`);
        const seen = new Set();
        const contract = (file) => {
            if (seen.has(file)) return;
            seen.add(file);
            for (const edge of runtime(file)) {
                if (
                    edge.spec === 'cc' ||
                    edge.spec.startsWith('cc/') ||
                    (edge.target?.includes('/assets/game/modules/') && edge.target.includes('/code/'))
                ) {
                    errors.push(`${module.id}: 公开入口会加载实现或引擎组件：${relative(root, file)} -> ${edge.spec}`);
                    continue;
                }
                if (edge.target && edge.target.startsWith(forward(resolve(root, 'assets')) + '/'))
                    contract(edge.target);
            }
        };
        contract(forward(resolve(module.directory, 'public.ts')));
    }
    if (errors.length) throw Error([...new Set(errors)].join('\n'));
}
