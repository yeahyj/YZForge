import test from 'node:test';
import assert from 'node:assert/strict';
import {
    Localization,
    parseLocaleCatalog,
    type TextKey,
    type LocalizedAssetKey,
    type LocaleReader,
    type LocaleBinding,
} from '../assets/framework/localization/localization';
import { Scope } from '../assets/framework/core/scope';
import { untilCancelled } from '../assets/framework/core/cancellation';
import { OperationCancelled } from '../assets/framework/core/errors';
import { deferred, flush } from './fake-clock';
const definition = {
    namespace: 'shop/default',
    contract: 'v1',
    catalogs: {
        'zh-CN': { bundle: 'shop', path: 'zh', revision: 'zh1' },
        en: { bundle: 'shop-en', path: 'en', revision: 'en1' },
        ja: { bundle: 'shop-ja', path: 'ja', revision: 'ja1' },
    },
};
const release = { defaultLocale: 'zh-CN', locales: ['zh-CN', 'en', 'ja', 'fr'], bundles: { shop: definition } };
const key = <P extends string = never>(name: string, params: readonly P[] = []) =>
    ({ namespace: 'shop/default', contract: 'v1', key: name, parameters: params }) as TextKey<P>;
const title = key('title', ['name']);
const logo: LocalizedAssetKey<'SpriteFrame'> = {
    namespace: 'shop/default',
    contract: 'v1',
    key: 'logo',
    type: 'SpriteFrame',
};
const catalog = (locale: string, texts: Record<string, string>, font: string | null = null) => ({
    formatVersion: 2,
    namespace: definition.namespace,
    contract: 'v1',
    locale,
    revision: definition.catalogs[locale as keyof typeof definition.catalogs].revision,
    texts,
    font: font ? { id: font, type: 'Font' } : null,
    assets: { logo: { id: locale + '/logo', type: 'SpriteFrame' } },
});
const zh = catalog('zh-CN', { title: '你好 {name}', fallback: '默认', empty: '默认', escaped: '{{name}}' }, 'chinese');
const en = catalog('en', { title: 'Hi {name}', empty: '' }, 'latin');
const ja = catalog('ja', { title: 'こんにちは {name}' });
const data: Record<string, unknown> = { zh, en, ja };
test('检查器字符串键在当前发布合同中解析，未知命名空间和键明确失败', async () => {
    const f = fixture();
    assert.deepEqual(f.i18n.bundle('shop/default'), { id: 'shop' });
    assert.throws(() => f.i18n.bundle('missing/default'), /missing/);
    const handle = await f.i18n.use(f.i18n.bundle('shop/default'), f.owner);
    const text = handle.reader.textKey('title');
    assert.deepEqual(text.parameters, ['name']);
    assert.equal(handle.reader.t(text, { name: '编辑器' }), '你好 编辑器');
    assert.equal(handle.reader.assetKey('logo', 'SpriteFrame').contract, 'v1');
    assert.throws(() => handle.reader.textKey('missing'), /missing/);
    assert.throws(() => handle.reader.assetKey('logo', 'Font'), /logo/);
    await f.root.close();
});
function fixture(loader?: (path: string, owner: Scope['lifetime']) => Promise<unknown>) {
    const root = new Scope('app'),
        owner = root.child('page'),
        calls: string[] = [];
    const i18n = new Localization(
        root,
        async (address, lifetime) => {
            calls.push(address.path);
            return loader ? loader(address.path, lifetime) : data[address.path];
        },
        release,
    );
    return { root, owner, calls, i18n };
}
function binding(
    target: { text: string },
    get: (reader: LocaleReader) => string,
    prepare?: (reader: LocaleReader) => Promise<void>,
): LocaleBinding {
    return {
        active: () => true,
        prepare: async (reader) => {
            await prepare?.(reader);
            let text = '';
            return {
                validate: () => {
                    text = get(reader);
                },
                commit: () => {
                    const before = target.text;
                    target.text = text;
                    return () => {
                        target.text = before;
                    };
                },
            };
        },
    };
}
test('按包 use 延迟加载；空翻译、回退文案和回退字体各自正确', async () => {
    const { root, owner, calls, i18n } = fixture();
    assert.deepEqual(calls, []);
    assert.equal(i18n.locale, 'zh-CN');
    const handle = await i18n.use('shop', owner);
    assert.deepEqual(calls, ['zh']);
    assert.equal(handle.t(title, { name: '甲' }), '你好 甲');
    await i18n.setLocale('en', owner);
    assert.equal(handle.t(title, { name: 'A' }), 'Hi A');
    assert.equal(handle.t(key('empty')), '');
    assert.equal(handle.reader.text(key('fallback')).font?.id, 'chinese');
    assert.equal(handle.reader.text(title, { name: 'A' }).font?.id, 'latin');
    assert.equal(handle.asset(logo).id, 'en/logo');
    await i18n.setLocale('fr', owner);
    assert.equal(handle.t(key('escaped')), '{name}');
    assert.equal(handle.locale, 'fr');
    await root.close();
});
test('不同基包目录互不混用，默认同一语言也校验合同', async () => {
    const { root, owner, i18n } = fixture();
    const handle = await i18n.use('shop', owner);
    assert.throws(() => handle.t({ ...key('fallback'), namespace: 'other/default' }), { code: 'I18N_KEY_CONTRACT' });
    assert.throws(() => handle.t({ ...key('fallback'), contract: 'old' }), { code: 'I18N_KEY_CONTRACT' });
    assert.throws(() => handle.t(key('absent')), { code: 'I18N_TEXT_MISSING' });
    await assert.rejects(i18n.use('shop-en', owner), { code: 'I18N_BUNDLE_UNKNOWN' });
    assert.throws(() => i18n.setLocale('missing', owner), { code: 'I18N_LOCALE_UNKNOWN' });
    assert.throws(() => parseLocaleCatalog({ ...en, revision: 'old' }, definition, 'en'), {
        code: 'I18N_CATALOG_INVALID',
    });
    await root.close();
});

