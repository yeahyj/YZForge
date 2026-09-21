import {
    Asset,
    assetManager,
    AudioClip,
    Font,
    ImageAsset,
    instantiate,
    isValid,
    JsonAsset,
    Material,
    Node,
    Prefab,
    SceneAsset,
    Sprite,
    SpriteAtlas,
    SpriteFrame,
    TextAsset,
    Texture2D,
    director,
    Director,
} from 'cc';
import type { AssetManager as EngineAssetManager } from 'cc';
import type { ConfigManager, ScopedConfig } from '../config/config-manager';
import { untilCancelled } from '../core/cancellation';
import { FrameworkError, invariant, reportError } from '../core/errors';
import { Scope } from '../core/scope';
import {
    AssetAddress,
    AssetKey,
    AssetKind,
    AssetTypes,
    BundleRef,
    bundleId,
    ContentRelease,
    NamespaceIndex,
} from './asset-types';
import { logicalKey, resolveIndex, validateIndex } from './catalog';
import { LeaseCache } from './lease-cache';
const constructors = {
    Prefab,
    SpriteFrame,
    Texture2D,
    ImageAsset,
    AudioClip,
    JsonAsset,
    TextAsset,
    Material,
    SpriteAtlas,
    Font,
    SceneAsset,
};
let selectedRelease: string | undefined;
type SpriteWrite = { sequence: number; pending?: Scope; displayed?: Scope };
type LoadedAsset = { asset: Asset; atlas?: SpriteAtlas };

/**
 * 资源管理器：统一按逻辑键、名称或路径加载资源，并由 Scope 管理引用和预制体实例。
 * 业务通常使用 ctx.assets.in(show.scope)，让资源随本次界面展示释放。
 * 加载 Bundle 不等于加载其中全部资源，关闭 Scope 也不会卸载已注册的 JS 类。
 */
