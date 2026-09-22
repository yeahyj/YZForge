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
            !module.dependencies ||
            Array.isArray(module.dependencies) ||
            typeof module.dependencies !== 'object' ||
            !module.bundles ||
            Array.isArray(module.bundles) ||
            typeof module.bundles !== 'object'
        )
            throw Error(`${module.id}: dependencies and bundles declarations are required (bundles may be empty)`);
        for (const [alias, dependency] of Object.entries(module.dependencies)) {
            identifier(alias);
            if (typeof dependency !== 'string') throw Error(`${module.id}: dependency ${alias} must be a module ID`);
        }
        if (module.code && !['none', 'eager', 'bundled'].includes(module.code.mode))
            throw Error(`${module.id}: code.mode must be none, eager or bundled`);
        if (
            module.code?.mode === 'none' &&
            (module.factory ||
                Object.keys(module.dependencies).length ||
                Object.keys(module.views ?? {}).length ||
                Object.keys(module.components ?? {}).length)
        )
            throw Error(
                `${module.id}: resource-only modules cannot declare a factory, business dependencies, views or components`,
            );
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
        if (module.code?.mode === 'bundled') {
            if (!/^[a-z][a-z0-9-]*$/.test(module.code.bundle) || bundleIds.has(module.code.bundle))
                throw Error(`Invalid/duplicate code bundle: ${module.code.bundle}`);
            bundleIds.add(module.code.bundle);
        }
    }
    const stack = new Set(),
        done = new Set();
    const visit = (id) => {
        if (done.has(id)) return;
        if (!map.has(id) || stack.has(id))
            throw Error(`Missing/cyclic module dependency: ${[...stack, id].join(' -> ')}`);
        stack.add(id);
        for (const dep of Object.values(map.get(id).dependencies)) {
            if (map.get(dep)?.code?.mode === 'none')
                throw Error(`${id}: ${dep} has no business runtime; import public data contracts directly`);
            visit(dep);
        }
        stack.delete(id);
        done.add(id);
    };
    for (const id of map.keys()) visit(id);
}

export async function codeBoundaryCheck(root, modules) {
    const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const boundaries = modules.map((module) => ({
        ...module,
        codePath: resolve(module.directory, module.code?.root ?? 'code').replaceAll('\\', '/') + '/',
    }));
    const errors = [];
    for (const file of await files(resolve(root, 'assets/game'), '.ts')) {
        const source = ts.createSourceFile(file, ts.sys.readFile(file), ts.ScriptTarget.Latest, true);
        const from = file.replaceAll('\\', '/');
        const inspect = (specifier, typeOnly) => {
            if (typeOnly) return;
            const target = ts
                .resolveModuleName(specifier, file, parsed.options, ts.sys)
                .resolvedModule?.resolvedFileName.replaceAll('\\', '/');
            const owner = boundaries.find((module) => target?.startsWith(module.codePath));
            if (!owner || from.startsWith(owner.codePath)) return;
            // Generated assembly may directly construct eager factories; bundled implementations have no such exception.
            if (owner.code?.mode !== 'bundled' && from.endsWith('/app/generated/assembly.ts')) return;
            errors.push(
                `${relative(root, file)}: 私有模块实现不能跨边界导入 ${specifier}；请通过 public.ts / contracts 和 ModuleRef 通信`,
            );
        };
        const visit = (node) => {
            if (
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                const clause = node.importClause;
                const typeOnly =
                    node.isTypeOnly ||
                    clause?.isTypeOnly ||
                    (clause?.namedBindings &&
                        ts.isNamedImports(clause.namedBindings) &&
                        !clause.name &&
                        clause.namedBindings.elements.length > 0 &&
                        clause.namedBindings.elements.every((item) => item.isTypeOnly));
                inspect(node.moduleSpecifier.text, typeOnly);
            }
            if (
                ts.isCallExpression(node) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                    (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
            ) {
                const argument = node.arguments[0];
                if (argument && ts.isStringLiteral(argument)) inspect(argument.text, false);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    if (errors.length) throw Error(errors.join('\n'));
}