test('列表条目共享只读字典与加载，最后一个使用者结束后才回收', async () => {
    const released: string[] = [];
    const { root, owner, calls, i18n } = fixture(async (path, lifetime) => {
        lifetime.defer(() => {
            released.push(path);
        });
        return data[path];
    });
    const items = Array.from({ length: 100 }, (_, i) => owner.child(`item:${i}`));
    const handles = await Promise.all(items.map((item) => i18n.use('shop', item)));
    const fallback = Reflect.get(handles[0].reader, 'current');
    assert.ok(Object.isFrozen(fallback.texts));
    assert.equal(new Set(handles.map((handle) => Reflect.get(handle.reader, 'current'))).size, 1);
    assert.deepEqual(calls, ['zh']);
    await items[0].close();
    assert.deepEqual(released, []);
    await i18n.setLocale('en', owner);
    assert.deepEqual(calls, ['zh', 'en']);
    assert.equal(new Set(handles.slice(1).map((handle) => Reflect.get(handle.reader, 'current'))).size, 1);
    for (const handle of handles.slice(1)) assert.equal(Reflect.get(handle.reader, 'fallback'), fallback);
    assert.deepEqual(released, []);
    await i18n.setLocale('zh-CN', owner);
    assert.deepEqual(released, ['en']);
    await owner.close();
    assert.deepEqual(released, ['en', 'zh']);
    await root.close();
});

test('共享加载中关闭一个条目不会取消其他条目', async () => {
    const started = deferred<void>(),
        gate = deferred<unknown>();
    let released = 0;
    const { root, owner, calls, i18n } = fixture(async (_path, lifetime) => {
        lifetime.defer(() => {
            released++;
        });
        started.resolve();
        return untilCancelled(gate.promise, lifetime.signal);
    });
    const first = owner.child('first'),
        second = owner.child('second');
    const cancelled = assert.rejects(i18n.use('shop', first), { code: 'OPERATION_CANCELLED' });
    const remaining = i18n.use('shop', second);
    await started.promise;
    await first.close();
    await cancelled;
    gate.resolve(zh);
    assert.equal((await remaining).t(key('fallback')), '默认');
    assert.deepEqual(calls, ['zh']);
    assert.equal(released, 0);
    await second.close();
    assert.equal(released, 1);
    await root.close();
});

test('所有等待者取消后迟到目录被回收；App 关闭也等待共享加载清理', async () => {
    const started = deferred<void>(),
        gate = deferred<unknown>(),
        released = deferred<void>();
    const { root, owner, i18n } = fixture(async (_path, lifetime) => {
        lifetime.defer(() => released.resolve());
        started.resolve();
        return gate.promise;
    });
    const cancelled = assert.rejects(i18n.use('shop', owner), { code: 'OPERATION_CANCELLED' });
    await started.promise;
    await owner.close();
    await cancelled;
    gate.resolve(zh);
    await released.promise;
    await root.close();
    assert.deepEqual(root.inspect().children, []);

    const loading = deferred<void>(),
        pending = deferred<unknown>();
    let closed = false;
    const next = fixture(async (_path, lifetime) => {
        lifetime.defer(() => {
            closed = true;
        });
        loading.resolve();
        return untilCancelled(pending.promise, lifetime.signal);
    });
    const ended = assert.rejects(next.i18n.use('shop', next.owner), { code: 'OPERATION_CANCELLED' });
    await loading.promise;
    await next.root.close();
    await ended;
    assert.equal(closed, true);
    assert.deepEqual(next.root.inspect().children, []);
});

