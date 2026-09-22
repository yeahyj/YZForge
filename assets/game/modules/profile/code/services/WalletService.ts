import type { ModuleContext } from '../../../../../framework/modules/module-manager';
import type { Lifetime } from '../../../../../framework/core/scope';
import type { StorageKey } from '../../../../../framework/platform/storage';
import { invariant, reportError } from '../../../../../framework/core/errors';
import type { WalletSnapshot } from '../../public';

interface WalletState extends WalletSnapshot {
    readonly claims: readonly string[];
}
const WalletSave: StorageKey<WalletState> = {
    id: 'profile.wallet',
    version: 3,
    migrations: {
        1: (value) => ({ coins: (value as { gold: number }).gold }),
        2: (value) => ({ coins: (value as WalletSnapshot).coins, claims: [] }),
    },
    validate: (value): value is WalletState =>
        !!value &&
        typeof value === 'object' &&
        Number.isSafeInteger((value as WalletSnapshot).coins) &&
        (value as WalletSnapshot).coins >= 0 &&
        Array.isArray((value as WalletState).claims) &&
        (value as WalletState).claims.every((id) => typeof id === 'string' && id.length > 0) &&
        new Set((value as WalletState).claims).size === (value as WalletState).claims.length,
};
/** 纯业务服务：持有状态、校验命令和保存数据，不依赖页面或 Cocos 节点。 */
export class WalletService {
    private state: WalletState;
    private readonly listeners = new Set<(state: WalletSnapshot) => void>();
    /** 从可恢复存档初始化；损坏且无备份或来自未来版本时明确失败，避免静默覆盖玩家数据。 */
    constructor(private readonly ctx: ModuleContext) {
        const saved = ctx.storage.read(WalletSave);
        invariant(
            saved.status !== 'invalid' && saved.status !== 'incompatible',
            'DEMO_SAVE_UNAVAILABLE',
            `示例存档需要恢复：${saved.status}`,
        );
        const value = saved.value ?? { coins: 0, claims: [] };
        this.state = Object.freeze({ ...value, claims: Object.freeze(value.claims.slice()) });
        ctx.scope.defer(() => {
            this.listeners.clear();
        });
    }
    /** 返回当前不可变状态，模块结束后拒绝访问。 */
    snapshot(): WalletSnapshot {
        this.ctx.scope.signal.throwIfAborted();
        return this.state;
    }
    /** 校验并保存新状态，写盘失败时保留旧状态；单个订阅者失败不影响其他订阅者。 */
    changeCoins(delta: number): WalletSnapshot {
        this.ctx.scope.signal.throwIfAborted();
        const coins = this.state.coins + delta;
        invariant(
            Number.isSafeInteger(delta) && Number.isSafeInteger(coins) && coins >= 0,
            'DEMO_INVALID_COINS',
            '金币变动须为安全整数且余额不能为负',
        );
        return this.commit({ coins, claims: this.state.claims });
    }
    /** 保存幂等记录和奖励余额；失败时两者都不改变，便于原请求安全重试。 */
    claimReward(id: string, amount: number): boolean {
        this.ctx.scope.signal.throwIfAborted();
        invariant(/^[a-z0-9][a-z0-9/.:_-]{0,159}$/.test(id), 'DEMO_REWARD_ID', '奖励需要稳定的业务标识');
        invariant(Number.isSafeInteger(amount) && amount > 0, 'DEMO_REWARD_AMOUNT', '奖励必须为正整数');
        if (this.state.claims.includes(id)) return false;
        const coins = this.state.coins + amount;
        invariant(Number.isSafeInteger(coins), 'DEMO_INVALID_COINS', '金币总数超出安全范围');
        this.commit({ coins, claims: [...this.state.claims, id] });
        return true;
    }
    /** 只读取领域状态，不加载 UI 或访问节点。 */
    hasReward(id: string): boolean {
        this.ctx.scope.signal.throwIfAborted();
        return this.state.claims.includes(id);
    }
    private commit(value: WalletState): WalletSnapshot {
        const next = Object.freeze({ coins: value.coins, claims: Object.freeze(value.claims.slice()) });
        this.ctx.storage.set(WalletSave, next);
        this.state = next;
        for (const listener of Array.from(this.listeners)) {
            try {
                listener(next);
            } catch (error) {
                reportError(error);
            }
        }
        return next;
    }
    /** 订阅当前状态及后续变化，所有者结束自动清理，适用于多个页面共享同一业务状态。 */
    subscribe(callback: (state: WalletSnapshot) => void, owner: Lifetime): () => void {
        this.ctx.scope.signal.throwIfAborted();
        owner.signal.throwIfAborted();
        const listener = (state: WalletSnapshot) => callback(state);
        this.listeners.add(listener);
        let detach = () => {};
        const off = () => {
            this.listeners.delete(listener);
            detach();
        };
        detach = owner.signal.onAbort(off);
        try {
            callback(this.state);
        } catch (error) {
            off();
            throw error;
        }
        return off;
    }
}
