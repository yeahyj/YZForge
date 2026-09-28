import { _decorator, Button, Label, Node, UITransform } from 'cc';
import { ResourceLabPageBinding } from './generated/ResourceLabPageBinding';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { Scope } from '../../../../../framework/core/scope';
import { OperationCancelled } from '../../../../../framework/core/errors';
import type { PrefabLease, PrefabPool } from '../../../../../framework/assets/prefab-pool';
import { ShowcaseRes } from '../../contracts/generated/resources-default';
import { ShowcaseBundles } from '../../contracts/generated/bundles';
import { ShowcaseI18n } from '../../contracts/generated/localization-default';
import type { LocalizedBinding } from '../../../../../framework/localization/localized-ui';
import type { TextKey } from '../../../../../framework/localization/localization';
import { BadgePart } from '../components/BadgePart';
const { ccclass } = _decorator;
/** 资源准备、实例池和语言 Bundle 的可删除业务示例。 */
@ccclass('showcase.ResourceLabPage')
export class ResourceLabPage extends ResourceLabPageBinding {
    private pool?: PrefabPool;
    private batch?: Scope;
    private leases: PrefabLease[] = [];
    private ids = new WeakMap<Node, number>();
    private sequence = 0;
    private poolText?: LocalizedBinding;

    protected async onShow(show: ViewShowContext<void, void>): Promise<void> {
        const i18n = await show.i18n.use(ShowcaseBundles.default);
        const text = ShowcaseI18n.text;
        this.leases = [];
        this.ids = new WeakMap();
        this.sequence = 0;
        const pool = (this.pool = show.assets.createPool(ShowcaseRes.prefab.prefabsBadgePart, {
            maxSize: 3,
            maxIdle: 3,
        }));
        const output = (text: string) =>
            show.commit(() => {
                this.lblOutput.string = text;
            });
        const error = (cause: unknown) => {
            if (!(cause instanceof OperationCancelled)) output(String(cause));
        };
        const captions: readonly [Button, TextKey<never>][] = [
            [this.btnBack, text.resourcesBack],
            [this.btnLanguage, text.resourcesLanguage],
            [this.btnLoad, text.resourcesLoad],
            [this.btnCancel, text.resourcesCancel],
            [this.btnWarm, text.resourcesWarm],
            [this.btnSpawn, text.resourcesSpawn],
            [this.btnRelease, text.resourcesRelease],
        ];
        await Promise.all([
            i18n.bindText(this.lblTitle, text.resourcesTitle),
            i18n.bindText(this.lblSubtitle, text.resourcesSubtitle),
            i18n.bindText(this.lblInfo, text.resourcesInfo, (reader) => ({
                fallback: reader.t(text.resourcesFallback),
            })),
            i18n.bindText(this.lblOutput, text.resourcesReady, (reader) => ({ locale: reader.locale })),
            i18n.bindSprite(this.sprLogo, ShowcaseI18n.asset.resourcesLogo),
            ...captions.map(([button, key]) => i18n.bindText(button.getComponentInChildren(Label)!, key)),
        ]);
        this.poolText = await i18n.bindText(this.lblPool, text.resourcesPool, () => {
            const { size, idle, borrowed } = pool.inspect();
            return { size, idle, borrowed };
        });
        show.listen(this.btnBack.node, Button.EventType.CLICK, () => show.ui.back());
        show.listen(
            this.btnLanguage.node,
            Button.EventType.CLICK,
            () =>
                show.actions.latest('language', (task) =>
                    this.ctx.i18n.setLocale(i18n.locale === 'zh-CN' ? 'en' : 'zh-CN', task.scope),
                ),
            error,
        );
        show.listen(
            this.btnLoad.node,
            Button.EventType.CLICK,
            () =>
                show.actions.exclusive('prepare', async () => {
                    await this.batch?.close();
                    const batch = (this.batch = show.scope.child('prepared-resources'));
                    try {
                        await this.ctx.assets.in(batch).loadMany(
                            {
                                picture: i18n.asset(ShowcaseI18n.asset.resourcesLogo),
                                sound: ShowcaseRes.audio.audioChime,
                                part: ShowcaseRes.prefab.prefabsBadgePart,
                            },
                            {
                                concurrency: 2,
                                onProgress: ({ completed, total }) => {
                                    output(i18n.t(text.resourcesProgress, { completed, total }));
                                },
                            },
                        );
                        output(i18n.t(text.resourcesLoaded));
                    } catch (cause) {
                        await batch.close();
                        if (this.batch === batch) this.batch = undefined;
                        if (cause instanceof OperationCancelled) output(i18n.t(text.resourcesCancelled));
                        else throw cause;
                    }
                }),
            error,
        );
        show.listen(this.btnCancel.node, Button.EventType.CLICK, () => {
            this.batch?.cancel();
        });
        show.listen(
            this.btnWarm.node,
            Button.EventType.CLICK,
            () =>
                show.actions.exclusive('pool', async (task) => {
                    await pool.prewarm(3, task.scope);
                    show.commit(() => this.renderPool());
                }),
            error,
        );
        show.listen(
            this.btnSpawn.node,
            Button.EventType.CLICK,
            () =>
                show.actions.exclusive('pool', async () => {
                    const lease = await pool.spawn(this.nodePool, show.scope, {
                        prepare: (node) => {
                            if (!this.ids.has(node)) this.ids.set(node, ++this.sequence);
                            for (const transform of node.getComponentsInChildren(UITransform))
                                transform.setContentSize(184, 74);
                            node.getComponentInChildren(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;
                            node.getComponent(BadgePart)!.render(
                                i18n.t(text.resourcesToken, { id: this.ids.get(node)! }),
                            );
                        },
                    });
                    try {
                        const itemLanguage = await show.i18n.in(lease.scope).use(ShowcaseBundles.default);
                        await itemLanguage.bindText(lease.node.getComponentInChildren(Label)!, text.resourcesToken, {
                            id: this.ids.get(lease.node)!,
                        });
                    } catch (cause) {
                        await lease.release();
                        throw cause;
                    }
                    if (
                        !show.commit(() => {
                            this.leases.push(lease);
                            this.renderPool();
                        })
                    )
                        await lease.release();
                }),
            error,
        );
        show.listen(
            this.btnRelease.node,
            Button.EventType.CLICK,
            () =>
                show.actions.exclusive('pool', async () => {
                    const leases = this.leases;
                    this.leases = [];
                    await Promise.all(leases.map((lease) => lease.release()));
                    show.commit(() => this.renderPool());
                }),
            error,
        );
    }
    private renderPool(): void {
        this.poolText?.refresh();
        for (const [index, lease] of this.leases.entries()) {
            lease.node.setPosition((index - (this.leases.length - 1) / 2) * 196, 0, 0);
        }
    }
    protected onHide(): void {
        this.leases = [];
        this.batch = undefined;
        this.pool = undefined;
        this.poolText = undefined;
    }
}