export class Assets {
    private readonly bundles = new Map<string, Promise<EngineAssetManager.Bundle>>();
    private readonly indices = new Map<string, Promise<NamespaceIndex>>();
    private readonly addresses = new Map<string, AssetAddress>();
    private readonly cache: LeaseCache<LoadedAsset>;
    private readonly sprites = new WeakMap<Sprite, SpriteWrite>();
    private readonly scope: Scope;
    private config?: ConfigManager;
    private readonly instances = new WeakMap<Node, { scope: Scope; moduleId?: string }>();
    /**
     * @internal
     * App 注入的实例绑定器，把实例中的 GameComponent 绑定到宿主模块及生命周期。
     */
    bindInstance: (node: Node, scope: Scope, moduleId: string | undefined, active: boolean) => void = () => {};
    /**
     * @internal
     * App 注入的激活适配器，在节点激活前接通框架组件生命周期。
     */
    activateInstance: (node: Node, scope: Scope) => void = () => {};
    /**
     * @internal
     * App 注入的代码准备器，确保预制体反序列化所需脚本已注册，不启动业务工厂。
     */
    prepareCode: (id: string, owner: Scope) => Promise<void> = async () => {};
    /**
     * @internal
     * App 注入的代码注册状态查询。
     */
    codeReady: (moduleId: string) => boolean = () => false;
    /**
     * @internal
     * App 注入的业务初始化状态查询；激活带宿主模块的实例前检查。
     */
    moduleReady: (moduleId: string) => boolean = () => false;
    /**
     * 由 App 创建资源管理器，校验发布版本及 Bundle 依赖关系。
     * @param release - 本次运行固定使用的发布路由表。
     * @param owner - 应用所有者；管理器创建自己的资源子 Scope。
     * @throws FrameworkError 同一运行时切换 releaseId，或 Bundle 图缺失、循环。
     */
    constructor(
        /**
         * 本次运行选择的内容发布清单；业务可读路由信息，不应直接改写。
         */
        readonly release: ContentRelease,
        owner: Scope,
    ) {
        invariant(
            !selectedRelease || selectedRelease === release.releaseId,
            'RELEASE_RESTART_REQUIRED',
            'A new content release requires a fresh JS runtime and engine asset cache',
        );
        selectedRelease = release.releaseId;
        this.scope = owner.child('assets');
        this.validateBundles();
        this.cache = new LeaseCache(
            (key) => this.fetch(this.addresses.get(key)!),
            (value) => {
                value.atlas?.addRef();
                value.asset.addRef();
            },
            (value) => {
                value.asset.decRef();
                value.atlas?.decRef();
            },
        );
    }
    /**
     * @internal
     * App 初始化时接入配置管理器，使 BundleHandle.tables 可用。
     */
    attachConfig(config: ConfigManager): void {
        this.config = config;
    }
    /**
     * 创建绑定默认所有者和命名空间的便捷入口；不会加载资源，也不会创建新的 Scope。
     * @param scope - 此入口之后加载资源的默认所有者。
     * @param namespace - 可选“模块/资源包”，用于解析相对名称。
     * @param moduleId - 可选实例宿主业务模块，通常由 ctx.assets 自动提供。
     * @returns ScopedAssets。
     */
    in(scope: Scope, namespace?: string, moduleId?: string): ScopedAssets {
        return new ScopedAssets(this, scope, namespace, moduleId);
    }
    /**
     * 将资源键解析为 Bundle 地址；可能加载 Bundle 和索引 JSON，但不加载目标资源。
     * AssetKey 传完整 ID；字符串形式须另传 type、scope，可用 namespace 指定“模块/资源包”。
     * 同名时使用包含子目录的名称或生成的 AssetKey，框架不会任意选择。
     * @param key - 完整的类型化资源键；查询不加载目标资源。
     * @param scope - 本次解析等待的所有者，取消时终止本次等待。
     * @returns 当前发布版本下的只读资源地址。
     * @throws FrameworkError 未登记、名称有歧义、种类不匹配或索引无效。
     * @throws OperationCancelled 所有者已取消或等待期间取消。
     */
    async resolve<K extends AssetKind>(key: AssetKey<K>, scope: Scope): Promise<AssetAddress<K>>;
    /**
     * 将资源键解析为 Bundle 地址；可能加载 Bundle 和索引 JSON，但不加载目标资源。
     * AssetKey 传完整 ID；字符串形式须另传 type、scope，可用 namespace 指定“模块/资源包”。
     * 同名时使用包含子目录的名称或生成的 AssetKey，框架不会任意选择。
     * @param name - 相对资源名或包含子目录的路径；名称重名时请使用生成键或完整相对路径。
     * @param type - Cocos 资源种类，例如 SpriteFrame；字符串形式必须提供。
     * @param scope - 本次解析等待的所有者，取消时终止本次等待。
     * @param namespace - 可选“模块/资源包”，例如 lobby/default；未提供时 name 必须是完整逻辑 ID。
     * @returns 当前发布版本下的只读资源地址。
     * @throws FrameworkError 未登记、名称有歧义、种类不匹配或索引无效。
     * @throws OperationCancelled 所有者已取消或等待期间取消。
     */
    async resolve(name: string, type: AssetKind, scope: Scope, namespace?: string): Promise<AssetAddress>;
    /**
     * 将资源键解析为 Bundle 地址；可能加载 Bundle 和索引 JSON，但不加载目标资源。
     * AssetKey 传完整 ID；字符串形式须另传 type、scope，可用 namespace 指定“模块/资源包”。
     * 同名时使用包含子目录的名称或生成的 AssetKey，框架不会任意选择。
     * @param keyOrName - 生成的 AssetKey 或资源名称；字符串形式需要同时提供资源种类。
     * @param typeOrScope - 键形式传 Scope，字符串形式传资源种类。
     * @param explicitScope - 字符串形式的等待所有者。
     * @param namespace - 可选“模块/资源包”，例如 lobby/default；未提供时 name 必须是完整逻辑 ID。
     * @returns 当前发布版本下的只读资源地址。
     * @throws FrameworkError 未登记、名称有歧义、种类不匹配或索引无效。
     * @throws OperationCancelled 所有者已取消或等待期间取消。
     */
    async resolve(
        keyOrName: AssetKey | string,
        typeOrScope: AssetKind | Scope,
        explicitScope?: Scope,
        namespace?: string,
    ): Promise<AssetAddress> {
        const key =
            typeof keyOrName === 'string'
                ? logicalKey(keyOrName, typeOrScope as AssetKind, namespace)
                : logicalKey(keyOrName.id, keyOrName.type);
        const owner = typeof keyOrName === 'string' ? explicitScope! : (typeOrScope as Scope);
        owner.signal.throwIfAborted();
        const ns = key.id.split('/').slice(0, 2).join('/');
        let pending = this.indices.get(ns);
        if (!pending) {
            const route = this.release.namespaces[ns];
            invariant(route, 'ASSET_NAMESPACE_MISSING', `Unknown namespace: ${ns}`);
            pending = this.loadPath(route.bundle, route.path, 'JsonAsset', this.scope).then((asset) =>
                validateIndex(asset.json, ns),
            );
            this.indices.set(ns, pending);
            void pending.catch(() => {
                if (this.indices.get(ns) === pending) this.indices.delete(ns);
            });
        }
        const index = await untilCancelled(pending, owner.signal);
        return Object.freeze({
            ...resolveIndex(index, key, typeof keyOrName === 'string'),
            revision: this.release.releaseId,
        });
    }
    /**
     * 按生成的逻辑键加载资源，并把引用交给 scope 持有。
     * @param key - 生成的 AssetKey，资源类型由 key.type 推导。
     * @param scope - 持有者；清理完成时归还该所有者的引用，其他所有者不受影响。
     * @returns Cocos 资源对象；Prefab 不会自动实例化，音频也不会自动播放。
     * @remarks 不要对返回的共享资源自行 decRef 或 releaseAll；优先使用较短的展示或会话 Scope。
     * @throws OperationCancelled 所有者取消；清单或加载错误原样传播。
     */
    async load<K extends AssetKind>(key: AssetKey<K>, scope: Scope): Promise<AssetTypes[K]> {
        const address = await this.resolve(key, scope);
        return this.loadAddress(address, scope);
    }
    /**
     * 按 Bundle 内路径加载，绕过动态清单。已有逻辑键时优先用 load。
     * @param bundle - 发布清单中登记的 Bundle ID 或引用。
     * @param path - Bundle 相对加载路径，不是磁盘路径；通常省略扩展名，保留必要的子资源后缀。
     * @param type - Cocos 资源种类。
     * @param scope - 资源引用的所有者。
     * @returns 加载完成的 Cocos 资源。
     * @remarks 直接路径不携带预制体脚本依赖清单；调用方必须先准备相应代码。
     * @throws FrameworkError 路径为空、绝对路径、含 .. 或 Bundle 未登记。
     */
    async loadPath<K extends AssetKind>(
        bundle: BundleRef,
        path: string,
        type: K,
        scope: Scope,
    ): Promise<AssetTypes[K]> {
        invariant(
            path.length > 0 && !path.split('/').includes('..') && !path.startsWith('/'),
            'ASSET_PATH_INVALID',
            'Use a bundle-relative asset path',
        );
        return this.loadAddress({ bundle: bundleId(bundle), path, type }, scope);
    }
    /**
     * 按已解析地址加载共享资源，并先准备地址声明的脚本依赖。
     * @param address - resolve 返回的地址，或受控的已知地址。
     * @param scope - 资源所有者；取消只终止本次等待，不强制中断引擎共享加载。
     * @returns 类型与 address.type 一致的资源。
     * @remarks 只准备代码，不执行模块业务工厂；图集单帧会同时持有图集和精灵帧。
     */
    async loadAddress<K extends AssetKind>(address: AssetAddress<K>, scope: Scope): Promise<AssetTypes[K]> {
        scope.signal.throwIfAborted();
        for (const id of address.requiredCodeModules ?? (address.codeModule ? [address.codeModule] : [])) {
            if (!this.codeReady(id)) await this.prepareCode(id, scope);
            invariant(
                this.codeReady(id),
                'MODULE_CODE_NOT_READY',
                `Load module code before deserializing ${address.path}`,
            );
        }
        const key = JSON.stringify([address.bundle, address.path, address.type, address.atlasFrame ?? '']);
        this.addresses.set(key, address);
        return (await this.cache.acquire(key, scope)).asset as AssetTypes[K];
    }
    /**
     * 准备一个资源包，并返回绑定所有者的资源、配置访问入口。
     * @param ref - 发布清单中的 Bundle 引用。
     * @param scope - 后续通过句柄加载内容的默认所有者。
     * @param moduleId - 可选实例宿主模块；推荐通过 ctx.assets.openBundle 自动传入。
     * @returns BundleHandle；它的 assets 和 tables 仍然按需加载，不会下载全包所有资源。
     * @throws OperationCancelled scope 取消；Bundle 未登记或引擎加载失败时拒绝。
     */
    async openBundle(ref: BundleRef, scope: Scope, moduleId?: string): Promise<BundleHandle> {
        await untilCancelled(this.prepareBundle(bundleId(ref)), scope.signal);
        invariant(this.config, 'APP_NOT_READY', 'Configuration service is not attached');
        return new BundleHandle(this, this.config, bundleId(ref), scope, moduleId);
    }
    /**
     * 准备 Bundle 及其声明的依赖并缓存加载过程，供底层适配使用。
     * @param id - 发布清单中的 Bundle ID。
     * @returns 引擎 Bundle 对象；不预加载包中每个资源。
     * @remarks 普通业务用 openBundle；不要自行 removeBundle 或 releaseAll 破坏共享持有关系。
     */
    async prepareBundle(id: string): Promise<EngineAssetManager.Bundle> {
        this.scope.signal.throwIfAborted();
        let pending = this.bundles.get(id);
        if (!pending) {
            const definition = this.release.bundles[id];
            invariant(definition, 'BUNDLE_NOT_REGISTERED', `Unknown bundle: ${id}`);
            pending = (async () => {
                for (const dependency of definition.dependencies ?? []) await this.prepareBundle(dependency);
                const existing = assetManager.getBundle(id);
                if (existing) return existing;
                return await new Promise<EngineAssetManager.Bundle>((resolve, reject) =>
                    assetManager.loadBundle(
                        definition.location ?? id,
                        definition.version ? { version: definition.version } : {},
                        (error, bundle) => (error ? reject(error) : resolve(bundle)),
                    ),
                );
            })();
            this.bundles.set(id, pending);
            void pending.catch(() => {
                if (this.bundles.get(id) === pending) this.bundles.delete(id);
            });
        }
        return pending;
    }
    private async fetch(address: AssetAddress): Promise<LoadedAsset> {
        const bundle = await this.prepareBundle(address.bundle);
        const type = address.atlasFrame ? SpriteAtlas : constructors[address.type];
        invariant(type, 'ASSET_TYPE_UNKNOWN', `Unknown kind: ${address.type}`);
        const asset = await new Promise<Asset>((resolve, reject) =>
            bundle.load(address.path, type as typeof Asset, (error, value) => (error ? reject(error) : resolve(value))),
        );
        if (!address.atlasFrame) return { asset };
        const frame = (asset as SpriteAtlas).getSpriteFrame(address.atlasFrame);
        if (!frame) {
            asset.addRef();
            asset.decRef();
        }
        invariant(frame, 'ATLAS_FRAME_MISSING', `Missing atlas frame ${address.atlasFrame}`);
        // Keep both the requested frame and its atlas alive for the complete physical lease.
        return { asset: frame, atlas: asset as SpriteAtlas };
    }
    /**
     * 加载预制体并创建框架托管实例；实例拥有 scope 下的子 Scope，清理时先销毁节点再归还预制体引用。
     * @param key - Prefab 类型的生成资源键。
     * @param parent - 实例要加入的父节点。
     * @param scope - 实例生命周期的所有者。
     * @param input - active 默认 true；moduleId 指定 GameComponent 的宿主业务模块，通常由 ctx.assets 提供。
     * @returns 已挂到 parent 的节点。active 为 false 时可先设置数据，再调用 assets.activate。
     * @remarks 宿主模块必须已完成业务初始化才可激活；动态 Part 推荐从当前模块的 ScopedAssets 创建。
     * @throws FrameworkError 宿主模块尚未就绪或绑定失败；加载及取消错误原样传播。
     */
    async instantiate(
        key: AssetKey<'Prefab'>,
        parent: Node,
        scope: Scope,
        input: {
            /**
             * 是否立即激活，默认 true；false 时先完成数据设置，再通过 assets.activate 接通业务生命周期。
             */
            active?: boolean;
            /**
             * 实例的宿主业务模块 ID；ctx.assets 会默认提供当前模块，直接使用 Assets 时应明确指定。
             */
            moduleId?: string;
        } = {},
    ): Promise<Node> {
        const instance = scope.child(`instance:${key.id}`);
        try {
            const address = await this.resolve(key, instance);
            const moduleId = input.moduleId ?? address.codeModule;
            if (input.active !== false && moduleId)
                invariant(
                    this.moduleReady(moduleId),
                    'MODULE_NOT_READY',
                    `Module factory is still initializing: ${moduleId}`,
                );
            const prefab = await this.loadAddress(address, instance);
            instance.signal.throwIfAborted();
            const node = instantiate(prefab);
            node.active = false;
            // LIFO: destroy completes before the prefab lease is returned.
            instance.defer(() => destroyNode(node));
            this.instances.set(node, { scope: instance, moduleId });
            this.bindInstance(node, instance, moduleId, input.active ?? true);
            parent.addChild(node);
            node.active = input.active ?? true;
            return node;
        } catch (error) {
            await instance.close();
            throw error;
        }
    }
    /**
     * 激活由本管理器以 active: false 创建的实例，并接通框架生命周期。
     * @param node - 本管理器创建且尚未销毁的节点。
     * @throws FrameworkError 节点不受托管或宿主业务模块尚未初始化。
     */
    activate(node: Node): void {
        const instance = this.instances.get(node);
        invariant(
            instance && isValid(node, true),
            'INSTANCE_NOT_MANAGED',
            'Activate only a framework-owned prefab instance',
        );
        instance.scope.signal.throwIfAborted();
        if (instance.moduleId) invariant(this.moduleReady(instance.moduleId), 'MODULE_NOT_READY', instance.moduleId);
        this.activateInstance(node, instance.scope);
        node.active = true;
    }
    /**
     * 异步设置图片，同一个 Sprite 总以最后一次请求为准；新图准备好前保留旧图。
     * @param target - 要显示图片的 Sprite 组件。
     * @param key - SpriteFrame 资源键或相对资源名称。
     * @param owner - 图片显示期间的所有者；清理时移除本次引用并归还资源租约。
     * @param namespace - 字符串相对名称所需的“模块/资源包”。
     * @returns 新图设置完成且旧图持有已归还时完成。
     * @throws OperationCancelled 被较新的请求替代或 owner 取消；目标失效及加载失败也会拒绝。
     * @example
     * await this.ctx.assets.in(show.scope).setSprite(this.sprIcon, iconKey);
     */
    async setSprite(
        target: Sprite,
        key: AssetKey<'SpriteFrame'> | string,
        owner: Scope,
        namespace?: string,
    ): Promise<void> {
        owner.signal.throwIfAborted();
        let state = this.sprites.get(target);
        if (!state) this.sprites.set(target, (state = { sequence: 0 }));
        const sequence = ++state.sequence;
        if (state.pending) void state.pending.close().catch(reportError);
        const pending = owner.child(`sprite:${typeof key === 'string' ? key : key.id}`);
        state.pending = pending;
        try {
            const frame =
                typeof key === 'string'
                    ? ((await this.loadAddress(
                          await this.resolve(key, 'SpriteFrame', pending, namespace),
                          pending,
                      )) as SpriteFrame)
                    : await this.load(key, pending);
            pending.signal.throwIfAborted();
            if (state.sequence !== sequence || !isValid(target, true))
                throw new FrameworkError('SPRITE_TARGET_CHANGED', 'Sprite assignment is no longer current');
            const previous = state.displayed;
            target.spriteFrame = frame;
            state.displayed = pending;
            state.pending = undefined;
            pending.defer(() => {
                if (state!.displayed === pending) {
                    if (isValid(target, true) && target.spriteFrame === frame) target.spriteFrame = null;
                    state!.displayed = undefined;
                }
            });
            if (previous) await previous.close();
        } catch (error) {
            if (state.pending === pending) state.pending = undefined;
            await pending.close();
            throw error;
        }
    }
    private validateBundles(): void {
        const visiting = new Set<string>(),
            complete = new Set<string>();
        const visit = (id: string) => {
            if (complete.has(id)) return;
            invariant(
                this.release.bundles[id] && !visiting.has(id),
                'BUNDLE_GRAPH_INVALID',
                `Missing or cyclic bundle: ${id}`,
            );
            visiting.add(id);
            for (const dep of this.release.bundles[id].dependencies ?? []) visit(dep);
            visiting.delete(id);
            complete.add(id);
        };
        for (const id of Object.keys(this.release.bundles)) visit(id);
    }
}
/**
 * @internal
 * 停用并请求销毁节点，等待引擎帧末完成实际销毁后才返回，用于保证资源释放顺序。
 * @param node - 待销毁节点；已无效时直接完成。
 * @returns 节点确实无效后完成的 Promise；依赖引擎继续派发绘制帧事件。
 */
