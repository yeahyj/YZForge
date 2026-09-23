import test from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../assets/framework/core/scope';
import { CancellationSource } from '../assets/framework/core/cancellation';
import {
    HttpClient,
    jsonBody,
    type HttpResponse,
    type TransportRequest,
} from '../assets/framework/network/http-client';
import { createWechatTransport, createXhrTransport } from '../assets/framework/network/transports';
import { deferred, flush } from './fake-clock';
const ok = (body = '{}'): HttpResponse => ({ status: 200, headers: {}, body });

test('网络：URL 编码、大小写无关请求头、JSON 验证、空正文', async () => {
    const scope = new Scope('request');
    let sent!: TransportRequest;
    const client = new HttpClient({
        baseUrl: 'https://example.test/v1/',
        headers: { Accept: 'a' },
        transport: {
            send: async (request) => {
                sent = request;
                return ok('{"id":7}');
            },
        },
    });
    const data = await client.json(
        {
            url: '/items?x=1',
            query: { text: '中文 &', page: 2, skip: undefined },
            method: 'POST',
            ...jsonBody({ name: 'a' }),
            headers: { ACCEPT: 'b' },
        },
        scope,
        (value) => {
            assert.equal(typeof (value as any).id, 'number');
            return (value as { id: number }).id;
        },
    );
    assert.equal(data, 7);
    assert.equal(sent.headers.accept, 'b');
    assert.equal(sent.url, 'https://example.test/v1/items?x=1&text=%E4%B8%AD%E6%96%87%20%26&page=2');
    assert.equal(sent.body, '{"name":"a"}');
    assert.equal(client.inspect().pending, 0);
    assert.equal(scope.inspect().children.length, 0);
    const empty = new HttpClient({ transport: { send: async () => ({ ...ok(''), status: 204 }) } });
    assert.equal(await empty.json({ url: 'https://example.test' }, scope, (value) => value), undefined);
    await scope.close();
});

test('网络：HTTP、断网、解码错误分类，不重试写入、不泄露响应及凭据', async () => {
    const scope = new Scope('request');
    let calls = 0;
    const client = new HttpClient({
        transport: {
            send: async () => {
                calls++;
                return { ...ok('private secret'), status: 503 };
            },
        },
    });
    await assert.rejects(
        client.request({ url: 'https://example.test', method: 'POST', body: 'payment' }, scope),
        (error: any) =>
            error.code === 'HTTP_STATUS' && error.status === 503 && !JSON.stringify(error).includes('secret'),
    );
    assert.equal(calls, 1);
    const failure = new HttpClient({ transport: { send: () => Promise.reject(Error('token=secret')) } });
    await assert.rejects(failure.request({ url: 'https://example.test' }, scope), { code: 'HTTP_NETWORK' });
    for (const body of ['bad json', '{"id":"wrong"}']) {
        const decode = new HttpClient({ transport: { send: async () => ok(body) } });
        await assert.rejects(
            decode.json({ url: 'https://example.test' }, scope, (value) => {
                if (typeof (value as any).id !== 'number') throw Error('bad');
                return value;
            }),
            { code: 'HTTP_DECODE' },
        );
    }
    await scope.close();
});

test('网络：超时中止，移除定时器和子 Scope，忽略不配合取消的迟到结果', async () => {
    const scope = new Scope('request'),
        response = deferred<HttpResponse>();
    let alarm = () => {},
        timers = 0,
        aborts = 0;
    const client = new HttpClient({
        schedule: (callback) => {
            alarm = callback;
            timers++;
            return () => {
                timers--;
            };
        },
        transport: {
            send: (_request, signal) => {
                signal.onAbort(() => {
                    aborts++;
                });
                return response.promise;
            },
        },
    });
    const pending = client.request({ url: 'https://example.test' }, scope);
    const checked = assert.rejects(pending, { code: 'HTTP_TIMEOUT' });
    await flush();
    alarm();
    await checked;
    assert.equal(timers, 0);
    assert.equal(aborts, 1);
    assert.equal(client.inspect().pending, 0);
    response.resolve(ok('late'));
    await flush();
    assert.equal(scope.inspect().children.length, 0);
    await scope.close();
});

