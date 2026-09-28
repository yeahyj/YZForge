import { _decorator, Label } from 'cc';
import type { ComponentContext } from '../ui/components/component-scope';
import { invariant } from '../core/errors';
import { LocalizedComponent } from './localized-component';
const { ccclass, property, requireComponent, disallowMultiple, menu } = _decorator;
@ccclass('yzforge.LocalizedTextParameter')
export class LocalizedTextParameter {
    @property({ displayName: '参数名' }) name = '';
    @property({ displayName: '参数值' }) value = '';
}
/** 在原生 Label 所在节点添加；翻译、字体与切换提交复用 ScopedLocalization。 */
@ccclass('yzforge.LocalizedLabel')
@menu('YZForge/多语言/文字绑定')
@requireComponent(Label)
@disallowMultiple
export class LocalizedLabel extends LocalizedComponent {
    @property({
        type: [LocalizedTextParameter],
        displayName: '固定参数',
        tooltip: '对应文案中的 {name}；变化的数值请在业务代码中使用 bindText/update。',
    })
    parameters: LocalizedTextParameter[] = [];
    protected previewParameters(): Record<string, string> {
        const values: Record<string, string> = Object.create(null) as Record<string, string>;
        for (const parameter of this.parameters) {
            invariant(
                parameter.name && !Object.prototype.hasOwnProperty.call(values, parameter.name),
                'I18N_PARAMETER_INVALID',
                '固定参数名为空或重复',
            );
            values[parameter.name] = parameter.value;
        }
        return values;
    }
    protected async localize(context: ComponentContext): Promise<void> {
        const bundle = await context.i18n!.useNamespace(this.resolveNamespace(context));
        await bundle.bindText(this.getComponent(Label)!, bundle.textKey(this.key), () => this.previewParameters());
    }
}
