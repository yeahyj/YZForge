import { isValid, Node, type Quat, type Vec3 } from 'cc';
import { componentBindings } from '../core/component-binding';
import { FrameworkError, invariant } from '../core/errors';
import type { Lifetime } from '../core/scope';
import type { Assets } from './asset-manager';
import { destroyNode } from './asset-manager';
import type { AssetKey } from './asset-types';
import { InstancePool, type InstancePoolOptions } from './instance-pool';

export interface PrefabPoolOptions extends InstancePoolOptions {
    /** GameComponent 的宿主模块；ctx.assets 默认传入当前模块。 */
    readonly moduleId?: string;
}
export interface PrefabSpawnOptions {
    /** 节点仍 inactive 时同步填入本次业务状态；异步工作通过本次 owner 登记。 */
    readonly prepare?: (node: Node, owner: Lifetime) => void;
}
/** 借出期间持有节点，归还后此句柄失效；下一次借用得到新的 scope。 */
export interface PrefabLease {
    readonly node: Node;
    readonly scope: Lifetime;
    /** 立即取消本次使用，完成停用与任务收尾后归还；不要在自身的受跟踪任务中 await。 */
    release(): Promise<void>;
}
/**
 * 按预制体复用实例。池持有节点和资源，每次借用持有激活任务；停止完成后才允许复用。
 * 每次借出恢复根节点默认变换；游戏状态由 prepare/onActivate 每次设置，不复用 UIView。
 */
export class PrefabPool {
    private readonly pool: InstancePool<Node, { parent: Node; options: PrefabSpawnOptions }>;
    private readonly parking: Node;
    private readonly unown: () => void;
    private closing?: Promise<void>;

    /** 通常通过 assets.createPool 创建；不要把池内节点交给其他池或直接销毁。 */
    constructor(assets: Assets, key: AssetKey<'Prefab'>, owner: Lifetime, options: PrefabPoolOptions = {}) {
        owner.signal.throwIfAborted();
        const transforms = new WeakMap<Node, { position: Vec3; rotation: Quat; scale: Vec3 }>();
        this.pool = new InstancePool(
            owner,
            {
                create: async (scope) => {
                    const node = await assets.instantiate(key, this.parking, scope, {
                        moduleId: options.moduleId,
                        active: false,
                    });
                    // UIView 的显示期限由 UIManager 管理，不能作为池化 Part 使用。
                    invariant(
                        !node.getComponentsInChildren('yzforge.UIView').length,
                        'POOL_VIEW_UNSUPPORTED',
                        '池化预制体请使用 GameComponent，完整界面交给 UIManager',
                    );
                    transforms.set(node, {
                        position: node.position.clone(),
                        rotation: node.rotation.clone(),
                        scale: node.scale.clone(),
                    });
                    return node;
                },
                valid: (node) => isValid(node, true),
                activate: (node, input, scope) => {
                    invariant(isValid(input.parent, true), 'POOL_PARENT_INVALID', '实例父节点无效');
                    const transform = transforms.get(node)!;
                    node.setPosition(transform.position);
                    node.setRotation(transform.rotation);
                    node.setScale(transform.scale);
                    node.setParent(input.parent);
                    const result: unknown = input.options.prepare?.(node, scope);
                    if (result && typeof (result as Promise<unknown>).then === 'function') {
                        void Promise.resolve(result).catch(() => {});
                        throw new FrameworkError('POOL_PREPARE_ASYNC', 'prepare 必须同步；异步准备应在 spawn 前完成');
                    }
                    scope.signal.throwIfAborted();
                    assets.activate(node, scope);
                },
                deactivate: async (node) => {
                    if (!isValid(node, true)) return;
                    const parts = componentBindings(node);
                    for (const part of parts) part.__allow(undefined);
                    node.active = false;
                    const results = await Promise.allSettled(parts.map((part) => part.__deactivate()));
                    if (isValid(node, true)) node.setParent(this.parking);
                    const failures = results
                        .filter((result) => result.status === 'rejected')
                        .map((result) => result.reason as unknown);
                    if (failures.length)
                        throw new FrameworkError('POOL_DEACTIVATE_FAILED', '实例停用失败', { failures });
                },
            },
            options,
        );
        this.parking = new Node('YZForge pool');
        this.parking.active = false;
        this.unown = owner.defer(() => destroyNode(this.parking));
    }
    /** 提前创建 count 个闲置节点，不运行 onActivate。 */
    prewarm(count: number, owner: Lifetime): Promise<void> {
        return this.pool.prewarm(count, owner);
    }
    /** 配置并激活一个实例；达到 maxSize 时拒绝为 POOL_FULL。 */
    async spawn(parent: Node, owner: Lifetime, options: PrefabSpawnOptions = {}): Promise<PrefabLease> {
        const lease = await this.pool.acquire({ parent, options }, owner);
        return Object.freeze({
            get node() {
                return lease.value;
            },
            scope: lease.scope,
            release: () => lease.release(),
        });
    }
    /** 读取总量、空闲数和借出数。 */
    inspect() {
        return this.pool.inspect();
    }
    /** 关池会取消所有借用并等待收尾；所有者结束时也会自动回收。 */
    close(): Promise<void> {
        return (this.closing ??= this.pool.close().finally(async () => {
            this.unown();
            await destroyNode(this.parking);
        }));
    }
}
