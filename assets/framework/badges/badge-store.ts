import type { Lifetime } from '../core/scope';
import { invariant, type ErrorReporter, reportError } from '../core/errors';

/** 红点的稳定业务标识；同一 id 表示同一节点，与 UI 节点名和列表索引无关。 */
export interface BadgeKey {
    /** 带模块前缀的唯一名称，例如 workshop/tasks/42。 */
    readonly id: string;
}
/** 创建可跨模块公开的红点合同，不注册状态，也不加载业务模块。 */
export function badgeKey(id: string): BadgeKey {
    invariant(id.trim().length > 0, 'BADGE_KEY_INVALID', '红点 Key 不能为空');
    return Object.freeze({ id });
}
/** 注册句柄；dispose 幂等，销毁分组会同时移除其全部后代。 */
export interface BadgeRegistration {
    /** 当前注册的稳定标识。 */
    readonly key: BadgeKey;
    /** 移除注册并同步更新上级；旧句柄不能操作随后创建的同名节点。 */
    dispose(): void;
}
/** 叶节点写入入口；只有业务服务持有，UI 通过 BadgeStore.subscribe 读取。 */
export interface BadgeSource extends BadgeRegistration {
    /** 设置非负安全整数；布尔业务条件可转换为 0 或 1，相同值不会重复通知。 */
    set(count: number): void;
}
type Entry = {
    key: BadgeKey;
    mode: 'source' | 'sum' | 'any';
    parent?: Entry;
    children: Set<Entry>;
    value: number;
    detach: () => void;
};
type Listener = { active: boolean; lastValue: number; invoke: (count: number) => void; off: () => void };

/**
 * 无引擎依赖的红点树。业务显式写入叶节点，祖先按 sum（求和）或 any（0/1）聚合。
 * 每次写入只更新祖先链；不轮询、不读取业务存档、不自动加载模块。未注册的 Key 读作 0。
 * @example const source = badges.source(badgeKey('mail/42'), session, mailGroup, 1);
 */
