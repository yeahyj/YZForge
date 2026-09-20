import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { files, identifier } from './project.mjs';
export async function lifecycleCheck(root) {
    const paths = await files(resolve(root, 'assets'), '.ts');
    const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const program = ts.createProgram(paths, parsed.options),
        checker = program.getTypeChecker(),
        errors = [];
    const reserved = new Set([
        '__preload',
        'onLoad',
        'start',
        'onEnable',
        'onDisable',
        'update',
        'lateUpdate',
        'onDestroy',
    ]);
    const framework = resolve(root, 'assets/framework').replaceAll('\\', '/') + '/';
    const bases = (type) => {
        const result = new Set();
        const visit = (current) => {
            if (!current || result.has(current)) return;
            result.add(current);
            for (const base of current.getBaseTypes?.() ?? []) visit(base);
        };
        visit(type);
        return [...result].map((type) => type.symbol?.name);
    };
    for (const source of program.getSourceFiles()) {
        if (
            !paths.includes(source.fileName) &&
            !paths.some((path) => path.replaceAll('\\', '/') === source.fileName.replaceAll('\\', '/'))
        )
            continue;
        const isFramework = source.fileName.replaceAll('\\', '/').startsWith(framework);
        const issue = (node, text) => {
            const pos = source.getLineAndCharacterOfPosition(node.getStart());
            errors.push(`${relative(root, source.fileName)}:${pos.line + 1}:${pos.character + 1}: ${text}`);
        };
        const visit = (node) => {
            if (ts.isSpreadElement(node)) {
                const type = checker.getTypeAtLocation(node.expression);
                if (!checker.isArrayType(type) && !checker.isTupleType(type))
                    issue(node, 'Creator loose builds require Array.from(iterable) before spreading non-array values');
            }
            if (
                isFramework &&
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                const target = ts
                    .resolveModuleName(node.moduleSpecifier.text, source.fileName, parsed.options, ts.sys)
                    .resolvedModule?.resolvedFileName.replaceAll('\\', '/');
                if (target?.includes('/assets/game/'))
                    issue(node, 'Framework core cannot import project implementation or generated project settings');
            }
            if (isFramework) {
                ts.forEachChild(node, visit);
                return;
            }
            if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
                const names = bases(checker.getTypeAtLocation(node));
                if (names.includes('Component')) {
                    if (
                        !names.includes('GameComponent') &&
                        !names.includes('UIView') &&
                        !names.includes('ModuleEntry') &&
                        !names.includes('AppEntry')
                    )
                        issue(node, 'Business node scripts must inherit GameComponent or UIView');
                    for (const member of node.members) {
                        const name = member.name;
                        let text =
                            name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
                                ? name.text
                                : null;
                        if (name && ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression))
                            text = name.expression.text;
                        if (name && ts.isComputedPropertyName(name) && text === null)
                            issue(member, 'Computed business component member names must be literal and checkable');
                        if (reserved.has(text))
                            issue(member, `Reserved engine hook ${text}; use framework lifecycle hooks`);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return errors;
}
export function validateModules(modules) {
    const map = new Map(),
        bundleIds = new Set(),
        viewIds = new Set();
    for (const module of modules) {
        if (!/^[a-z][a-z0-9-]*$/.test(module.id) || module.id === 'shared' || map.has(module.id))
            throw Error(`Invalid/duplicate module id: ${module.id}`);
        map.set(module.id, module);
        if (
            !Array.isArray(module.dependencies) ||
            !module.bundles ||
            Array.isArray(module.bundles) ||
            typeof module.bundles !== 'object'
        )
            throw Error(`${module.id}: dependencies and bundles declarations are required (bundles may be empty)`);
        for (const [group, bundle] of Object.entries(module.bundles)) {
            identifier(group);
            if (!/^[a-z][a-z0-9-]*$/.test(bundle.id) || bundleIds.has(bundle.id))
                throw Error(`Invalid/duplicate bundle id: ${bundle.id}`);
            if (
                typeof bundle.root !== 'string' ||
                bundle.root.split(/[\\/]/).includes('..') ||
                bundle.root.startsWith('/') ||
                /^[a-z]:/i.test(bundle.root)
            )
                throw Error(`Invalid bundle root: ${bundle.root}`);
            bundleIds.add(bundle.id);
        }
        for (const [name, view] of Object.entries(module.views ?? {})) {
            identifier(name);
            const id = `${module.id}.${name}`;
            if (viewIds.has(id)) throw Error(`Duplicate view ${id}`);
            viewIds.add(id);
            if (module.assets?.[view.prefab]?.type !== 'Prefab')
                throw Error(`${id}: prefab must reference a registered Prefab logical id`);
            if (!['page', 'popup', 'overlay', 'toast', 'loading'].includes(view.kind))
                throw Error(`${id}: invalid view kind`);
        }
    }
    const stack = new Set(),
        done = new Set();
    const visit = (id) => {
        if (done.has(id)) return;
        if (!map.has(id) || stack.has(id))
            throw Error(`Missing/cyclic module dependency: ${[...stack, id].join(' -> ')}`);
        stack.add(id);
        for (const dep of map.get(id).dependencies) visit(dep);
        stack.delete(id);
        done.add(id);
    };
    for (const id of map.keys()) visit(id);
}
