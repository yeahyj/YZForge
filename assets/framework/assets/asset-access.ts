import type { Node, Sprite } from 'cc';
import type { Lifetime } from '../core/scope';
import type { ConfigAccess } from '../config/config-access';
import type { AssetKey, AssetKind, AssetTypes, AssetAddress, BundleRef } from './asset-types';
import type { InstancePoolOptions } from './instance-pool';
import type { AssetBatchOptions, LoadedAssets } from './asset-batch';

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
/** 池拥有实例，借出句柄拥有本次激活；归还须等待停用完成。 */
export interface PrefabPoolAccess {
    /** 提前创建 count 个闲置节点，不运行 onActivate。 */
    prewarm(count: number, owner: Lifetime): Promise<void>;

    /** 配置并激活一个实例；达到 maxSize 时拒绝为 POOL_FULL。 */
    spawn(parent: Node, owner: Lifetime, options?: PrefabSpawnOptions): Promise<PrefabLease>;

    /** 读取总量、空闲数和借出数。 */
    inspect(): Readonly<{
        size: number;
        idle: number;
        borrowed: number;
        maxSize: number;
        closed: boolean;
    }>;

    /** 关池会取消所有借用并等待收尾；所有者结束时也会自动回收。 */
    close(): Promise<void>;
}

/** 资源加载必须绑定当前使用期；不暴露底层管理器。 */
export interface AssetAccess {
    /**
     * 默认资源所有者。ctx.assets 默认跟随模块；临时 UI 资源应改用 in(show.scope)。
     */
    readonly scope: Lifetime;

    /**
     * 相对资源名使用的默认“模块/资源包”；完整 AssetKey 不依赖它。
     */
    readonly namespace?: string | undefined;

    /**
     * 实例的默认宿主业务模块，用于绑定 GameComponent 上下文。
     */
    readonly moduleId?: string | undefined;

    /** 提前销毁托管实例并归还资源；通常由创建它的父页面调用并等待。 */
    destroyInstance(node: Node): Promise<void>;

    /**
     * 换用另一个资源所有者，保留当前命名空间和宿主模块；不会创建子 Scope。
     * @param scope - 新的默认所有者，例如 show.scope。
     * @returns 新的 AssetAccess 入口，原入口不变。
     * @example
     * const assets = this.ctx.assets.in(show.scope);
     * await assets.setSprite(this.sprIcon, iconKey);
     */
    in(scope: Lifetime): AssetAccess;

    /**
     * 显式接入已挂在框架实例下的新增组件；重复调用不会重新绑定原组件。
     * UI 使用 await show.assets.bindComponents(node)，普通实例使用其 scope。
     * 建议先在 inactive 节点上添加组件、接入后启用，再次 await 此方法等待语言等准备完成。
     */
    bindComponents(root: Node): Promise<void>;

    /**
     * 查询资源在 Bundle 中的路径，不加载目标资源；查询索引本身可能产生加载。
     * 传生成的 AssetKey，或传相对名称及 Cocos 种类（例如 resolve("icons/coin", "SpriteFrame")）。
     * @param key - 生成的 AssetKey；完整键不依赖默认命名空间。
     * @returns 资源地址；短名称重名时抛 ASSET_NAME_AMBIGUOUS，须改用相对路径或生成的键。
     */
    resolve<K extends AssetKind>(key: AssetKey<K>): Promise<AssetAddress<K>>;

    /**
     * 查询资源在 Bundle 中的路径，不加载目标资源；查询索引本身可能产生加载。
     * 传生成的 AssetKey，或传相对名称及 Cocos 种类（例如 resolve("icons/coin", "SpriteFrame")）。
     * @param name - 相对资源名或包含子目录的路径；名称重名时请使用生成键或完整相对路径。
     * @param type - Cocos 资源种类，例如 SpriteFrame；字符串形式必须提供。
     * @returns 资源地址；短名称重名时抛 ASSET_NAME_AMBIGUOUS，须改用相对路径或生成的键。
     */
    resolve(name: string, type: AssetKind): Promise<AssetAddress>;

    /**
     * 按资源键或相对名称加载，类型由键或第二个 type 参数推导，引用由当前 scope 持有。
     * 优先传生成的 AssetKey；字符串写法例如 load("icons/coin", "SpriteFrame")。
     * @param key - 生成的 AssetKey；完整键不依赖默认命名空间。
     * @returns 加载后的 Cocos 资源，不会自动实例化或播放。
     * @throws OperationCancelled 当前 scope 取消；名称歧义、未登记及引擎加载失败也会拒绝。
     * @remarks 直接赋图时需处理先后请求竞争，推荐 setSprite 自动处理最新请求及引用释放。
     */
    load<K extends AssetKind>(key: AssetKey<K>): Promise<AssetTypes[K]>;

