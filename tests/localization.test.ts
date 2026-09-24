import test from 'node:test';
import assert from 'node:assert/strict';
import { Localization, parseLocaleCatalog } from '../assets/framework/localization/localization';
import { Scope } from '../assets/framework/core/scope';
import { deferred, flush } from './fake-clock';

const options = {
    defaultLocale: 'zh-CN',
    catalogs: {
        'zh-CN': { id: 'zh', type: 'JsonAsset' },
        en: { id: 'en', type: 'JsonAsset' },
        ja: { id: 'ja', type: 'JsonAsset' },
    },
} as const;
const zh = {
    formatVersion: 1,
    locale: 'zh-CN',
    texts: { title: '你好，{name}', fallback: '默认', empty: '默认非空', escaped: '{{name}} = {count}' },
    assets: { logo: { id: 'common/zh/sprite/logo', type: 'SpriteFrame' } },
};
const en = {
    formatVersion: 1,
    locale: 'en',
    texts: { title: 'Hello, {name}', empty: '' },
    assets: { logo: { id: 'common/en/sprite/logo', type: 'SpriteFrame' } },
};
const ja = { formatVersion: 1, locale: 'ja', texts: { title: 'こんにちは、{name}' } };
test('多语言按需加载、参数替换、默认回退和类型化资源 Key', async () => {
    const root = new Scope('i18n'),
        calls: string[] = [],
        released: string[] = [];
    const source: Record<string, unknown> = { zh, en, ja };
    const i18n = new Localization(
        root,
        async (key, owner) => {
            calls.push(key.id);
            owner.defer(() => {
                released.push(key.id);
            });
            return source[key.id];
        },
        options,
    );
    await Promise.all([i18n.initialize(), i18n.initialize()]);
    assert.deepEqual(calls, ['zh']);
    assert.equal(i18n.t('title', { name: '玩家' }), '你好，玩家');
    assert.equal(i18n.t('escaped', { count: 3 }), '{name} = 3');
    assert.throws(() => i18n.t('title'), { code: 'I18N_PARAMETER_MISSING' });
    await i18n.setLocale('en', root);
    assert.deepEqual(calls, ['zh', 'en']);
    assert.equal(i18n.t('title', { name: 'Alice' }), 'Hello, Alice');
    assert.equal(i18n.t('fallback'), '默认');
    assert.equal(i18n.t('empty'), '');
    assert.equal(i18n.t('unknown'), 'unknown');
    assert.equal(i18n.has('unknown'), false);
    assert.equal(i18n.asset('logo', 'SpriteFrame').id, 'common/en/sprite/logo');
    assert.throws(() => i18n.asset('logo', 'Font'), { code: 'I18N_ASSET_TYPE' });
    await i18n.setLocale('en', root);
    assert.deepEqual(calls, ['zh', 'en']);
    await i18n.setLocale('ja', root);
    assert.deepEqual(released, ['en']);
    assert.equal(i18n.asset('logo', 'SpriteFrame').id, 'common/zh/sprite/logo');
    await root.close();
    assert.deepEqual(released.sort(), ['en', 'ja', 'zh']);
    assert.throws(() => i18n.t('title', { name: 'late' }), { code: 'OPERATION_CANCELLED' });
});
test('切换失败保留旧语言且允许重试，翻译参数与资源类型必须兼容', async () => {
    const root = new Scope('i18n');
    let current: unknown = { ...en, texts: { title: 'Hi {wrong}' } };
    const i18n = new Localization(root, async (key) => (key.id === 'zh' ? zh : current), options);
    await i18n.initialize();
    await assert.rejects(i18n.setLocale('en', root), { code: 'I18N_PARAMETERS_MISMATCH' });
    assert.equal(i18n.locale, 'zh-CN');
    current = { ...en, assets: { logo: { id: 'font', type: 'Font' } } };
    await assert.rejects(i18n.setLocale('en', root), { code: 'I18N_ASSET_TYPE' });
    current = en;
    await i18n.setLocale('en', root);
    assert.equal(i18n.locale, 'en');
    await root.close();
});
test('连续切换只有最后一次提交，旧加载迟到不覆盖新语言且回收资源', async () => {
    const root = new Scope('root'),
        slow = deferred<unknown>(),
        calls: string[] = [],
        released: string[] = [];
    const i18n = new Localization(
        root,
        async (key, owner) => {
            calls.push(key.id);
            owner.defer(() => {
                released.push(key.id);
            });
            return key.id === 'zh' ? zh : key.id === 'en' ? slow.promise : ja;
        },
        options,
    );
    await i18n.initialize();
    const before = assert.rejects(i18n.setLocale('en', root), { code: 'OPERATION_CANCELLED' });
    await flush();
    assert.deepEqual(calls, ['zh', 'en']);
    await i18n.setLocale('ja', root);
    await before;
    assert.equal(i18n.locale, 'ja');
    slow.resolve(en);
    await flush();
    assert.equal(i18n.locale, 'ja');
    assert.ok(released.includes('en'));
    await root.close();
});
test('页面取消及时返回，应用关闭等待底层加载收尾；成功语言不随页面关闭回退', async () => {
    const root = new Scope('root'),
        page = new Scope('page'),
        gate = deferred<unknown>();
    let cleaned = false;
    const i18n = new Localization(
        root,
        async (key, owner) => {
            if (key.id === 'zh') return zh;
            owner.defer(() => {
                cleaned = true;
            });
            return gate.promise;
        },
        options,
    );
    await i18n.initialize();
    const failed = assert.rejects(i18n.setLocale('en', page), { code: 'OPERATION_CANCELLED' });
    await flush();
    await page.close();
    await failed;
    assert.equal(i18n.locale, 'zh-CN');
    const closing = root.close();
    await flush();
    assert.equal(root.closed, false);
    gate.resolve(en);
    await closing;
    assert.equal(cleaned, true);
    const nextRoot = new Scope('next'),
        nextPage = nextRoot.child('page');
    const next = new Localization(nextRoot, async (key) => (key.id === 'zh' ? zh : en), options);
    await next.initialize();
    await next.setLocale('en', nextPage);
    await nextPage.close();
    assert.equal(next.locale, 'en');
    await nextRoot.close();
});
test('订阅按使用期独立解绑，广播中移除的订阅不再执行', async () => {
    const root = new Scope('root'),
        page = root.child('page');
    const i18n = new Localization(root, async (key) => (key.id === 'zh' ? zh : en), options);
    await i18n.initialize();
    let hits = 0,
        off = () => {};
    const callback = () => {
        hits++;
    };
    const first = i18n.subscribe(() => {
        off();
    }, root);
    off = i18n.subscribe(callback, root);
    i18n.subscribe(callback, page);
    assert.equal(hits, 2);
    await i18n.setLocale('en', root);
    assert.equal(hits, 3);
    await page.close();
    first();
    off();
    await i18n.setLocale('zh-CN', root);
    assert.equal(hits, 3);
    await root.close();
});
test('语言 JSON 严格校验身份、数据和资源，未配置时初始化不加载', async () => {
    for (const data of [
        null,
        { ...zh, locale: 'en' },
        { ...zh, formatVersion: 2 },
        { ...zh, texts: { x: 1 } },
        { ...zh, assets: { icon: { type: 'bad', id: 'x' } } },
    ])
        assert.throws(() => parseLocaleCatalog(data, 'zh-CN'));
    const source = JSON.parse(JSON.stringify(zh)),
        parsed = parseLocaleCatalog(source, 'zh-CN');
    source.texts.title = 'changed';
    assert.equal(parsed.texts.title, zh.texts.title);
    assert.equal(Object.isFrozen(parsed.assets!.logo), true);
    const root = new Scope('none');
    let calls = 0;
    const i18n = new Localization(root, async () => {
        calls++;
        return zh;
    });
    await i18n.initialize();
    assert.equal(calls, 0);
    assert.throws(() => i18n.setLocale('zh-CN', root), { code: 'I18N_LOCALE_UNKNOWN' });
    await root.close();
});

