import { resolve, relative } from 'node:path';
import { dependencyResolver } from './dependencies.mjs';
import { files } from '../project/project.mjs';

const forward = (file) => file.replaceAll('\\', '/');
/** 验证真正发出的值导入；类型导入另由公开契约和 core 边界检查。 */
export async function architectureCheck(root, modules) {
    const framework = forward(resolve(root, 'assets/framework')) + '/';
    const dependencies = dependencyResolver(root);
    const graph = new Map(),
        errors = [];
    const runtime = (file) => {
        if (!graph.has(file)) graph.set(file, dependencies.imports(file, { runtime: true }));
        return graph.get(file);
    };
    for (const file of await files(resolve(root, 'assets/framework'), '.ts')) {
        const from = forward(file),
            core = from.startsWith(framework + 'core/');
        for (const edge of dependencies.imports(file)) {
            if (
                from.startsWith(framework + 'components/') &&
                edge.target &&
                [
                    'assets/asset-manager.ts',
                    'config/config-manager.ts',
                    'audio/audio-manager.ts',
                    'time/time-service.ts',
                    'ui/localization/localized-ui.ts',
                ].some((file) => edge.target === framework + file)
            )
                errors.push(`${relative(root, file)}: 组件基础设施应依赖能力接口，不能引用具体服务实现：${edge.spec}`);
            if (edge.target?.includes('/assets/game/'))
                errors.push(`${relative(root, file)}: 框架不能依赖项目实现：${edge.spec}`);
            if (!edge.target && edge.spec.startsWith('.'))
                errors.push(`${relative(root, file)}: 无法解析模块边界：${edge.spec}`);
            if (
                core &&
                (edge.spec === 'cc' ||
                    edge.spec.startsWith('cc/') ||
                    (edge.target && !edge.target.startsWith(framework + 'core/')))
            )
                errors.push(`${relative(root, file)}: core 只能依赖自身基础机制：${edge.spec}`);
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
