import { access, readFile } from 'node:fs/promises';
import ts from 'typescript';
export async function resolve(specifier, context, next) {
    // Table/类型合同使用 Xxx.table.ts、Xxx.types.ts，.table 不是实际文件扩展名。
    if (/^\.{1,2}\//.test(specifier) && !/\.(?:[cm]?js|tsx?|json|node)$/i.test(specifier) && context.parentURL) {
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
