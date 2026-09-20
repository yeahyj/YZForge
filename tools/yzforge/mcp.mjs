import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(resolve(root, 'funplay-cocos-mcp.config.json'), 'utf8'));
if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) throw Error('Only local editor endpoints are supported');
const endpoint = `http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}/`;
let sequence = 0;
let session;
async function rpc(method, params) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (session) headers['mcp-session-id'] = session;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
        signal: AbortSignal.timeout(120000),
    });
    session = response.headers.get('mcp-session-id') ?? session;
    const raw = await response.text();
    const payload = JSON.parse(
        response.headers.get('content-type')?.includes('text/event-stream')
            ? raw
                  .split(/\r?\n/)
                  .filter((line) => line.startsWith('data:'))
                  .at(-1)
                  .slice(5)
            : raw,
    );
    if (!response.ok || payload.error) throw Error(JSON.stringify(payload.error ?? payload));
    return payload.result;
}
function decode(result) {
    const value = result.structuredContent ?? JSON.parse(result.content.find((item) => item.type === 'text').text);
    if (result.isError || value.ok === false) throw Error(JSON.stringify(value));
    return value;
}
let verified = false;
export async function call(name, args = {}) {
    if (!verified) {
        await rpc('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'yzforge-tools', version: '0.1.0' },
        });
        const state = decode(await rpc('tools/call', { name: 'get_editor_state', arguments: {} }));
        const normalize = (path) => realpathSync(path).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
        if (normalize(state.data.projectPath) !== normalize(root))
            throw Error(`Wrong editor project: ${state.data.projectPath}`);
        verified = true;
    }
    return decode(await rpc('tools/call', { name, arguments: args }));
}
export async function schemas(pattern) {
    const result = await rpc('tools/list', {});
    return result.tools
        .filter((tool) => new RegExp(pattern).test(tool.name))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [name, raw] = process.argv.slice(2);
    const args = raw?.startsWith('@')
        ? JSON.parse(readFileSync(resolve(raw.slice(1)), 'utf8'))
        : JSON.parse(raw ?? '{}');
    console.log(
        JSON.stringify(name === 'schemas' ? await schemas(args.pattern ?? '.') : await call(name, args), null, 2),
    );
}
