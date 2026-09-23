import type { Lifetime } from '../core/scope';
import { invariant, reportError } from '../core/errors';

/** 一次目标注册的只读租约；相同 Key 重新注册不会让旧租约重新有效。 */
export interface GuideTarget<T> {
    /** 稳定业务名称，例如 inventory/item/42/claim，禁止使用池化节点的序号。 */
    readonly key: string;
    /** 业务目标，Cocos 界面通常为 Node。 */
    readonly value: T;
    /** 该次注册的期限；注销会取消此期限，展示者应马上遮挡并结束旧目标交互。 */
    readonly scope: Lifetime;
    /** 是否仍为此 Key 当前注册；目标复用后返回 false。 */
    isCurrent(): boolean;
}
/** 目标注册表；只持有当前可用目标，不扫描场景或保存节点路径。 */
export class GuideTargets<T> {
    private readonly entries = new Map<string, GuideTarget<T>>();
    private readonly waiters = new Map<string, Set<(target: GuideTarget<T>) => void>>();
    /**
     * 注册目标并随 owner 自动注销，返回主动注销函数。重复 Key 抛 GUIDE_TARGET_DUPLICATE。
     * 虚拟列表用 item.scope；页面固定目标用 show.scope。owner 必须覆盖目标的实际可交互期。
     */
    register(key: string, value: T, owner: Lifetime): () => void {
        invariant(key.trim().length > 0, 'GUIDE_TARGET_INVALID', '目标 Key 不能为空');
        owner.signal.throwIfAborted();
        invariant(!this.entries.has(key), 'GUIDE_TARGET_DUPLICATE', `引导目标重复：${key}`);
        const scope = owner.child(`guide-target:${key}`);
        const target: GuideTarget<T> = Object.freeze({
            key,
            value,
            scope: scope.lifetime,
            isCurrent: () => this.entries.get(key) === target && !scope.signal.aborted,
        });
        this.entries.set(key, target);
        scope.signal.onAbort(() => {
            if (this.entries.get(key) === target) this.entries.delete(key);
        });
        for (const notify of Array.from(this.waiters.get(key) ?? [])) notify(target);
        return () => {
            void scope.close().catch(reportError);
        };
    }
    /** 返回当前有效目标；未出现或已注销时返回 undefined。 */
    get(key: string): GuideTarget<T> | undefined {
        return this.entries.get(key);
    }
    /**
     * 等待 Key 出现；owner 取消时立即拒绝并移除等待者。通常传引导步骤 scope，由步骤统一超时。
     * 返回后仍须检查 isCurrent 或观察目标 scope，不能把池化节点永久当成同一业务对象。
     */
    wait(key: string, owner: Lifetime): Promise<GuideTarget<T>> {
        invariant(key.trim().length > 0, 'GUIDE_TARGET_INVALID', '目标 Key 不能为空');
        owner.signal.throwIfAborted();
        const current = this.entries.get(key);
        if (current) return Promise.resolve(current);
        return new Promise((resolve, reject) => {
            let group = this.waiters.get(key);
            if (!group) this.waiters.set(key, (group = new Set()));
            let detach = () => {};
            const cleanup = () => {
                group!.delete(receive);
                if (!group!.size) this.waiters.delete(key);
                detach();
            };
            const receive = (target: GuideTarget<T>) => {
                cleanup();
                resolve(target);
            };
            group.add(receive);
            detach = owner.signal.onAbort((reason) => {
                cleanup();
                reject(reason);
            });
        });
    }
    /** 只读数量快照，用于验证换页和条目复用后没有目标或等待者残留。 */
    inspect() {
        return {
            targets: this.entries.size,
            waiters: Array.from(this.waiters.values()).reduce((sum, group) => sum + group.size, 0),
        };
    }
}
