import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalizedRecords } from '../tools/yzforge/localized-bindings.mjs';
import { decodeUuid } from '../tools/yzforge/catalog.mjs';
const classes = new Map([
    ['label-class', 'text'],
    ['sprite-class', 'sprite'],
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
