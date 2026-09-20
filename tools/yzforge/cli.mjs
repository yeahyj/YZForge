import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
try {
    const command = process.argv[2] ?? 'check';
    if (!['generate', 'check', 'preview'].includes(command)) throw Error(`Unknown command: ${command}`);
    const result = await generate(root, {
        check: command === 'check',
        preview: command === 'preview',
        allowObsolete: process.argv.includes('--editor'),
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exitCode = 1;
}
