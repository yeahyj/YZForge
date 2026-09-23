import type { CancellationSignal } from '../../../../../framework/core/cancellation';
import type { HttpResponse, HttpTransport, TransportRequest } from '../../../../../framework/network/http-client';
/** 仅用于交互示例的本地模拟传输；真正的 HTTP GET 使用 ctx.http 的平台适配。 */
export class DemoHttpTransport implements HttpTransport {
    /** 模拟成功、503 和慢请求；取消同步移除定时器，不会访问外部网络。 */
    send(request: TransportRequest, signal: CancellationSignal): Promise<HttpResponse> {
        signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => {
                    detach();
                    resolve({
                        status: request.url.endsWith('/failure') ? 503 : 200,
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ message: '模拟响应已通过 JSON 结构校验' }),
                    });
                },
                request.url.endsWith('/slow') ? 3000 : 700,
            );
            const detach = signal.onAbort((reason) => {
                clearTimeout(timer);
                reject(reason);
            });
        });
    }
}
