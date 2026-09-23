import { _decorator, Component, Label, Node } from 'cc';
import type { BadgeKey, BadgeStore } from '../../../badges/badge-store';
import type { Lifetime } from '../../../core/scope';
import { invariant } from '../../../core/errors';
const { ccclass, property } = _decorator;

/** 通用红点显示器。业务预制体提供 visual 子节点及可选数字 Label，框架不持有业务资源。 */
@ccclass('yzforge.Badge')
export class Badge extends Component {
    /** 显示/隐藏的子节点；不能设为本节点，以免隐藏红点时停止自己的订阅。 */
    @property(Node) visual: Node | null = null;
    /** 可选数量文本；不配置时仅显示圆点。 */
    @property(Label) countLabel: Label | null = null;
    private unbind?: () => void;
    /**
     * 绑定一个业务 Key，先解除上一次绑定；owner 应使用 show.scope、activation.scope 或 item.scope。
     * max 为显示上限（正整数），超过时显示如 99+。关闭、禁用或销毁组件会同步解除绑定。
     * 支持在首次激活前绑定；禁用后的下一次激活需要宿主重新调用 bind。
     */
    bind(store: BadgeStore, key: BadgeKey, owner: Lifetime, max = 99): () => void {
        invariant(
            this.isValid && this.visual && this.visual !== this.node && this.visual.isChildOf(this.node),
            'BADGE_VIEW_INVALID',
            '红点需要有效的 visual 子节点',
        );
        invariant(Number.isSafeInteger(max) && max > 0, 'BADGE_MAX_INVALID', '显示上限必须为正整数');
        this.clear();
        let off = () => {};
        let detach = () => {};
        const release = () => {
            off();
            detach();
            if (this.unbind === release) {
                this.unbind = undefined;
                if (this.visual?.isValid) this.visual.active = false;
            }
        };
        this.unbind = release;
        try {
            off = store.subscribe(key, owner, (count) => {
                this.visual!.active = count > 0;
                if (this.countLabel) this.countLabel.string = count > max ? `${max}+` : String(count);
            });
            detach = owner.signal.onAbort(release);
        } catch (error) {
            release();
            throw error;
        }
        return release;
    }
    /** 主动解绑并隐藏；幂等，适合业务条目重新绑定前调用。 */
    clear(): void {
        this.unbind?.();
    }
    /** @internal 引擎禁用时不再持有旧业务订阅。 */
    onDisable(): void {
        this.clear();
    }
    /** @internal 引擎销毁时释放绑定。 */
    onDestroy(): void {
        this.clear();
    }
}