test('网络：取消一个请求不影响并发请求，owner.close 无未处理拒绝或残留', async () => {
    const root = new Scope('request'),
        first = root.child('first'),
        second = root.child('second');
    const a = deferred<HttpResponse>(),
        b = deferred<HttpResponse>();
    const client = new HttpClient({
        transport: { send: (request) => (request.url.endsWith('/a') ? a.promise : b.promise) },
    });
    const pa = client.request({ url: 'https://example.test/a' }, first);
    const checked = assert.rejects(pa, { code: 'OPERATION_CANCELLED' });
    const pb = client.request({ url: 'https://example.test/b' }, second);
    await flush();
    await first.close();
    await checked;
    b.resolve(ok('b'));
    assert.equal((await pb).body, 'b');
    a.reject(Error('late transport failure'));
    await flush();
    await root.close();
    assert.equal(client.inspect().pending, 0);
});

test('网络：非法输入及跨源请求在发送前拒绝', async () => {
    const root = new Scope('request');
    let calls = 0;
    const client = new HttpClient({
        baseUrl: 'https://example.test',
        transport: {
            send: async () => {
                calls++;
                return ok();
            },
        },
    });
    for (const input of [
        { url: '//evil.test' },
        { url: 'https://evil.test' },
        { url: 'https://user:secret@example.test' },
        { url: 'ftp://example.test' },
        { url: 'http:/example.test' },
        { url: '/x', timeoutMs: 0 },
        { url: '/x', body: 'get-body' },
        { url: '/x', headers: { token: 'a\r\nb' } },
        { url: '/x#fragment' },
    ])
        assert.throws(() => client.request(input, root));
    assert.equal(calls, 0);
    assert.equal(root.inspect().children.length, 0);
    assert.throws(() => jsonBody(undefined));
    root.cancel();
    assert.throws(() => client.request({ url: '/x' }, root), { code: 'OPERATION_CANCELLED' });
    await root.close();
});

test('网络：XHR 适配响应、物理 abort、清理回调；不依赖 AbortController', async () => {
    const xhr: any = {
        open: () => {},
        setRequestHeader: () => {},
        send: () => {},
        abort: () => {
            xhr.aborts++;
            xhr.onabort?.();
        },
        aborts: 0,
        status: 200,
        responseText: 'ok',
        getAllResponseHeaders: () => 'X-Test: yes\r\nX-Test: twice',
    };
    const transport = createXhrTransport(() => xhr),
        signal = new CancellationSource();
    const pending = transport.send({ url: 'https://example.test', method: 'GET', headers: {} }, signal.signal);
    xhr.onload();
    assert.equal((await pending).headers['x-test'], 'yes, twice');
    assert.equal(xhr.onload, null);
    const cancelled = transport.send({ url: 'https://example.test', method: 'GET', headers: {} }, signal.signal);
    signal.cancel();
    await assert.rejects(cancelled, { code: 'OPERATION_CANCELLED' });
    assert.equal(xhr.aborts, 1);
    assert.equal(xhr.onerror, null);
});

test('网络：微信适配取消、迟到回调与同步回调均只完成一次', async () => {
    let callbacks: any,
        aborts = 0;
    const transport = createWechatTransport({
        request: (options) => {
            callbacks = options;
            return {
                abort: () => {
                    aborts++;
                },
            };
        },
    });
    const source = new CancellationSource();
    const pending = transport.send(
        { url: 'https://example.test', method: 'POST', headers: {}, body: '{}' },
        source.signal,
    );
    assert.equal(callbacks.dataType, 'text');
    assert.equal(callbacks.data, '{}');
    source.cancel();
    callbacks.success({ statusCode: 200, data: 'late', header: {} });
    await assert.rejects(pending, { code: 'OPERATION_CANCELLED' });
    assert.equal(aborts, 1);
    const sync = createWechatTransport({
        request: (options) => {
            options.success({ statusCode: 200, data: 'ok', header: { Name: 'value' } });
            return {
                abort: () => {
                    aborts++;
                },
            };
        },
    });
    const other = new CancellationSource();
    assert.equal(
        (await sync.send({ url: 'https://example.test', method: 'GET', headers: {} }, other.signal)).body,
        'ok',
    );
    other.cancel();
    assert.equal(aborts, 1);
});
