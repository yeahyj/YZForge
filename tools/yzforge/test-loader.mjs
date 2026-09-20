import { access, readFile } from 'node:fs/promises';
import ts from 'typescript';
export async function resolve(specifier, context, next) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
        const url = new URL(`${specifier}.ts`, context.parentURL);
        try {
            await access(url);
            return { url: url.href, shortCircuit: true };
        } catch {
            /* Standard resolver reports missing modules. */
        }
    }
    return next(specifier, context);
}
export async function load(url, context, next) {
    if (url.endsWith('.ts'))
        return {
            format: 'module',
            shortCircuit: true,
            source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
                fileName: url,
                compilerOptions: {
                    target: ts.ScriptTarget.ES2022,
                    module: ts.ModuleKind.ESNext,
                    experimentalDecorators: true,
                },
            }).outputText,
        };
    return next(url, context);
}