test('语言提交后的旧目录清理失败单独上报，不把成功切换返回为失败', async (t) => {
    const reports: unknown[] = [];
    t.mock.method(console, 'error', (_tag: string, error: unknown) => {
        reports.push(error);
    });
    const root = new Scope('localization-cleanup');
    const i18n = new Localization(
        root,
        async (key, owner) => {
            if (key.id === 'en')
                owner.defer(() => {
                    throw Error('old catalog cleanup');
                });
            return key.id === 'zh' ? zh : key.id === 'en' ? en : ja;
        },
        options,
    );
    await i18n.initialize();
    await i18n.setLocale('en', root);
    const seen: string[] = [];
    i18n.subscribe((locale) => {
        seen.push(locale);
    }, root);
    await i18n.setLocale('ja', root);
    assert.equal(i18n.locale, 'ja');
    assert.deepEqual(seen, ['en', 'ja']);
    assert.equal(reports.length, 1);
    assert.equal((reports[0] as { code: string }).code, 'I18N_PREVIOUS_CLEANUP_FAILED');
    await i18n.setLocale('zh-CN', root);
    await root.close();
});

test('旧目录清理期间再次切换或关闭应用，不撤销已经提交的成功结果', async () => {
    const root = new Scope('root'),
        gate = deferred();
    const i18n = new Localization(
        root,
        async (key, owner) => {
            if (key.id === 'en') owner.defer(() => gate.promise);
            return key.id === 'zh' ? zh : key.id === 'en' ? en : ja;
        },
        options,
    );
    await i18n.initialize();
    await i18n.setLocale('en', root);
    let completed = false;
    const switching = i18n.setLocale('ja', root).then(() => {
        completed = true;
    });
    await flush();
    assert.equal(i18n.locale, 'ja');
    assert.equal(completed, false);
    await i18n.setLocale('zh-CN', root);
    assert.equal(i18n.locale, 'zh-CN');
    const closing = root.close();
    await flush();
    assert.equal(root.closed, false);
    assert.equal(completed, false);
    gate.resolve();
    await switching;
    await closing;
    assert.equal(completed, true);
    assert.equal(root.closed, true);
});