test('字典解析失败可重试，缓存按命名空间、合同、路由和内容版本区分', async () => {
    let input: unknown = { ...zh, revision: 'invalid' };
    const { root, owner, calls, i18n } = fixture(async () => input);
    await assert.rejects(i18n.use('shop', owner), { code: 'I18N_CATALOG_INVALID' });
    input = zh;
    const original = await i18n.use('shop', owner);
    const variants = [
        { ...definition, namespace: 'other/default' },
        { ...definition, contract: 'v2' },
        { ...definition, catalogs: { 'zh-CN': { ...definition.catalogs['zh-CN'], revision: 'zh2' } } },
        { ...definition, catalogs: { 'zh-CN': { ...definition.catalogs['zh-CN'], path: 'other' } } },
        { ...definition, catalogs: { 'zh-CN': { ...definition.catalogs['zh-CN'], bundle: 'other' } } },
    ];
    for (const variant of variants) {
        input = {
            ...zh,
            namespace: variant.namespace,
            contract: variant.contract,
            revision: variant.catalogs['zh-CN'].revision,
        };
        const reader = await i18n.read(variant, 'zh-CN', owner);
        assert.notEqual(Reflect.get(reader, 'current'), Reflect.get(original.reader, 'current'));
    }
    assert.equal(calls.length, variants.length + 2);
    await root.close();
});

test('首次绑定加载被语言提交打断后重试，仍参与后续切换', async () => {
    const { root, owner, i18n } = fixture();
    const started = deferred<void>(),
        gate = deferred<void>(),
        target = { text: 'original' },
        prepared: string[] = [];
    const handle = await i18n.use('shop', owner);
    const bound = assert.doesNotReject(
        handle.bind(
            {
                active: () => true,
                prepare: async (reader, lifetime) => {
                    prepared.push(reader.locale);
                    if (reader.locale === 'zh-CN') {
                        started.resolve();
                        await untilCancelled(gate.promise, lifetime.signal);
                    }
                    return binding(target, (value) => value.locale).prepare(reader, lifetime);
                },
            },
            owner,
        ),
    );
    await started.promise;
    await i18n.setLocale('en', owner);
    await bound;
    assert.equal(owner.signal.aborted, false);
    assert.equal(target.text, 'en');
    assert.deepEqual(prepared, ['zh-CN', 'en']);
    await i18n.setLocale('ja', owner);
    assert.equal(target.text, 'ja');
    await root.close();
});

