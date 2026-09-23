import { HttpError, type HttpResponse, type HttpTransport } from './http-client';

/** 解析 HTTP 响应头为小写键；同名重复项以逗号合并。 */
function parseHeaders(raw: string): Readonly<Record<string, string>> {
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const line of raw.split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const key = line.slice(0, colon).trim().toLowerCase(),
            value = line.slice(colon + 1).trim();
        result[key] = result[key] ? `${result[key]}, ${value}` : value;
    }
    return Object.freeze(result);
}
/**
 * Web 与提供 XMLHttpRequest 的 Cocos 原生平台适配。默认不携带跨站 Cookie。
 * @param factory 可注入宿主 XHR 或测试替身；不使用 fetch/AbortController。
 * @param withCredentials 是否允许 XHR 携带凭据，默认 false；受平台跨域策略约束。
 */
export function createXhrTransport(
    factory: () => XMLHttpRequest = () => new XMLHttpRequest(),
    withCredentials = false,
): HttpTransport {
    return {
        send: (request, signal) => {
            signal.throwIfAborted();
            return new Promise<HttpResponse>((resolve, reject) => {
                const xhr = factory();
                let done = false,
                    detach = () => {};
                const finish = (error?: unknown, response?: HttpResponse) => {
                    if (done) return;
                    done = true;
                    detach();
                    xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
                    if (error) reject(error);
                    else resolve(response!);
                };
                try {
                    xhr.open(request.method, request.url, true);
                    xhr.responseType = 'text';
                    xhr.withCredentials = withCredentials;
                    for (const [key, value] of Object.entries(request.headers)) xhr.setRequestHeader(key, value);
                    xhr.onload = () => {
                        try {
                            finish(undefined, {
                                status: xhr.status,
                                body: xhr.responseText,
                                headers: parseHeaders(xhr.getAllResponseHeaders()),
                            });
                        } catch {
                            finish(new HttpError('HTTP_NETWORK', '无法读取响应'));
                        }
                    };
                    xhr.onerror = () => finish(new HttpError('HTTP_NETWORK', '网络连接失败'));
                    xhr.onabort = () => finish(signal.reason ?? new HttpError('HTTP_NETWORK', '底层请求已中止'));
                    xhr.ontimeout = () => finish(new HttpError('HTTP_TIMEOUT', '底层请求超时'));
                    detach = signal.onAbort((reason) => {
                        finish(reason);
                        try {
                            xhr.abort();
                        } catch {
                            /* 已经结束的请求仍须完成取消。 */
                        }
                    });
                    if (!done) xhr.send(request.body ?? null);
                } catch (error) {
                    finish(error);
                }
            });
        },
    };
}
/** 微信请求 API 的最小注入合同，无需引入整个小游戏类型包。 */
export interface WechatRequestApi {
    /** 发出文本请求，返回可物理中止的 RequestTask。 */
    request(options: {
        /** 绝对 URL；需要在平台后台配置合法域名。 */
        url: string;
        /** 请求方法。 */
        method: string;
        /** 文本请求体。 */
        data?: string;
        /** 请求头。 */
        header: Readonly<Record<string, string>>;
        /** 禁止宿主自动解析 JSON，统一由客户端验证。 */
        dataType: 'text';
        /** 统一返回文本。 */
        responseType: 'text';
        /** 接收响应；非 2xx 仍由客户端判定。 */
        success(response: { statusCode: number; data: string; header: Record<string, string> }): void;
        /** 连接或底层请求失败。 */
        fail(error: unknown): void;
    }): { abort(): void };
}
/** 微信 wx.request 适配；取消会调用 RequestTask.abort，忽略迟到回调并解除信号监听。 */
export function createWechatTransport(api: WechatRequestApi): HttpTransport {
    return {
        send: (request, signal) => {
            signal.throwIfAborted();
            return new Promise<HttpResponse>((resolve, reject) => {
                let done = false,
                    detach = () => {};
                let task: { abort(): void } | undefined;
                const finish = (error?: unknown, response?: HttpResponse) => {
                    if (done) return;
                    done = true;
                    detach();
                    if (error) reject(error);
                    else resolve(response!);
                };
                detach = signal.onAbort((reason) => {
                    finish(reason);
                    task?.abort();
                });
                try {
                    task = api.request({
                        ...request,
                        data: request.body,
                        header: request.headers,
                        dataType: 'text',
                        responseType: 'text',
                        success: (response) =>
                            finish(undefined, {
                                status: response.statusCode,
                                body: response.data,
                                headers: parseHeaders(
                                    Object.entries(response.header ?? {})
                                        .map(([key, value]) => `${key}: ${value}`)
                                        .join('\n'),
                                ),
                            }),
                        fail: () => finish(signal.reason ?? new HttpError('HTTP_NETWORK', '微信请求失败')),
                    });
                    if (signal.aborted) task.abort();
                } catch (error) {
                    finish(error);
                }
            });
        },
    };
}
/** 自动选择当前宿主的 wx.request、tt.request 或 XMLHttpRequest；创建时不联网。 */
export function createPlatformHttpTransport(): HttpTransport {
    const host = globalThis as typeof globalThis & { wx?: WechatRequestApi; tt?: WechatRequestApi };
    if (host.wx?.request) return createWechatTransport(host.wx);
    if (host.tt?.request) return createWechatTransport(host.tt);
    if (typeof XMLHttpRequest !== 'undefined') return createXhrTransport();
    return { send: () => Promise.reject(new HttpError('HTTP_TRANSPORT_UNAVAILABLE', '当前平台需要注入 HTTP 适配器')) };
}