export class BadgeStore {
    private readonly nodes = new Map<string, Entry>();
    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly previous = new Map<string, number>();
    private depth = 0;
    private notifying = false;
    private ended = false;
    /** 创建一个状态域；owner 结束时清除全部节点和订阅，账号切换应更换状态域或结束其注册所有者。 */
    constructor(
        owner: Lifetime,
        private readonly report: ErrorReporter = reportError,
    ) {
        owner.signal.throwIfAborted();
        owner.signal.onAbort(() => {
            this.ended = true;
            for (const entry of this.nodes.values()) entry.detach();
            for (const group of this.listeners.values()) for (const listener of Array.from(group)) listener.off();
            this.nodes.clear();
            this.previous.clear();
        });
    }
    /**
     * 注册聚合节点。parent 必须是已存在的分组；显式注册顺序天然禁止循环依赖。
     * @param key 唯一标识，重复注册会抛 BADGE_DUPLICATE。
     * @param mode sum 饱和求和至 Number.MAX_SAFE_INTEGER；any 返回 0 或 1。
     * @param owner 此次注册的所有者，取消时同步移除整棵子树。
     * @param parent 可选父级，不支持重新挂接；需要移动时销毁后重新注册。
     */
    group(key: BadgeKey, mode: 'sum' | 'any', owner: Lifetime, parent?: BadgeKey): BadgeRegistration {
        invariant(mode === 'sum' || mode === 'any', 'BADGE_MODE_INVALID', '分组模式必须为 sum 或 any');
        return this.register(key, mode, owner, parent);
    }
    /** 注册可写叶节点。initial 为初始数量；生命周期和父级约束同 group。 */
    source(key: BadgeKey, owner: Lifetime, parent?: BadgeKey, initial = 0): BadgeSource {
        key = badgeKey(key.id);
        this.validateCount(initial);
        let handle!: BadgeSource;
        this.batch(() => {
            const registration = this.register(key, 'source', owner, parent);
            const entry = this.nodes.get(key.id)!;
            handle = Object.freeze({
                ...registration,
                set: (count: number) => {
                    this.validateCount(count);
                    invariant(this.nodes.get(key.id) === entry && !this.ended, 'BADGE_SOURCE_ENDED', '红点来源已结束');
                    this.batch(() => {
                        this.change(entry, count);
                        this.update(entry.parent);
                    });
                },
            });
            handle.set(initial);
        });
        return handle;
    }
    /** 读取当前数量，批处理中也能读取最新值；未注册或已移除时为 0。 */
    get(key: BadgeKey): number {
        return this.nodes.get(key.id)?.value ?? 0;
    }
    /**
     * 立即同步回调当前值，随后仅在数量改变时通知。允许先订阅后注册；取消立即解绑。
     * callback 应只做同步渲染，异步业务通过已有 runTask / task.commit 管理。
     * 首次回调抛错会撤销订阅并向外抛出；后续回调异常独立上报，不阻止其他订阅者。
     */
    subscribe(key: BadgeKey, owner: Lifetime, callback: (count: number) => void): () => void {
        key = badgeKey(key.id);
        invariant(!this.ended, 'BADGE_STORE_ENDED', '红点状态域已结束');
        owner.signal.throwIfAborted();
        let group = this.listeners.get(key.id);
        if (!group) this.listeners.set(key.id, (group = new Set()));
        let detach = () => {};
        const listener: Listener = {
            active: true,
            lastValue: this.get(key),
            invoke: callback,
            off: () => {
                listener.active = false;
                group!.delete(listener);
                if (!group!.size) this.listeners.delete(key.id);
                detach();
            },
        };
        group.add(listener);
        detach = owner.signal.onAbort(listener.off);
        try {
            callback(listener.lastValue);
        } catch (error) {
            listener.off();
            throw error;
        }
        return listener.off;
    }
    /**
     * 合并一组同步写入，最外层结束后每个改变的 Key 通知一次；净值未变不通知。
     * 这不是事务：抛错前的写入仍有效并会通知。禁止传异步回调。
     */
    batch(action: () => void): void {
        invariant(!this.ended, 'BADGE_STORE_ENDED', '红点状态域已结束');
        this.depth++;
        try {
            const result: unknown = action();
            if (result && typeof (result as Promise<unknown>).then === 'function') {
                void Promise.resolve(result).catch(this.report);
                invariant(false, 'BADGE_ASYNC_BATCH', 'batch 只接受同步回调');
            }
        } finally {
            if (--this.depth === 0) this.flush();
        }
    }
    /** 返回节点、订阅数量和状态，适合检查反复开关页面或条目复用是否泄漏。 */
    inspect() {
        return {
            nodes: this.nodes.size,
            subscriptions: Array.from(this.listeners.values()).reduce((n, set) => n + set.size, 0),
            ended: this.ended,
        };
    }
    private validateCount(value: number): void {
        invariant(Number.isSafeInteger(value) && value >= 0, 'BADGE_COUNT_INVALID', '数量必须为非负安全整数');
    }
    private register(key: BadgeKey, mode: Entry['mode'], owner: Lifetime, parent?: BadgeKey): BadgeRegistration {
        key = badgeKey(key.id);
        invariant(!this.ended, 'BADGE_STORE_ENDED', '红点状态域已结束');
        owner.signal.throwIfAborted();
        badgeKey(key.id);
        invariant(!this.nodes.has(key.id), 'BADGE_DUPLICATE', `重复红点：${key.id}`);
        const ancestor = parent ? this.nodes.get(parent.id) : undefined;
        invariant(!parent || (ancestor && ancestor.mode !== 'source'), 'BADGE_PARENT_INVALID', '父级须为已注册分组');
        const entry: Entry = {
            key: badgeKey(key.id),
            mode,
            parent: ancestor,
            children: new Set(),
            value: 0,
            detach: () => {},
        };
        this.nodes.set(key.id, entry);
        ancestor?.children.add(entry);
        const dispose = () => {
            if (this.nodes.get(key.id) !== entry) return;
            this.batch(() => {
                this.remove(entry);
                this.update(ancestor);
            });
        };
        entry.detach = owner.signal.onAbort(dispose);
        return Object.freeze({ key: entry.key, dispose });
    }
    private remove(entry: Entry): void {
        for (const child of Array.from(entry.children)) this.remove(child);
        this.change(entry, 0);
        this.nodes.delete(entry.key.id);
        entry.parent?.children.delete(entry);
        entry.detach();
    }
    private change(entry: Entry, value: number): void {
        if (entry.value === value) return;
        if (!this.previous.has(entry.key.id)) this.previous.set(entry.key.id, entry.value);
        entry.value = value;
    }
    private update(entry?: Entry): void {
        while (entry) {
            let value = 0;
            for (const child of entry.children)
                value =
                    entry.mode === 'any'
                        ? Number(value > 0 || child.value > 0)
                        : Math.min(Number.MAX_SAFE_INTEGER, value + child.value);
            this.change(entry, value);
            entry = entry.parent;
        }
    }
    private flush(): void {
        if (this.notifying) return;
        this.notifying = true;
        try {
            while (this.previous.size && !this.ended) {
                const changes = Array.from(this.previous).map(([id, before]) => ({
                    id,
                    before,
                    value: this.nodes.get(id)?.value ?? 0,
                    listeners: Array.from(this.listeners.get(id) ?? []),
                }));
                this.previous.clear();
                for (const { before, value, listeners } of changes)
                    if (before !== value)
                        for (const listener of listeners)
                            if (listener.active && listener.lastValue !== value) {
                                listener.lastValue = value;
                                try {
                                    listener.invoke(value);
                                } catch (error) {
                                    this.report(error);
                                }
                            }
            }
        } finally {
            this.notifying = false;
        }
    }
}