test('首次绑定的真实失败和使用者结束仍向上传递，不误重试', async () => {
    const { root, owner, i18n } = fixture();
    const handle = await i18n.use('shop', owner);
    for (const failure of [Error('network'), new OperationCancelled('current request cancelled')]) {
        let calls = 0;
        await assert.rejects(
            handle.bind(
                {
                    active: () => true,
                    prepare: async () => {
                        calls++;
                        throw failure;
                    },
                },
                owner,
            ),
            (error) => error === failure,
        );
        assert.equal(calls, 1);
    }
    const started = deferred<void>(),
        gate = deferred<void>(),
        item = owner.child('item');
    let attempts = 0;
    const cancelled = assert.rejects(
        handle.bind(
            {
                active: () => true,
                prepare: async (_reader, lifetime) => {
                    attempts++;
                    started.resolve();
                    await untilCancelled(gate.promise, lifetime.signal);
                    throw Error('unreachable');
                },
            },
            item,
        ),
        { code: 'OPERATION_CANCELLED' },
    );
    await started.promise;
    await item.close();
    await cancelled;
    await i18n.setLocale('en', owner);
    assert.equal(attempts, 1);
    await root.close();
});
test('已登记文件下载失败不回退，失败保留当前目录与所有绑定', async () => {
    let fail = true;
    const { root, owner, i18n } = fixture(async (path) => {
        if (path === 'en' && fail) throw Error('network');
        return data[path];
    });
    const handle = await i18n.use('shop', owner),
        target = { text: '' };
    await handle.bind(
        binding(target, (reader) => reader.t(title, { name: 'A' })),
        owner,
    );
    await assert.rejects(i18n.setLocale('en', owner), /network/);
    assert.equal(target.text, '你好 A');
    assert.equal(i18n.locale, 'zh-CN');
    fail = false;
    await i18n.setLocale('en', owner);
    assert.equal(target.text, 'Hi A');
    await root.close();
});
test('绑定全部准备后提交，加载期间的参数更新采用最新值', async () => {
    const { root, owner, i18n } = fixture(),
        gate = deferred<void>();
    const handle = await i18n.use('shop', owner),
        text = { text: '' },
        image = { text: '' };
    let name = 'old';
    const textBinding = await handle.bind(
        binding(text, (reader) => reader.t(title, { name })),
        owner,
    );
    await handle.bind(
        binding(
            image,
            (reader) => reader.asset(logo).id,
            async (reader) => {
                if (reader.locale === 'en') await gate.promise;
            },
        ),
        owner,
    );
    const switching = i18n.setLocale('en', owner);
    await flush();
    name = 'new';
    textBinding.refresh();
    assert.equal(text.text, '你好 new');
    assert.equal(image.text, 'zh-CN/logo');
    gate.resolve();
    await switching;
    assert.equal(text.text, 'Hi new');
    assert.equal(image.text, 'en/logo');
    await root.close();
});
test('资源准备失败与参数校验失败都不能部分提交', async () => {
    const { root, owner, i18n } = fixture();
    const handle = await i18n.use('shop', owner),
        a = { text: '' },
        b = { text: '' };
    await handle.bind(
        binding(a, (reader) => reader.t(key('empty'))),
        owner,
    );
    await handle.bind(
        binding(b, (reader) => {
            if (reader.locale === 'en') throw Error('bad params');
            return reader.locale;
        }),
        owner,
    );
    await assert.rejects(i18n.setLocale('en', owner), /bad params/);
    assert.equal(a.text, '默认');
    assert.equal(b.text, 'zh-CN');
    await root.close();
});
test('连续切换最后请求获胜，切回已提交语言也撤销在途请求', async () => {
    const slow = deferred<unknown>();
    const { root, owner, i18n } = fixture(async (path) => (path === 'en' ? slow.promise : data[path]));
    const handle = await i18n.use('shop', owner);
    const english = i18n.setLocale('en', owner);
    const rejected = assert.rejects(english, { code: 'OPERATION_CANCELLED' });
    await flush();
    await i18n.setLocale('ja', owner);
    await rejected;
    slow.resolve(en);
    await flush();
    assert.equal(handle.locale, 'ja');
    assert.equal(i18n.locale, 'ja');
    await root.close();
});
test('切换期间新 use 等待提交，未使用目录不加载，关闭页面不再参与', async () => {
    const gate = deferred<void>();
    const { root, owner, i18n, calls } = fixture();
    const handle = await i18n.use('shop', owner),
        target = { text: '' };
    await handle.bind(
        binding(
            target,
            (reader) => reader.locale,
            async (reader) => {
                if (reader.locale === 'en') await gate.promise;
            },
        ),
        owner,
    );
    const switching = i18n.setLocale('en', root),
        second = root.child('second');
    const opening = i18n.use('shop', second);
    await flush();
    assert.equal(calls.filter((path) => path === 'en').length, 1);
    owner.cancel();
    gate.resolve();
    await switching;
    const next = await opening;
    assert.equal(next.locale, 'en');
    assert.equal(target.text, 'zh-CN');
    await owner.close();
    await second.close();
    calls.length = 0;
    await i18n.setLocale('ja', root);
    assert.deepEqual(calls, []);
    await root.close();
});
test('绑定提前结束与实例复用不会让迟到结果覆盖新使用者', async () => {
    const gate = deferred<void>(),
        { root, owner, i18n } = fixture();
    const handle = await i18n.use('shop', owner),
        first = owner.child('lease1'),
        second = owner.child('lease2'),
        target = { text: '' };
    await handle.bind(
        binding(
            target,
            (reader) => reader.locale + '/old',
            async (reader) => {
                if (reader.locale === 'en') await gate.promise;
            },
        ),
        first,
    );
    const switching = i18n.setLocale('en', owner);
    await flush();
    await first.close();
    const replacing = handle.bind(
        binding(target, (reader) => reader.locale + '/new'),
        second,
    );
    gate.resolve();
    await switching;
    await replacing;
    assert.equal(target.text, 'en/new');
    await root.close();
});
test('旧目录回收异常单独上报，已提交切换依然成功且不受调用者晚取消影响', async () => {
    const reports: unknown[] = [],
        original = console.error;
    console.error = (...values: unknown[]) => {
        reports.push(values);
    };
    try {
        const gate = deferred<void>(),
            cleaning = deferred<void>();
        const { root, owner, i18n } = fixture(async (path, lifetime) => {
            if (path === 'en') {
                lifetime.defer(async () => {
                    cleaning.resolve();
                    await gate.promise;
                    throw Error('release');
                });
            }
            return data[path];
        });
        await i18n.use('shop', owner);
        await i18n.setLocale('en', owner);
        const caller = root.child('caller'),
            switching = i18n.setLocale('ja', caller);
        await cleaning.promise;
        assert.equal(i18n.locale, 'ja');
        caller.cancel();
        gate.resolve();
        await switching;
        assert.ok(JSON.stringify(reports).includes('I18N_PREVIOUS_CLEANUP_FAILED'));
        await root.close();
    } finally {
        console.error = original;
    }
});
