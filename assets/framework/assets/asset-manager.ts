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

/** Shared loader for keys, names, direct paths, configuration and prefab instances. */
export class Assets {
    private readonly bundles = new Map<string, Promise<EngineAssetManager.Bundle>>();
    private readonly indices = new Map<string, Promise<NamespaceIndex>>();
    private readonly addresses = new Map<string, AssetAddress>();
    private readonly cache: LeaseCache<LoadedAsset>;
    private readonly sprites = new WeakMap<Sprite, SpriteWrite>();
    private readonly scope: Scope;
    private config?: ConfigManager;
    private readonly instances = new WeakMap<Node, { scope: Scope; moduleId?: string }>();
    bindInstance: (node: Node, scope: Scope, moduleId: string | undefined, active: boolean) => void = () => {};
    activateInstance: (node: Node, scope: Scope) => void = () => {};
    prepareCode: (id: string, owner: Scope) => Promise<void> = async () => {};
    codeReady: (moduleId: string) => boolean = () => false;
    moduleReady: (moduleId: string) => boolean = () => false;
    constructor(
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
    attachConfig(config: ConfigManager): void {
        this.config = config;
    }
    in(scope: Scope, namespace?: string, moduleId?: string): ScopedAssets {
        return new ScopedAssets(this, scope, namespace, moduleId);
    }
    async resolve<K extends AssetKind>(key: AssetKey<K>, scope: Scope): Promise<AssetAddress<K>>;
    async resolve(name: string, type: AssetKind, scope: Scope, namespace?: string): Promise<AssetAddress>;
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
    async load<K extends AssetKind>(key: AssetKey<K>, scope: Scope): Promise<AssetTypes[K]> {
        const address = await this.resolve(key, scope);
        return this.loadAddress(address, scope);
    }
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
    async openBundle(ref: BundleRef, scope: Scope, moduleId?: string): Promise<BundleHandle> {
        await untilCancelled(this.prepareBundle(bundleId(ref)), scope.signal);
        invariant(this.config, 'APP_NOT_READY', 'Configuration service is not attached');
        return new BundleHandle(this, this.config, bundleId(ref), scope, moduleId);
    }
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
    async instantiate(
        key: AssetKey<'Prefab'>,
        parent: Node,
        scope: Scope,
        input: { active?: boolean; moduleId?: string } = {},
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
export class ScopedAssets {
    constructor(
        readonly manager: Assets,
        readonly scope: Scope,
        readonly namespace?: string,
        readonly moduleId?: string,
    ) {}
    in(scope: Scope): ScopedAssets {
        return new ScopedAssets(this.manager, scope, this.namespace, this.moduleId);
    }
    resolve<K extends AssetKind>(key: AssetKey<K>): Promise<AssetAddress<K>>;
    resolve(name: string, type: AssetKind): Promise<AssetAddress>;
    resolve(key: AssetKey | string, type?: AssetKind): Promise<AssetAddress> {
        return typeof key === 'string'
            ? this.manager.resolve(key, type!, this.scope, this.namespace)
            : this.manager.resolve(key, this.scope);
    }
    load<K extends AssetKind>(key: AssetKey<K>): Promise<AssetTypes[K]>;
    load<K extends AssetKind>(name: string, type: K): Promise<AssetTypes[K]>;
    load(key: AssetKey | string, type?: AssetKind): Promise<Asset> {
        return typeof key === 'string'
            ? this.manager
                  .resolve(key, type!, this.scope, this.namespace)
                  .then((address) => this.manager.loadAddress(address, this.scope))
            : this.manager.load(key, this.scope);
    }
    loadPath<K extends AssetKind>(bundle: BundleRef, path: string, type: K): Promise<AssetTypes[K]> {
        return this.manager.loadPath(bundle, path, type, this.scope);
    }
    openBundle(ref: BundleRef, owner = this.scope): Promise<BundleHandle> {
        return this.manager.openBundle(ref, owner, this.moduleId);
    }
    instantiate(key: AssetKey<'Prefab'>, parent: Node, input?: { active?: boolean; moduleId?: string }): Promise<Node> {
        return this.manager.instantiate(key, parent, this.scope, { moduleId: this.moduleId, ...input });
    }
    activate(node: Node): void {
        this.manager.activate(node);
    }
    setSprite(target: Sprite, key: AssetKey<'SpriteFrame'> | string): Promise<void> {
        return this.manager.setSprite(target, key, this.scope, this.namespace);
    }
}
export class BundleHandle {
    readonly assets: ScopedAssets;
    readonly tables: ScopedConfig;
    constructor(
        manager: Assets,
        config: ConfigManager,
        readonly id: string,
        readonly scope: Scope,
        moduleId?: string,
    ) {
        this.assets = manager.in(scope, manager.release.bundles[id]?.namespace, moduleId);
        this.tables = config.in(scope, id);
    }
    instantiate(key: AssetKey<'Prefab'>, parent: Node, input?: { active?: boolean; moduleId?: string }): Promise<Node> {
        return this.assets.instantiate(key, parent, input);
    }
}
