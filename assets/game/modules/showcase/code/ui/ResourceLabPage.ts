import { _decorator, Button, Label, Node, UITransform } from 'cc';
import { ResourceLabPageBinding } from './generated/ResourceLabPageBinding';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { Scope } from '../../../../../framework/core/scope';
import { OperationCancelled } from '../../../../../framework/core/errors';
import type { PrefabLease, PrefabPool } from '../../../../../framework/assets/prefab-pool';
import { ShowcaseRes } from '../../contracts/generated/resources-default';
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

    protected onShow(show: ViewShowContext<void, void>): void {
        const i18n = this.ctx.i18n;
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
        const captions: readonly [Button, string][] = [
            [this.btnBack, 'back'],
            [this.btnLanguage, 'language'],
            [this.btnLoad, 'load'],
            [this.btnCancel, 'cancel'],
            [this.btnWarm, 'warm'],
            [this.btnSpawn, 'spawn'],
            [this.btnRelease, 'release'],
        ];
        i18n.subscribe(() => {
            show.commit(() => {
                this.lblTitle.string = i18n.t('resources.title');
                this.lblSubtitle.string = i18n.t('resources.subtitle');
                this.lblInfo.string = i18n.t('resources.info', { fallback: i18n.t('resources.fallback') });
                for (const [button, key] of captions)
                    button.getComponentInChildren(Label)!.string = i18n.t(`resources.${key}`);
                this.renderPool();
                this.lblOutput.string = i18n.t('resources.ready', { locale: i18n.locale! });
            });
            void show
                .run(() => show.assets.setSprite(this.sprLogo, i18n.asset('resources.logo', 'SpriteFrame')))
                .catch(error);
        }, show.scope);
        show.listen(this.btnBack.node, Button.EventType.CLICK, () => show.ui.back());
        show.listen(
            this.btnLanguage.node,
            Button.EventType.CLICK,
            () =>
                show.actions.latest('language', (task) =>
                    i18n.setLocale(i18n.locale === 'zh-CN' ? 'en' : 'zh-CN', task.scope),
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
                                picture: i18n.asset('resources.logo', 'SpriteFrame'),
                                sound: ShowcaseRes.audio.audioChime,
                                part: ShowcaseRes.prefab.prefabsBadgePart,
                            },
                            {
                                concurrency: 2,
                                onProgress: ({ completed, total }) => {
                                    output(i18n.t('resources.progress', { completed, total }));
                                },
                            },
                        );
                        output(i18n.t('resources.loaded'));
                    } catch (cause) {
                        await batch.close();
                        if (this.batch === batch) this.batch = undefined;
                        if (cause instanceof OperationCancelled) output(i18n.t('resources.cancelled'));
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
                                i18n.t('resources.token', { id: this.ids.get(node)! }),
                            );
                        },
                    });
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
        const state = this.pool!.inspect();
        this.lblPool.string = this.ctx.i18n.t('resources.pool', {
            size: state.size,
            idle: state.idle,
            borrowed: state.borrowed,
        });
        for (const [index, lease] of this.leases.entries()) {
            lease.node.setPosition((index - (this.leases.length - 1) / 2) * 196, 0, 0);
            lease.node
                .getComponent(BadgePart)!
                .render(this.ctx.i18n.t('resources.token', { id: this.ids.get(lease.node)! }));
        }
    }
    protected onHide(): void {
        this.leases = [];
        this.batch = undefined;
        this.pool = undefined;
    }
}
