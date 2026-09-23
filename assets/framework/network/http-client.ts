import { FrameworkError, invariant, OperationCancelled } from '../core/errors';
import { untilCancelled, type CancellationSignal } from '../core/cancellation';
import { runTask, type Lifetime } from '../core/scope';

/** 框架支持的 HTTP 方法；不隐式把失败的写入请求重发。 */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
/** 请求输入；body 为已编码文本，JSON 请求可通过 jsonBody 构建。 */
export interface HttpRequest {
    /** 完整 http(s) URL，或在配置 baseUrl 时使用相对路径；不允许片段或 URL 内凭据。 */
    readonly url: string;
    /** 默认 GET；GET/HEAD 不允许 body。 */
    readonly method?: HttpMethod;
    /** 查询参数，undefined 忽略；值经百分号编码后追加到 URL。 */
    readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
    /** 本次请求头，名称不区分大小写；覆盖同名默认头。 */
    readonly headers?: Readonly<Record<string, string>>;
    /** 已编码请求体；JSON 使用 JSON.stringify 或 jsonBody。 */
    readonly body?: string;
    /** 本次超时毫秒，正数，默认使用客户端的 10000 毫秒。 */
    readonly timeoutMs?: number;
}
/** 底层传输输入，已合并默认配置；适配器不得自行重试。 */
export interface TransportRequest {
    /** 绝对 http(s) URL。 */
    readonly url: string;
    /** 明确的 HTTP 方法。 */
    readonly method: HttpMethod;
    /** 小写名称的请求头。 */
    readonly headers: Readonly<Record<string, string>>;
    /** 可选文本请求体。 */
    readonly body?: string;
}
/** 原始文本响应；HTTP 状态错误由 HttpClient 统一处理。 */
export interface HttpResponse {
    /** HTTP 状态码。 */
    readonly status: number;
    /** 小写名称的响应头；平台可能隐藏跨域敏感响应头。 */
    readonly headers: Readonly<Record<string, string>>;
    /** 原始文本，204/HEAD 通常为空字符串。 */
    readonly body: string;
}
/** 平台传输合同；取消时尽可能 abort 底层请求，并且解除所有回调和取消监听。 */
export interface HttpTransport {
    /** 发送一次请求；禁止持有 UI 节点，迟到结果不会交付给已经取消的调用方。 */
    send(request: TransportRequest, signal: CancellationSignal): Promise<HttpResponse>;
}
/** 客户端装配配置；不同服务端或账号可显式使用不同实例。 */
export interface HttpClientOptions {
    /** 必需的平台适配，可使用 createPlatformHttpTransport，也可注入测试服务。 */
    readonly transport: HttpTransport;
    /** 可选绝对 URL 前缀，不含 query/fragment；例如 https://api.example.com/v1。 */
    readonly baseUrl?: string;
    /** 可选默认请求头；在构造时复制。凭据变化应创建新客户端或显式传请求头。 */
    readonly headers?: Readonly<Record<string, string>>;
    /** 默认超时毫秒，默认 10000，最大 2147483647。 */
    readonly timeoutMs?: number;
    /** 可选计时器注入；返回取消定时器的函数。默认使用宿主 setTimeout，后台可能延迟唤醒。 */
    readonly schedule?: (callback: () => void, delayMs: number) => () => void;
}
/** 稳定分类的网络错误；不把 URL、凭据或响应正文放入错误详情。 */
export class HttpError extends FrameworkError {
    /** 非 2xx 响应携带状态码，其余错误为 undefined。 */
    readonly status?: number;
    /** 创建网络错误；常见 code 为 HTTP_TIMEOUT、HTTP_NETWORK、HTTP_STATUS、HTTP_DECODE。 */
    constructor(code: string, message: string, status?: number) {
        super(code, message, status === undefined ? {} : { status });
        this.name = 'HttpError';
        this.status = status;
    }
}
/** 将对象编码为 JSON 请求体及 Content-Type，可与 url/method 合并；不改变调用者对象。 */
export function jsonBody(value: unknown): Pick<HttpRequest, 'body' | 'headers'> {
    let body: string | undefined;
    try {
        body = JSON.stringify(value);
    } catch {
        throw new HttpError('HTTP_REQUEST_INVALID', '请求体无法编码为 JSON');
    }
    invariant(body !== undefined, 'HTTP_REQUEST_INVALID', '请求体无法编码为 JSON');
    return { body, headers: { 'content-type': 'application/json; charset=utf-8' } };
}
function headers(...sources: (Readonly<Record<string, string>> | undefined)[]): Readonly<Record<string, string>> {
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const source of sources)
        for (const [name, value] of Object.entries(source ?? {})) {
            invariant(
                /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && typeof value === 'string' && !/[\r\n]/.test(value),
                'HTTP_REQUEST_INVALID',
                '请求头无效',
            );
            result[name.toLowerCase()] = value;
        }
    return Object.freeze(result);
}
function absolute(url: string): boolean {
    return /^https?:\/\/(?:\[[0-9a-f:.]+\]|[^\s/@?#:\\]+)(?::\d{1,5})?(?:[/?][^\s#\\]*)?$/i.test(url);
}
function timeout(value: number): number {
    invariant(
        Number.isFinite(value) && value > 0 && value <= 2147483647,
        'HTTP_REQUEST_INVALID',
        '超时必须为有效的正毫秒数',
    );
    return value;
}

/**
 * Scope 管理的 HTTP 客户端。每次请求独立取消、独立超时；不依赖浏览器 AbortController。
 * 网络失败不自动重试、不自动刷新凭据；协议、登录及幂等策略由业务服务负责。
 */
export class HttpClient {
    private readonly defaults: Readonly<Record<string, string>>;
    private readonly defaultTimeout: number;
    private readonly base: string;
    private pending = 0;
    /** 校验并复制静态配置；创建实例不会联网。 */
    constructor(private readonly options: HttpClientOptions) {
        this.options = Object.freeze({ ...options });
        this.base = options.baseUrl?.replace(/\/+$/, '') ?? '';
        invariant(
            !this.base || (absolute(this.base) && !this.base.includes('?')),
            'HTTP_REQUEST_INVALID',
            'baseUrl 必须是无查询参数的绝对 http(s) URL',
        );
        this.defaults = headers(options.headers);
        this.defaultTimeout = timeout(options.timeoutMs ?? 10000);
    }
    /**
     * 发送一次文本请求，接受全部 2xx。返回 Promise 已登记到 owner 的子 Scope。
     * @param input 请求配置；默认头仅允许用于 baseUrl 的同源 URL，跨源请创建独立客户端。
     * @param owner 请求所有者；取消立即使调用方收到 OperationCancelled，并通知传输层 abort。
     * @throws HttpError HTTP_STATUS/HTTP_NETWORK/HTTP_TIMEOUT；配置错误为 HTTP_REQUEST_INVALID。
     */
    request(input: HttpRequest, owner: Lifetime): Promise<HttpResponse> {
        owner.signal.throwIfAborted();
        const method = input.method ?? 'GET';
        invariant(
            ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method),
            'HTTP_REQUEST_INVALID',
            'HTTP 方法无效',
        );
        invariant(
            input.body === undefined || (typeof input.body === 'string' && method !== 'GET' && method !== 'HEAD'),
            'HTTP_REQUEST_INVALID',
            'GET/HEAD 不允许请求体，其他方法仅支持文本',
        );
        const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input.url);
        invariant(!hasScheme || absolute(input.url), 'HTTP_REQUEST_INVALID', '绝对 URL 必须是无凭据的 http(s) 地址');
        let url = hasScheme ? input.url : `${this.base}/${input.url.replace(/^\//, '')}`;
        invariant(
            absolute(url) && !input.url.startsWith('//') && !input.url.includes('#') && !input.url.includes('\\'),
            'HTTP_REQUEST_INVALID',
            '请求 URL 无效',
        );
        const origin = (value: string) => /^https?:\/\/[^/?#]+/i.exec(value)?.[0].toLowerCase();
        invariant(!this.base || origin(url) === origin(this.base), 'HTTP_REQUEST_INVALID', '客户端不能跨源发送请求');
        const query = Object.entries(input.query ?? {})
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => {
                invariant(
                    ['string', 'number', 'boolean'].includes(typeof value) &&
                        (typeof value !== 'number' || Number.isFinite(value)),
                    'HTTP_REQUEST_INVALID',
                    '查询参数必须为字符串、布尔值或有限数值',
                );
                return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
            })
            .join('&');
        if (query) url += `${url.includes('?') ? '&' : '?'}${query}`;
        const request = Object.freeze({
            url,
            method,
            headers: headers(this.defaults, input.headers),
            body: input.body,
        });
        const duration = timeout(input.timeoutMs ?? this.defaultTimeout);
        const scope = owner.child('http');
        let timedOut = false;
        let clear = () => {};
        const schedule =
            this.options.schedule ??
            ((callback, delayMs) => {
                const timer = setTimeout(callback, delayMs);
                return () => clearTimeout(timer);
            });
        this.pending++;
        const task = runTask(
            scope,
            async () => {
                clear = schedule(() => {
                    timedOut = true;
                    scope.cancel(new OperationCancelled('HTTP 请求超时'));
                }, duration);
                scope.signal.throwIfAborted();
                try {
                    const response = await untilCancelled(
                        this.options.transport.send(request, scope.signal),
                        scope.signal,
                    );
                    scope.signal.throwIfAborted();
                    if (
                        !Number.isInteger(response.status) ||
                        response.status < 100 ||
                        response.status > 599 ||
                        typeof response.body !== 'string'
                    )
                        throw new HttpError('HTTP_NETWORK', '传输返回了无效响应');
                    if (response.status < 200 || response.status >= 300)
                        throw new HttpError('HTTP_STATUS', `HTTP 状态 ${response.status}`, response.status);
                    return Object.freeze({ ...response, headers: headers(response.headers) });
                } catch (error) {
                    if (scope.signal.aborted) throw scope.signal.reason;
                    if (error instanceof HttpError) throw error;
                    throw new HttpError('HTTP_NETWORK', '网络传输失败');
                }
            },
            undefined,
            'http-request',
        );
        return task
            .catch((error: unknown) => {
                if (timedOut) throw new HttpError('HTTP_TIMEOUT', '请求超时');
                throw error;
            })
            .finally(async () => {
                clear();
                this.pending--;
                await scope.close();
            });
    }
    /**
     * 请求并解码 JSON。decode 必须验证 unknown 后返回 T，不能只用泛型断言外部数据可信。
     * 空正文传 undefined 给 decode；语法或结构校验失败统一抛 HTTP_DECODE。decode 只接受同步函数。
     */
    async json<T>(input: HttpRequest, owner: Lifetime, decode: (value: unknown) => T): Promise<T> {
        const response = await this.request(input, owner);
        owner.signal.throwIfAborted();
        try {
            const value: unknown = response.body.length ? JSON.parse(response.body) : undefined;
            const decoded = decode(value);
            if (decoded && typeof (decoded as unknown as Promise<unknown>).then === 'function') {
                void Promise.resolve(decoded).catch(() => {});
                throw Error('异步解码');
            }
            return decoded;
        } catch {
            throw new HttpError('HTTP_DECODE', '响应 JSON 或数据结构无效');
        }
    }
    /** 返回正在等待的请求数量；已取消但平台无法物理中止的下载不计入此数量。 */
    inspect(): { readonly pending: number } {
        return { pending: this.pending };
    }
}
