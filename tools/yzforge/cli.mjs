import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
try {
    const command = process.argv[2] ?? 'check';
    if (!['generate', 'check', 'preview', 'recalculate'].includes(command)) throw Error(`Unknown command: ${command}`);
    const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
    const result =
        command === 'recalculate'
            ? await (await import('./recalculate.mjs')).recalculate(root, option('--source'))
            : await generate(root, {
                  check: command === 'check',
                  preview: command === 'preview',
                  allowObsolete: process.argv.includes('--editor'),
                  previewFormulas: process.argv.includes('--preview-formulas'),
                  platform: option('--platform'),
              });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exitCode = 1;
}
