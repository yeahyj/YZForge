import { fileURLToPath } from 'node:url';
import { generate } from './generators/generate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
try {
    const command = process.argv[2] ?? 'check';
    if (
        ![
            'generate',
            'check',
            'preview',
            'recalculate',
            'formula-status',
            'audit-build',
            'init-state',
            'preview-language-rename',
        ].includes(command)
    )
        throw Error(`Unknown command: ${command}`);
    const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
    const result =
        command === 'preview-language-rename'
            ? await (
                  await import('./operations/language-rename.mjs')
              ).planLanguageRename(root, {
                  module: option('--module'),
                  bundle: option('--bundle') ?? 'default',
                  from: option('--from'),
                  to: option('--to'),
              })
            : command === 'init-state'
              ? await (await import('./operations/initialize-state.mjs')).initializeState(root)
              : command === 'formula-status'
                ? await (await import('./operations/recalculate.mjs')).formulaEnvironment()
                : command === 'audit-build'
                  ? await (
                        await import('./validation/build-audit.cjs')
                    ).default.auditProjectBuild(root, option('--output'), option('--platform'))
                  : command === 'recalculate'
                    ? await (await import('./operations/recalculate.mjs')).recalculate(root, option('--source'))
                    : await generate(root, {
                          check: command === 'check',
                          preview: command === 'preview',
                          allowObsolete: process.argv.includes('--editor'),
                          previewFormulas: process.argv.includes('--preview-formulas'),
                          platform: option('--platform'),
                      });
    const ok = command !== 'audit-build' || result.problems.length === 0;
    console.log(JSON.stringify({ ok, ...result }, null, 2));
    if (!ok) process.exitCode = 1;
} catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }, null, 2));
    process.exitCode = 1;
}
