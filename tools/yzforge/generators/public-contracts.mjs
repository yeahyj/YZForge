import { relative, resolve } from 'node:path';
import { files, pascal } from '../project/project.mjs';

/** contracts 下的人工定义和本轮公开生成物共同构成唯一公开入口；不复用过期生成文件。 */
export async function publicContracts(root, modules, output) {
    for (const module of modules) {
        const prefix = relative(root, module.directory).replaceAll('\\', '/');
        const contracts = `${prefix}/contracts/`;
        const sources = (await files(resolve(root, contracts), '.ts'))
            .map((file) => relative(root, file).replaceAll('\\', '/'))
            .filter((file) => !file.startsWith(contracts + 'generated/'));
        sources.push(...Object.keys(output).filter((file) => file.startsWith(contracts) && file.endsWith('.ts')));
        const type = pascal(module.id);
        const lines = ['// 自动生成的唯一公开入口。人工契约放 contracts，公开生成物由声明决定。'];
        if (module.code.mode !== 'none') {
            if (!sources.includes(contracts + 'api.ts')) throw Error(`${module.id}: 缺少 contracts/api.ts`);
            lines.push(
                `import type { ModuleRef } from '../../../framework/modules/module-manager';`,
                `import type { ${type}Api } from './contracts/api';`,
                `/** 轻量模块引用；import 不加载私有实现或初始化业务。 */`,
                `export const ${type}Module: ModuleRef<${type}Api> = { id: '${module.id}' };`,
            );
        }
        for (const source of [...new Set(sources)].sort())
            lines.push(`export * from './${source.slice(prefix.length + 1).replace(/\.ts$/, '')}';`);
        output[`${prefix}/public.ts`] = lines.join('\n') + '\n';
    }
}
