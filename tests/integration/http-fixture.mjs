// 只监听本机的真实 HTTP 示例服务；可独立运行，集成测试也可使用随机空闲端口。
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export async function startHttpFixture(port = 0) {
    const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Test');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method === 'OPTIONS') {
            response.writeHead(204);
            response.end();
            return;
        }
        const finish = () => {
            if (response.destroyed) return;
            response.writeHead(url.pathname === '/failure' ? 503 : 200);
            response.end(
                url.pathname === '/invalid'
                    ? '{invalid'
                    : JSON.stringify({
                          message: '真实本机 HTTP 请求成功',
                          method: request.method,
                          query: url.searchParams.get('query'),
                      }),
            );
        };
        if (url.pathname === '/slow') {
            const timer = setTimeout(finish, 5000);
            response.on('close', () => clearTimeout(timer));
        } else finish();
    });
    await new Promise((yes, no) => {
        server.once('error', no);
        server.listen(port, '127.0.0.1', yes);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () =>
            new Promise((yes, no) => {
                server.close((error) => (error ? no(error) : yes()));
                server.closeAllConnections();
            }),
    };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const fixture = await startHttpFixture(8787);
    console.log(`本机 HTTP 示例：${fixture.url}/health（Ctrl+C 退出）`);
}