export function destroyNode(node: Node): Promise<void> {
    if (!isValid(node)) return Promise.resolve();
    node.active = false;
    node.destroy();
    return new Promise((resolve) => {
        const check = () => {
            if (!isValid(node)) resolve();
            else director.once(Director.EVENT_AFTER_DRAW, check);
        };
        director.once(Director.EVENT_AFTER_DRAW, check);
    });
}
/**
 * 带默认 Scope、命名空间和宿主模块的资源入口，通常从 ctx.assets 或 assets.in 获得。
 * 资源包只决定内容位置，scope 决定加载结果何时释放。
 */
export class ScopedAssets {
    /**
     * 创建资源访问门面，一般使用 assets.in 或 ctx.assets。
     * @param manager - 应用共享资源管理器。
     * @param scope - 默认资源所有者。
     * @param namespace - 默认“模块/资源包”，供相对名称解析。
     * @param moduleId - 默认实例宿主模块，不等同于资源所在模块。
     */
    constructor(
        /**
         * 底层共享管理器；常规加载使用当前入口的方法以保留默认所有者。
         */
        readonly manager: Assets,
        /**
         * 默认资源所有者。ctx.assets 默认跟随模块；临时 UI 资源应改用 in(show.scope)。
         */
        readonly scope: Scope,
        /**
         * 相对资源名使用的默认“模块/资源包”；完整 AssetKey 不依赖它。
         */
        readonly namespace?: string,
        /**
         * 实例的默认宿主业务模块，用于绑定 GameComponent 上下文。
         */
        readonly moduleId?: string,
    ) {}
    /**
     * 换用另一个资源所有者，保留当前命名空间和宿主模块；不会创建子 Scope。
     * @param scope - 新的默认所有者，例如 show.scope。
     * @returns 新的 ScopedAssets 入口，原入口不变。
     * @example
     * const assets = this.ctx.assets.in(show.scope);
     * await assets.setSprite(this.sprIcon, iconKey);
     */
    in(scope: Scope): ScopedAssets {
        return new ScopedAssets(this.manager, scope, this.namespace, this.moduleId);
    }
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
     * 查询资源在 Bundle 中的路径，不加载目标资源；查询索引本身可能产生加载。
     * 传生成的 AssetKey，或传相对名称及 Cocos 种类（例如 resolve("icons/coin", "SpriteFrame")）。
     * @param key - 生成的 AssetKey；完整键不依赖默认命名空间。
     * @param type - Cocos 资源种类，例如 SpriteFrame；字符串形式必须提供。
     * @returns 资源地址；短名称重名时抛 ASSET_NAME_AMBIGUOUS，须改用相对路径或生成的键。
     */
    resolve(key: AssetKey | string, type?: AssetKind): Promise<AssetAddress> {
        return typeof key === 'string'
            ? this.manager.resolve(key, type!, this.scope, this.namespace)
            : this.manager.resolve(key, this.scope);
    }
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
     * 按资源键或相对名称加载，类型由键或第二个 type 参数推导，引用由当前 scope 持有。
     * 优先传生成的 AssetKey；字符串写法例如 load("icons/coin", "SpriteFrame")。
     * @param key - 生成的 AssetKey；完整键不依赖默认命名空间。
     * @param type - Cocos 资源种类，例如 SpriteFrame；字符串形式必须提供。
     * @returns 加载后的 Cocos 资源，不会自动实例化或播放。
     * @throws OperationCancelled 当前 scope 取消；名称歧义、未登记及引擎加载失败也会拒绝。
     * @remarks 直接赋图时需处理先后请求竞争，推荐 setSprite 自动处理最新请求及引用释放。
     */
    load(key: AssetKey | string, type?: AssetKind): Promise<Asset> {
        return typeof key === 'string'
            ? this.manager
                  .resolve(key, type!, this.scope, this.namespace)
                  .then((address) => this.manager.loadAddress(address, this.scope))
            : this.manager.load(key, this.scope);
    }
    /**
     * 绕过索引，按 Bundle 相对路径加载，引用跟随当前 scope。
     * @param bundle - 已登记的 Bundle 引用。
     * @param path - 引擎加载路径，通常无扩展名；不是 db:// 或磁盘路径。
     * @param type - Cocos 资源种类。
     * @returns 加载完成的资源。预制体脚本依赖须由调用方事先准备。
     */
    loadPath<K extends AssetKind>(bundle: BundleRef, path: string, type: K): Promise<AssetTypes[K]> {
        return this.manager.loadPath(bundle, path, type, this.scope);
    }
    /**
     * 取得资源包访问入口，不加载包内全部内容。
     * @param ref - 已登记的资源包引用。
     * @param owner - 后续加载的默认所有者，默认当前 scope；界面使用时可传 show.scope。
     * @returns 带 assets、tables 的 BundleHandle，保留当前宿主模块。
     */
    openBundle(ref: BundleRef, owner = this.scope): Promise<BundleHandle> {
        return this.manager.openBundle(ref, owner, this.moduleId);
    }
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
             * 覆盖默认宿主业务模块，省略时使用当前 ScopedAssets 的 moduleId；不按资源目录推断宿主。
             */
            moduleId?: string;
        },
    ): Promise<Node> {
        return this.manager.instantiate(key, parent, this.scope, { moduleId: this.moduleId, ...input });
    }
    /**
     * 激活之前以 active: false 创建的托管实例。
     * @param node - 当前资源管理器创建的有效节点；宿主业务模块须已就绪。
     */
    activate(node: Node): void {
        this.manager.activate(node);
    }
    /**
     * 设置图片并自动处理同一 Sprite 的先后请求、旧图替换与引用归还。
     * @param target - 要设置的 Sprite。
     * @param key - 生成的 SpriteFrame 键或当前命名空间内的相对路径。
     * @returns 本次图片应用完成；被替代、scope 取消或加载失败时拒绝。
     * @example
     * await this.ctx.assets.in(show.scope).setSprite(this.sprIcon, iconKey);
     */
    setSprite(target: Sprite, key: AssetKey<'SpriteFrame'> | string): Promise<void> {
        return this.manager.setSprite(target, key, this.scope, this.namespace);
    }
}
/**
 * 已准备的 Bundle 访问入口；本身不代表全包资源已下载，也不提供“一次释放全包”。
 * 通过创建时的 Scope 统一结束后续资源、配置及实例的持有。
 */
export class BundleHandle {
    /**
     * 默认使用此包命名空间及句柄 scope 的资源入口；生成的完整键仍可指向其他包。
     */
    readonly assets: ScopedAssets;
    /**
     * 默认选择此 Bundle 数据路由的配置入口，适合加载分包配置；可在 load 选项中显式覆盖。
     */
    readonly tables: ScopedConfig;
    /**
     * @internal
     * 由 assets.openBundle 创建，接入资源和配置管理器并绑定默认所有者。
     */
    constructor(
        manager: Assets,
        config: ConfigManager,
        /**
         * 发布清单中的 Bundle ID。
         */
        readonly id: string,
        /**
         * 通过该句柄加载资源和配置的默认所有者；关闭后已有表查询会拒绝。
         */
        readonly scope: Scope,
        moduleId?: string,
    ) {
        this.assets = manager.in(scope, manager.release.bundles[id]?.namespace, moduleId);
        this.tables = config.in(scope, id);
    }
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
    ): Promise<Node> {
        return this.assets.instantiate(key, parent, input);
    }
}
