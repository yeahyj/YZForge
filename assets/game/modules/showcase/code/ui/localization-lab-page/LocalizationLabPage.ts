import { _decorator, Button } from 'cc';
import { LocalizationLabPageBinding } from './generated/LocalizationLabPageBinding';
import type { ViewShowContext } from '../../../../../../framework/ui/ui-view';
import { ShowcaseBundles } from '../../../contracts/generated/bundles';
import { ShowcaseI18n } from '../../../contracts/generated/localization-default';
import type { LocalizedBinding } from '../../../../../../framework/ui/localization/localized-ui';
const { ccclass } = _decorator;
/** 对照示例：前两项由代码绑定，后两项只在 Creator 的原生组件属性中配置。 */
@ccclass('showcase.LocalizationLabPage')
export class LocalizationLabPage extends LocalizationLabPageBinding {
    protected async onShow(show: ViewShowContext<void, void>): Promise<void> {
        const language = await show.i18n.use(ShowcaseBundles.default);
        let count = 0;
        // 动态文字：参数更新立即刷新，切换语言也读取当前值。
        const counter = await language.bindText(this.lblDynamic, ShowcaseI18n.text.exampleCounter, { count });
        let picture: LocalizedBinding | undefined;
        // 动态图片：bindSprite 内部用现有 Assets 加载，切换时先准备新图再提交。
        // 只取当前资源键时可调用 language.asset(ShowcaseI18n.asset['images/greeting'])。
        const loadImage = async () => {
            picture?.dispose();
            picture = await language.bindSprite(this.sprDynamic, ShowcaseI18n.asset['images/greeting']);
        };
        await loadImage();
        const error = (cause: unknown) =>
            show.commit(() => {
                this.lblStatus.string = String(cause);
            });
        show.listen(
            this.btnIncrement.node,
            Button.EventType.CLICK,
            () => {
                counter.update({ count: ++count });
            },
            error,
        );
        show.listen(this.btnLoad.node, Button.EventType.CLICK, () => show.actions.exclusive('image', loadImage), error);
        show.listen(
            this.btnLanguage.node,
            Button.EventType.CLICK,
            () =>
                show.actions.latest('language', (task) =>
                    show.i18n.in(task.scope).setLocale(show.i18n.locale === 'zh-CN' ? 'en' : 'zh-CN'),
                ),
            error,
        );
        show.listen(this.btnBack.node, Button.EventType.CLICK, () => show.ui.back(), error);
        // StaticText / StaticImage 节点上的原生组件自动绑定，此处不再逐个登记。
    }
}
