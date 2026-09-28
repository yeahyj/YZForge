import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveValue, savedBindings, writeSavedValue } from '../tools/yzforge/localization-apply.cjs';
import { validateDefaultLanguageReferences } from '../tools/yzforge/localized-bindings.mjs';
import { decodeUuid } from '../tools/yzforge/catalog.mjs';

const fallback = {
    locale: 'zh-CN',
    texts: { greeting: '你好 {name} {{name}}', missing: '默认文案' },
    assets: { logo: { id: 'logo-cn', type: 'SpriteFrame' } },
    font: { id: 'font-cn', type: 'Font' },
};
const current = {
    locale: 'en',
    texts: { greeting: 'Hello {name}', empty: '' },
    assets: { logo: { id: 'logo-en', type: 'SpriteFrame' } },
    font: { id: 'font-en', type: 'Font' },
};
const uuid = (key) => key.id + '-uuid';
test('面板应用与运行时一致：缺译与字体回退、固定参数、空文案和不同语言图片', () => {
    assert.deepEqual(resolveValue({ kind: 'text', key: 'missing' }, current, fallback, uuid), {
        text: '默认文案',
        font: 'font-cn-uuid',
        locale: 'zh-CN',
    });
    assert.equal(resolveValue({ kind: 'text', key: 'empty' }, current, fallback, uuid).text, '');
    assert.deepEqual(
        resolveValue(
            { kind: 'text', key: 'greeting', parameters: [{ name: 'name', value: 'YZ' }] },
            fallback,
            fallback,
            uuid,
        ),
        { text: '你好 YZ {name}', font: 'font-cn-uuid', locale: 'zh-CN' },
    );
    assert.equal(resolveValue({ kind: 'sprite', key: 'logo' }, current, fallback, uuid).spriteFrame, 'logo-en-uuid');
    assert.throws(() => resolveValue({ kind: 'text', key: 'greeting' }, current, fallback, uuid), /缺少固定参数/);
    assert.throws(
        () =>
            resolveValue(
                {
                    kind: 'text',
                    key: 'greeting',
                    parameters: [
                        { name: 'name', value: 'a' },
                        { name: 'name', value: 'b' },
                    ],
                },
                current,
                fallback,
                uuid,
            ),
        /重复/,
    );
    assert.throws(() => resolveValue({ kind: 'sprite', key: 'unknown' }, current, fallback, uuid), /语言键不存在/);
});

test('批量更新只改变对应原生字段，保留节点身份、样式和原生布局模式', () => {
    const records = [
        { __type__: 'cc.Prefab', data: { __id__: 1 } },
        { __type__: 'cc.Node', _name: 'Title', _components: [{ __id__: 2 }, { __id__: 3 }], _prefab: { __id__: 4 } },
        { __type__: 'cc.Label', _string: 'old', _font: null, _overflow: 0, _fontSize: 26, _id: 'original-component' },
        { __type__: 'label-id', node: { __id__: 1 }, namespace: '', key: 'greeting', parameters: [{ __id__: 5 }] },
        { __type__: 'cc.PrefabInfo', asset: { __uuid__: 'source-prefab' }, fileId: 'stable-node' },
        { name: 'name', value: 'Player' },
    ];
    const before = structuredClone(records);
    const { bindings, nested } = savedBindings(records, new Map([['label-id', 'text']]), 'source-prefab', decodeUuid);
    assert.equal(nested, 0);
    assert.equal(bindings[0].source, 'source-prefab');
    writeSavedValue(bindings[0].target, resolveValue(bindings[0], current, fallback, uuid));
    assert.equal(records[2]._string, 'Hello Player');
    assert.equal(records[2]._font.__uuid__, 'font-en-uuid');
    assert.equal(records[2]._isSystemFontUsed, false);
    assert.equal(records[2]._id, before[2]._id);
    assert.equal(records[2]._fontSize, 26);
    assert.equal(records[2]._overflow, 0);
    for (const i of [0, 1, 3, 4, 5]) assert.deepEqual(records[i], before[i]);
    writeSavedValue(records[2], { text: '系统字体', font: null }, true);
    assert.equal(records[2]._font, null);
    assert.equal(records[2]._isSystemFontUsed, true);
});

test('批量保留嵌套实例覆盖，不把源预制体的绑定误写到外层文件', () => {
    const records = [
        { __type__: 'sprite-id', key: 'logo', node: { __id__: 1 } },
        { _name: 'NestedChild', _parent: { __id__: 2 } },
        { _prefab: { __id__: 3 } },
        { asset: { __uuid__: 'nested-source' } },
    ];
    const original = structuredClone(records);
    assert.deepEqual(savedBindings(records, new Map([['sprite-id', 'sprite']]), 'outer-source', decodeUuid), {
        bindings: [],
        nested: 1,
    });
    assert.deepEqual(records, original);
});

test('构建前允许默认语言引用，定位原生组件与嵌套覆盖中遗留的其他语言资源', () => {
    const assets = new Map([
        ['cn-image@frame', 'zh-CN'],
        ['en-image', 'en'],
        ['en-font', 'en'],
    ]);
    const records = [
        { _name: 'Logo' },
        { __type__: 'cc.Sprite', node: { __id__: 0 }, _spriteFrame: { __uuid__: 'cn-image@frame' } },
    ];
    validateDefaultLanguageReferences(records, assets, 'zh-CN');
    records[1]._spriteFrame.__uuid__ = 'en-image@frame';
    assert.throws(() => validateDefaultLanguageReferences(records, assets, 'zh-CN'), /Logo.*en.*默认语言 zh-CN/);
    assert.throws(
        () =>
            validateDefaultLanguageReferences(
                [{ propertyOverrides: [{ value: { __uuid__: 'en-font' } }] }],
                assets,
                'zh-CN',
            ),
        /en-font/,
    );
    validateDefaultLanguageReferences([{ __uuid__: 'ordinary-image' }], assets, 'zh-CN');
});
