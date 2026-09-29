import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalizedRecords } from '../tools/yzforge/localized-bindings.mjs';
import { decodeUuid } from '../tools/yzforge/catalog.mjs';
const classes = new Map([
    ['label-class', 'text'],
    ['sprite-class', 'sprite'],
    ['countdown-class', 'countdown'],
    ['marquee-class', 'marquee'],
    ['async-class', 'async-sprite'],
]);
const catalogs = new Map([
    [
        'shop/default',
        {
            texts: { greeting: '你好 {name} {{escaped}}', blank: '' },
            assets: { logo: { type: 'SpriteFrame' }, sound: { type: 'AudioClip' } },
        },
    ],
]);
const label = (input = {}) => [
    {
        __type__: 'label-class',
        node: { __id__: 1 },
        namespace: 'shop/default',
        key: 'greeting',
        parameters: [{ __id__: 2 }],
        ...input,
    },
    { _name: 'Title' },
    { name: 'name', value: '玩家' },
];

test('生成时拒绝多个组件争抢同一文字或图片，并指出可用的绑定入口', () => {
    for (const [type, expected] of [
        ['countdown-class', /bindCountdownFormat/],
        ['marquee-class', /MarqueeLabel/],
    ]) {
        const records = label();
        records.push({ __type__: type, node: { __id__: 1 } });
        assert.throws(() => validateLocalizedRecords(records, classes, catalogs), expected);
    }
    const nested = label();
    nested[1]._parent = { __id__: 3 };
    nested.push({ _name: 'Marquee' }, { __type__: 'marquee-class', node: { __id__: 3 } });
    assert.throws(() => validateLocalizedRecords(nested, classes, catalogs), /内部 Label/);
    const image = label({ __type__: 'sprite-class', key: 'logo' });
    image.push({ __type__: 'async-class', node: { __id__: 1 } });
    assert.throws(() => validateLocalizedRecords(image, classes, catalogs), /AsyncSprite/);
    validateLocalizedRecords([{ __type__: 'countdown-class' }], classes, catalogs);
});
test('原生绑定生成前检查支持参数对象引用和合法空文案', () => {
    validateLocalizedRecords(label(), classes, catalogs);
    validateLocalizedRecords(label({ key: 'blank', parameters: [] }), classes, catalogs);
    validateLocalizedRecords([{ __type__: 'sprite-class', namespace: 'shop/default', key: 'logo' }], classes, catalogs);
    validateLocalizedRecords(label({ namespace: '', key: '' }), classes, catalogs);
    assert.equal(decodeUuid('27b25ArPuZEoKRh/OvxOTV4'), '27b2502b-3ee6-44a0-a461-fcebf1393578');
});
test('语言键、类型、固定参数错误定位到节点；不扫描无关组件', () => {
    for (const [input, expected] of [
        [{ namespace: 'missing' }, /Title.*未登记/],
        [{ key: 'missing' }, /Title.*文案/],
        [{ parameters: [] }, /Title.*name/],
        [
            {
                parameters: [
                    { name: 'name', value: 'a' },
                    { name: 'name', value: 'b' },
                ],
            },
            /重复/,
        ],
    ])
        assert.throws(() => validateLocalizedRecords(label(input), classes, catalogs), expected);
    assert.throws(
        () =>
            validateLocalizedRecords(
                [{ __type__: 'sprite-class', namespace: 'shop/default', key: 'sound' }],
                classes,
                catalogs,
            ),
        /SpriteFrame/,
    );
    validateLocalizedRecords([{ __type__: 'ordinary', namespace: 'missing', key: 'unknown' }, null], classes, catalogs);
});

test('空来源按源资源自动解析；嵌套公共预制体保留自身归属，显式覆盖优先', () => {
    const auto = label({ namespace: '' });
    validateLocalizedRecords(auto, classes, catalogs, 'shop/default');
    assert.throws(() => validateLocalizedRecords(auto, classes, catalogs, ''), /自动归属失败/);
    const shared = label({ namespace: '' });
    shared[1]._prefab = { __id__: 3 };
    shared.push({ asset: { __uuid__: 'shared-prefab' } });
    validateLocalizedRecords(shared, classes, catalogs, 'other/default', { 'shared-prefab': 'shop/default' });
    assert.throws(() => validateLocalizedRecords(shared, classes, catalogs, 'shop/default', {}), /自动归属失败/);
    // 挂在嵌套预制体子节点上的组件可能没有自己的 asset UUID，必须沿父链解析。
    delete shared[1]._prefab;
    shared[1]._parent = { __id__: 4 };
    shared.push({ _prefab: { __id__: 3 } });
    validateLocalizedRecords(shared, classes, catalogs, 'other/default', { 'shared-prefab': 'shop/default' });
    shared[0].namespace = 'shop/default';
    validateLocalizedRecords(shared, classes, catalogs, 'other/default', {});
});