    /**
     * 按资源键或相对名称加载，类型由键或第二个 type 参数推导，引用由当前 scope 持有。
     * 优先传生成的 AssetKey；字符串写法例如 load("icons/coin", "SpriteFrame")。
     * @param name - 相对资源名或包含子目录的路径；名称重名时请使用生成键或完整相对路径。
     * @param type - Cocos 资源种类，例如 SpriteFrame；字符串形式必须提供。
     * @returns 加载后的 Cocos 资源，不会自动实例化或播放。
     * @throws OperationCancelled 当前 scope 取消；名称歧义、未登记及引擎加载失败也会拒绝。
     * @remarks 直接赋图时需处理先后请求竞争，推荐 setSprite 自动处理最新请求及引用释放。
     */
    load<K extends AssetKind>(name: string, type: K): Promise<AssetTypes[K]>;

    /**
     * 绕过索引，按 Bundle 相对路径加载，引用跟随当前 scope。
     * @param bundle - 已登记的 Bundle 引用。
     * @param path - 引擎加载路径，通常无扩展名；不是 db:// 或磁盘路径。
     * @param type - Cocos 资源种类。
     * @returns 加载完成的资源。预制体脚本依赖须由调用方事先准备。
     */
    loadPath<K extends AssetKind>(bundle: BundleRef, path: string, type: K): Promise<AssetTypes[K]>;

    /** 批量准备资源；进度、并发和失败回收与 Assets.loadMany 相同，持有归当前使用期。 */
    loadMany<T extends Record<string, AssetKey>>(keys: T, options?: AssetBatchOptions): Promise<LoadedAssets<T>>;

    /**
     * 取得资源包访问入口，不加载包内全部内容。
     * @param ref - 已登记的资源包引用。
     * @param owner - 后续加载的默认所有者，默认当前 scope；界面使用时可传 show.scope。
     * @returns 带 assets、tables 的 BundleAccess，保留当前宿主模块。
     */
    openBundle(ref: BundleRef, owner?: Lifetime): Promise<BundleAccess>;

    /**
     * 动态创建 Part 等预制体实例，并使节点和资源跟随当前 scope。
     * @param key - Prefab 资源键。
     * @param parent - 父节点。
     * @param input - active 默认 true；moduleId 默认当前宿主模块，按需显式覆盖。
     * @returns 加入父节点的托管实例；active: false 时之后用 activate 激活。
     * @remarks 动态 Part 放在资源包的 dynamic 中以生成键；静态引用的 Part 可放在 static 中。
     */
    instantiate(
        key: AssetKey<'Prefab'>,
        parent: Node,
        input?: {
            /**
             * 是否立即激活，默认 true；false 时稍后使用 activate。
             */
            active?: boolean;
            /**
             * 覆盖默认宿主业务模块，省略时使用当前 AssetAccess 的 moduleId；不按资源目录推断宿主。
             */
            moduleId?: string;
        },
    ): Promise<Node>;

    /**
     * 激活之前以 active: false 创建的托管实例。
     * @param node - 当前资源管理器创建的有效节点；宿主业务模块须已就绪。
     */
    activate(node: Node): void;

    /** 创建归当前 scope 所有的实例池，继承当前模块作为 Part 宿主。 */
    createPool(key: AssetKey<'Prefab'>, options?: PrefabPoolOptions): PrefabPoolAccess;

    /**
     * 设置图片并自动处理同一 Sprite 的先后请求、旧图替换与引用归还。
     * @param target - 要设置的 Sprite。
     * @param key - 生成的 SpriteFrame 键或当前命名空间内的相对路径。
     * @returns 本次图片应用完成；被替代、scope 取消或加载失败时拒绝。
     * @example
     * await this.ctx.assets.in(show.scope).setSprite(this.sprIcon, iconKey);
     */
    setSprite(target: Sprite, key: AssetKey<'SpriteFrame'> | string): Promise<void>;
}

/** 已准备的包入口，后续加载仍按需持有。 */
export interface BundleAccess {
    /**
     * 发布清单中的 Bundle ID。
     */
    readonly id: string;

    /**
     * 通过该句柄加载资源和配置的默认所有者；关闭后已有表查询会拒绝。
     */
    readonly scope: Lifetime;

    /**
     * 默认使用此包命名空间及句柄 scope 的资源入口；生成的完整键仍可指向其他包。
     */
    readonly assets: AssetAccess;

    /**
     * 默认选择此 Bundle 数据路由的配置入口，适合加载分包配置；可在 load 选项中显式覆盖。
     */
    readonly tables: ConfigAccess;

    /**
     * 通过当前包入口创建托管预制体实例，节点生命周期跟随句柄 scope。
     * @param key - Prefab 资源键。
     * @param parent - 父节点。
     * @param input - active 默认 true；moduleId 默认句柄宿主业务模块。
     * @returns 实例节点；传 active: false 时用 handle.assets.activate(node) 激活。
     */
    instantiate(
        key: AssetKey<'Prefab'>,
        parent: Node,
        input?: {
            /**
             * 是否立即激活，默认 true；false 时稍后使用 handle.assets.activate。
             */
            active?: boolean;
            /**
             * 覆盖句柄的默认宿主业务模块，不等同于资源 Bundle ID。
             */
            moduleId?: string;
        },
    ): Promise<Node>;
}
