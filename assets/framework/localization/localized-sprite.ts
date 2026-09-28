import { _decorator, Sprite } from 'cc';
import type { ComponentContext } from '../ui/components/component-scope';
import { LocalizedComponent } from './localized-component';
const { ccclass, requireComponent, disallowMultiple, menu } = _decorator;
/** 在原生 Sprite 所在节点添加；仅保存语言键，图片沿用框架资源引用与显示期限。 */
@ccclass('yzforge.LocalizedSprite')
@menu('YZForge/多语言/图片绑定')
@requireComponent(Sprite)
@disallowMultiple
export class LocalizedSprite extends LocalizedComponent {
    protected previewKind(): 'sprite' {
        return 'sprite';
    }
    protected async localize(context: ComponentContext): Promise<void> {
        const bundle = await context.i18n!.useNamespace(this.namespace);
        await bundle.bindSprite(this.getComponent(Sprite)!, bundle.assetKey(this.key, 'SpriteFrame'));
    }
}
