import {
    isValid,
    Asset,
    game,
    Label,
    Sprite,
    SpriteFrame,
    serializeTag,
    type SerializationOutput,
    type SerializationContext,
} from 'cc';
import { EDITOR } from 'cc/env';

type PreviewField = {
    property: string;
    storage: string;
    original: unknown;
    preview: unknown;
    displayed: unknown;
    descriptor: PropertyDescriptor;
};
type Serialize = (output: SerializationOutput, context: SerializationContext) => void;

/** Creator 3.8 的实例级序列化钩子：画面使用预览值，保存、撤销快照和脚本重载使用原值。 */
export function previewLocalizedRenderer(target: Label | Sprite, value: string | SpriteFrame): () => void {
    if (!EDITOR) throw Error('多语言画面预览只能在编辑器使用');
    const fields: PreviewField[] = [];
    const originals = new Set<Asset>();
    let restored = false;
    let serializing = false;
    const record = target as unknown as Record<PropertyKey, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(target, serializeTag);
    const serialize = record[serializeTag] as Serialize | undefined;
    const saved = (field: PreviewField) => (field.displayed === field.preview ? field.original : field.displayed);
    const override = (property: string, storage: string, preview: unknown) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, storage);
        if (!descriptor?.configurable || !('value' in descriptor))
            throw Error(`当前 Creator 不支持预览属性 ${storage}`);
        const original = record[storage];
        if (original instanceof Asset && !originals.has(original)) {
            original.addRef();
            originals.add(original);
        }
        const field = { property, storage, original, preview, displayed: original, descriptor };
        fields.push(field);
        Object.defineProperty(target, storage, {
            configurable: true,
            enumerable: descriptor.enumerable,
            // Creator 的 Prefab 保存先 instantiate 再 serialize，复制和直接序列化都必须读取原值。
            get: () =>
                serializing || (game as unknown as { _isCloning: boolean })._isCloning ? saved(field) : field.displayed,
            set: (value: unknown) => {
                field.displayed = value;
            },
        });
        record[property] = preview;
    };
    const restore = () => {
        if (restored) return;
        restored = true;
        if (isValid(target, true)) {
            // 先还原内容，再还原自动尺寸模式，避免预览内容改变原节点尺寸。
            for (const field of [...fields].reverse()) record[field.property] = saved(field);
        }
        for (const field of fields)
            Object.defineProperty(target, field.storage, { ...field.descriptor, value: field.displayed });
        if (descriptor) Object.defineProperty(target, serializeTag, descriptor);
        else delete record[serializeTag];
        for (const asset of originals) asset.decRef();
    };
    Object.defineProperty(target, serializeTag, {
        configurable: true,
        value(output: SerializationOutput, context: SerializationContext) {
            serializing = true;
            try {
                if (serialize) serialize.call(target, output, context);
                else output.writeThis();
            } finally {
                serializing = false;
            }
        },
    });
    try {
        if (target instanceof Label && typeof value === 'string') {
            const overflow = target.overflow;
            override(
                'overflow',
                '_overflow',
                overflow === Label.Overflow.NONE || overflow === Label.Overflow.RESIZE_HEIGHT
                    ? Label.Overflow.CLAMP
                    : overflow,
            );
            override('string', '_string', value);
        } else if (target instanceof Sprite && value instanceof SpriteFrame) {
            override('sizeMode', '_sizeMode', Sprite.SizeMode.CUSTOM);
            override('spriteFrame', '_spriteFrame', value);
        } else throw Error('多语言预览内容与组件类型不匹配');
    } catch (error) {
        restore();
        throw error;
    }
    return restore;
}
