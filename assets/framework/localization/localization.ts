import type { AssetAddress, AssetKey, AssetKind, BundleRef } from '../assets/asset-types';
import { bundleId } from '../assets/asset-types';
import { LeaseCache } from '../assets/lease-cache';
import { untilCancelled } from '../core/cancellation';
import { FrameworkError, invariant, OperationCancelled, reportError } from '../core/errors';
import { Scope, type Lifetime } from '../core/scope';

export type TextParameters = Readonly<Record<string, string | number>>;
/** 工作簿生成的文案键；参数名参与类型检查，import 不加载资源。 */
export interface TextKey<P extends string = string> {
    readonly namespace: string;
    readonly key: string;
    readonly contract: string;
    readonly parameters: readonly P[];
}
export interface LocalizedAssetKey<K extends AssetKind = AssetKind> {
    readonly namespace: string;
    readonly key: string;
    readonly contract: string;
    readonly type: K;
}
export type TextArguments<P extends string> = [P] extends [never]
    ? [values?: TextParameters]
    : [values: Readonly<Record<P, string | number>>];
export interface LocaleRoute {
    readonly bundle: string;
    readonly path: string;
    readonly revision: string;
}
export interface LocalizationDefinition {
    readonly namespace: string;
    readonly contract: string;
    readonly catalogs: Readonly<Record<string, LocaleRoute>>;
}
/** 自动生成在 ContentRelease 中，业务无需装配语言目录。 */
export interface LocalizationRelease {
    readonly defaultLocale: string;
    readonly locales: readonly string[];
    readonly bundles: Readonly<Record<string, LocalizationDefinition>>;
}
export interface LocaleCatalog {
    readonly formatVersion: 2;
    readonly namespace: string;
    readonly locale: string;
    readonly contract: string;
    readonly revision: string;
    readonly texts: Readonly<Record<string, string>>;
    readonly assets: Readonly<Record<string, AssetKey>>;
    readonly font: AssetKey<'Font'> | null;
}
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const pattern = /\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g;
const kinds = [
    'Prefab',
    'SpriteFrame',
    'Texture2D',
    'ImageAsset',
    'AudioClip',
    'JsonAsset',
    'TextAsset',
    'Material',
    'SpriteAtlas',
    'Font',
    'SceneAsset',
];
export function textParameters(text: string): string[] {
    const result = new Set<string>();
    text.replace(pattern, (token, name: string | undefined) => {
        if (name) result.add(name);
        return token;
    });
    return Array.from(result).sort();
}
export function parseLocaleCatalog(input: unknown, definition: LocalizationDefinition, locale: string): LocaleCatalog {
    const route = definition.catalogs[locale];
    invariant(
        object(input) &&
            input.formatVersion === 2 &&
            input.namespace === definition.namespace &&
            input.locale === locale &&
            input.contract === definition.contract &&
            input.revision === route?.revision &&
            object(input.texts) &&
            object(input.assets),
        'I18N_CATALOG_INVALID',
        `语言目录版本或归属不匹配：${definition.namespace}/${locale}`,
    );
    const texts: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(input.texts)) {
        invariant(key.length > 0 && typeof value === 'string', 'I18N_TEXT_INVALID', `${locale}/${key}`);
        texts[key] = value;
    }
    const asset = (value: unknown): AssetKey => {
        invariant(
            object(value) &&
                typeof value.id === 'string' &&
                value.id.length > 0 &&
                typeof value.type === 'string' &&
                kinds.includes(value.type),
            'I18N_ASSET_INVALID',
            locale,
        );
        return Object.freeze({ id: value.id, type: value.type as AssetKind });
    };
    const assets = Object.fromEntries(Object.entries(input.assets).map(([key, value]) => [key, asset(value)]));
    const font = input.font === null ? null : asset(input.font);
    invariant(font === null || font.type === 'Font', 'I18N_FONT_INVALID', locale);
    return Object.freeze({
        formatVersion: 2,
        namespace: definition.namespace,
        locale,
        contract: definition.contract,
        revision: route.revision,
        texts: Object.freeze(texts),
        assets: Object.freeze(assets),
        font: font as AssetKey<'Font'> | null,
    });
}
function compatible(current: LocaleCatalog, fallback: LocaleCatalog): void {
    for (const [key, value] of Object.entries(current.texts))
        invariant(
            has(fallback.texts, key) &&
                textParameters(value).join(',') === textParameters(fallback.texts[key]).join(','),
            'I18N_PARAMETERS_MISMATCH',
            `${current.namespace}/${current.locale}/${key}`,
        );
    for (const [key, value] of Object.entries(current.assets))
        invariant(fallback.assets[key]?.type === value.type, 'I18N_ASSET_TYPE', `${current.namespace}/${key}`);
}
/** 准备好的目录快照；直接取出的资源键仍通过原有 assets API 持有。 */
export class LocaleReader {
    constructor(
        readonly locale: string,
        private readonly current: LocaleCatalog,
        private readonly fallback: LocaleCatalog,
    ) {}
    private check(key: { namespace: string; contract: string }): void {
        invariant(
            key.namespace === this.current.namespace && key.contract === this.current.contract,
            'I18N_KEY_CONTRACT',
            `多语言键与资源包或合同版本不匹配：${key.namespace}`,
        );
    }
    text<P extends string>(
        key: TextKey<P>,
        values: TextParameters = {},
    ): { text: string; locale: string; font: AssetKey<'Font'> | null } {
        this.check(key);
        const catalog = has(this.current.texts, key.key) ? this.current : this.fallback;
        invariant(has(catalog.texts, key.key), 'I18N_TEXT_MISSING', key.key);
        const text = catalog.texts[key.key].replace(pattern, (token, name: string | undefined) => {
            if (!name) return token === '{{' ? '{' : '}';
            const value = has(values, name) ? values[name] : undefined;
            invariant(
                typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)),
                'I18N_PARAMETER_MISSING',
                `${key.key}/${name}`,
            );
            return String(value);
        });
        return { text, locale: catalog.locale, font: catalog.font ?? this.fallback.font };
    }
    t<P extends string>(key: TextKey<P>, ...args: TextArguments<NoInfer<P>>): string {
        return this.text(key, args[0]).text;
    }
    asset<K extends AssetKind>(key: LocalizedAssetKey<K>): AssetKey<K> {
        this.check(key);
        const value = this.current.assets[key.key] ?? this.fallback.assets[key.key];
        invariant(value?.type === key.type, 'I18N_ASSET_TYPE', key.key);
        return value as AssetKey<K>;
    }
}
/** @internal prepare 不改界面，validate 在提交前读取最新参数，commit 返回同步回滚函数。 */
export interface PreparedLocaleBinding {
    validate(): void;
    commit(): () => void;
}
export interface LocaleBinding {
    readonly active: () => boolean;
    prepare(reader: LocaleReader, owner: Lifetime): Promise<PreparedLocaleBinding>;
}
type Bound = {
    binding: LocaleBinding;
    owner: Lifetime;
    active: boolean;
    scope?: Scope;
    prepared?: PreparedLocaleBinding;
    stop(): void;
};
type Snapshot = {
    scope: Scope;
    reader: LocaleReader;
    detach(): void;
    bindings: Map<Bound, { scope: Scope; prepared: PreparedLocaleBinding }>;
};
type Pending = { scope: Scope; done: Promise<void> };

/** 按资源包使用的目录，随 owner 结束注销。 */
export class LocaleHandle {
    private snapshot?: Snapshot;
    private readonly bindings = new Set<Bound>();
    readonly scope: Scope;
    constructor(
        private readonly manager: Localization,
        readonly definition: LocalizationDefinition,
        owner: Lifetime,
    ) {
        this.scope = owner.child(`i18n:${definition.namespace}`);
    }
    get active(): boolean {
        return !this.scope.signal.aborted;
    }
    get reader(): LocaleReader {
        this.scope.signal.throwIfAborted();
        invariant(this.snapshot, 'I18N_NOT_READY', this.definition.namespace);
        return this.snapshot.reader;
    }
    get locale(): string {
        return this.reader.locale;
    }
    t<P extends string>(key: TextKey<P>, ...args: TextArguments<NoInfer<P>>): string {
        return this.reader.text(key, args[0]).text;
    }
    asset<K extends AssetKind>(key: LocalizedAssetKey<K>): AssetKey<K> {
        return this.reader.asset(key);
    }
    /** @internal 引擎适配层通过此接口参与整个切换事务。 */
    async bind(binding: LocaleBinding, owner: Lifetime): Promise<{ refresh(): void; dispose(): void }> {
        owner.signal.throwIfAborted();
        const bound: Bound = { binding, owner, active: true, stop: () => {} };
        const usable = () => bound.active && this.active && !owner.signal.aborted && binding.active();
        const detach = owner.signal.onAbort(() => bound.stop());
        bound.stop = () => {
            bound.active = false;
            this.bindings.delete(bound);
            detach();
            if (bound.scope) this.manager.retire(bound.scope);
        };
        try {
            while (usable()) {
                await this.manager.settled(owner);
                const snapshot = this.snapshot!;
                const scope = snapshot.scope.child('binding');
                const abort = owner.signal.onAbort(() => scope.cancel());
                try {
                    const prepared = await binding.prepare(snapshot.reader, scope.lifetime);
                    if (!usable()) throw new OperationCancelled();
                    if (this.snapshot !== snapshot || this.manager.switching) {
                        await scope.close();
                        continue;
                    }
                    prepared.validate();
                    prepared.commit();
                    bound.scope = scope;
                    bound.prepared = prepared;
                    this.bindings.add(bound);
                    return {
                        refresh: () => {
                            if (usable()) {
                                bound.prepared!.validate();
                                bound.prepared!.commit();
                            }
                        },
                        dispose: bound.stop,
                    };
                } catch (error) {
                    await scope.close();
                    // 切换提交会回收旧快照；首次绑定尚未登记，需在新快照下重新准备。
                    if (error instanceof OperationCancelled && usable() && this.snapshot !== snapshot) continue;
                    throw error;
                } finally {
                    abort();
                }
            }
            throw new OperationCancelled();
        } catch (error) {
            bound.stop();
            throw error;
        }
    }
    /** @internal */
    async prepare(locale: string, transaction: Lifetime): Promise<Snapshot> {
        const scope = this.scope.child(locale);
        const detach = transaction.signal.onAbort(() => scope.cancel());
        scope.defer(detach);
        try {
            const reader = await this.manager.read(this.definition, locale, scope.lifetime);
            const bindings = new Map<Bound, { scope: Scope; prepared: PreparedLocaleBinding }>();
            const results = await Promise.allSettled(
                Array.from(this.bindings).map(async (bound) => {
                    if (!bound.active || bound.owner.signal.aborted || !bound.binding.active()) return;
                    const child = scope.child('binding');
                    const off = bound.owner.signal.onAbort(() => child.cancel());
                    child.defer(off);
                    try {
                        const prepared = await bound.binding.prepare(reader, child.lifetime);
                        if (bound.active && !bound.owner.signal.aborted && bound.binding.active())
                            bindings.set(bound, { scope: child, prepared });
                        else await child.close();
                    } catch (error) {
                        if (!bound.active || bound.owner.signal.aborted || !bound.binding.active()) {
                            await child.close();
                            return;
                        }
                        throw error;
                    }
                }),
            );
            scope.signal.throwIfAborted();
            const failed = results.find((result) => result.status === 'rejected');
            if (failed?.status === 'rejected') throw failed.reason;
            return { scope, reader, bindings, detach };
        } catch (error) {
            await scope.close();
            throw error;
        }
    }
    /** @internal */
    validate(snapshot: Snapshot): void {
        for (const [bound, item] of snapshot.bindings)
            if (bound.active && !bound.owner.signal.aborted && bound.binding.active()) item.prepared.validate();
    }
    /** @internal */
    apply(snapshot: Snapshot, undo: (() => void)[]): void {
        for (const [bound, item] of snapshot.bindings)
            if (bound.active && !bound.owner.signal.aborted && bound.binding.active())
                undo.push(item.prepared.commit());
    }
    /** @internal */
    accept(snapshot: Snapshot): Scope | undefined {
        snapshot.detach();
        const previous = this.snapshot;
        this.snapshot = snapshot;
        for (const [bound, item] of snapshot.bindings) {
            if (bound.active && !bound.owner.signal.aborted && bound.binding.active()) {
                bound.scope = item.scope;
                bound.prepared = item.prepared;
            } else this.manager.retire(item.scope);
        }
        return previous?.scope;
    }
}

/** use 按需加载当前和默认目录，不初始化其他业务模块。 */
export class Localization {
    private readonly scope: Scope;
    private readonly handles = new Set<LocaleHandle>();
    private readonly catalogs: LeaseCache<{ catalog: LocaleCatalog; scope: Scope }>;
    private readonly requests = new Map<string, { definition: LocalizationDefinition; locale: string }>();
    private readonly compatibleCatalogs = new WeakMap<LocaleCatalog, WeakSet<LocaleCatalog>>();
    private pending?: Pending;
    private epoch = 0;
    private selected?: string;
    constructor(
        owner: Lifetime,
        private readonly load: (address: AssetAddress<'JsonAsset'>, owner: Lifetime) => Promise<unknown>,
        readonly release?: LocalizationRelease,
    ) {
        this.scope = owner.child('localization');
        this.catalogs = new LeaseCache(
            (id) => {
                const { definition, locale } = this.requests.get(id)!;
                const route = definition.catalogs[locale];
                // 加载期限独立于任一页面；租约全部归还或 App 结束后才回收。
                const scope = this.scope.child(`catalog:${definition.namespace}/${locale}`);
                const work = (async () => {
                    try {
                        const input = await this.load(
                            { bundle: route.bundle, path: route.path, type: 'JsonAsset' },
                            scope.lifetime,
                        );
                        scope.signal.throwIfAborted();
                        return { catalog: parseLocaleCatalog(input, definition, locale), scope };
                    } catch (error) {
                        await this.cleanup([scope]);
                        throw error;
                    }
                })();
                this.track(work);
                return work;
            },
            () => {},
            (value) => this.cleanup([value.scope]),
        );
        if (release) {
            invariant(
                release.locales.includes(release.defaultLocale) &&
                    new Set(release.locales).size === release.locales.length,
                'I18N_OPTIONS_INVALID',
                '默认语言必须包含在支持语言中',
            );
            for (const definition of Object.values(release.bundles))
                invariant(
                    has(definition.catalogs, release.defaultLocale),
                    'I18N_OPTIONS_INVALID',
                    definition.namespace,
                );
        }
        this.selected = release?.defaultLocale;
    }
    get locale(): string | undefined {
        return this.selected;
    }
    get locales(): readonly string[] {
        return this.release?.locales ?? [];
    }
    get switching(): boolean {
        return !!this.pending;
    }
    /** @internal 等待最新切换，失败后仍可使用原语言。 */
    async settled(owner: Lifetime): Promise<void> {
        while (this.pending)
            await untilCancelled(
                this.pending.done.catch(() => {}),
                owner.signal,
            );
        owner.signal.throwIfAborted();
        this.scope.signal.throwIfAborted();
    }
    async use(bundle: BundleRef, owner: Lifetime): Promise<LocaleHandle> {
        this.scope.signal.throwIfAborted();
        owner.signal.throwIfAborted();
        const definition = this.release?.bundles[bundleId(bundle)];
        invariant(definition, 'I18N_BUNDLE_UNKNOWN', `资源包没有多语言声明：${bundleId(bundle)}`);
        const handle = new LocaleHandle(this, definition, owner);
        const off = this.scope.signal.onAbort(() => handle.scope.cancel());
        handle.scope.defer(off);
        handle.scope.defer(this.scope.defer(() => handle.scope.close()));
        let finishing = false;
        const work = (async () => {
            try {
                for (;;) {
                    await this.settled(handle.scope.lifetime);
                    const epoch = this.epoch;
                    const prepared = await handle.prepare(this.selected!, this.scope.lifetime);
                    if (epoch !== this.epoch || this.pending) {
                        await prepared.scope.close();
                        continue;
                    }
                    handle.scope.signal.throwIfAborted();
                    handle.accept(prepared);
                    this.handles.add(handle);
                    handle.scope.defer(handle.scope.signal.onAbort(() => this.handles.delete(handle)));
                    return handle;
                }
            } catch (error) {
                finishing = true;
                await handle.scope.close();
                throw error;
            }
        })();
        this.track(work);
        return untilCancelled(work, handle.scope.signal).catch((error) => {
            // 内部失败触发的清理也会取消句柄，不能用取消错误掩盖原始加载/校验错误。
            if (finishing) return work;
            throw error;
        });
    }
    /** 成功表示所有已绑定目录、文本、字体与图片一起提交，失败保留旧状态。 */
    setLocale(locale: string, owner: Lifetime): Promise<void> {
        this.scope.signal.throwIfAborted();
        owner.signal.throwIfAborted();
        invariant(this.release?.locales.includes(locale), 'I18N_LOCALE_UNKNOWN', locale);
        this.pending?.scope.cancel();
        this.pending = undefined;
        ++this.epoch;
        if (locale === this.selected) return Promise.resolve();
        const scope = this.scope.child(`switch:${locale}`);
        const detach = owner.signal.onAbort(() => scope.cancel());
        let committed = false,
            finishing = false;
        const stages = new Map<LocaleHandle, Snapshot>();
        const pending: Pending = { scope, done: Promise.resolve() };
        this.pending = pending;
        const work = Promise.resolve().then(async () => {
            try {
                const results = await Promise.allSettled(
                    Array.from(this.handles)
                        .filter((handle) => handle.active)
                        .map(async (handle) => {
                            try {
                                stages.set(handle, await handle.prepare(locale, scope.lifetime));
                            } catch (error) {
                                if (handle.active) throw error;
                            }
                        }),
                );
                scope.signal.throwIfAborted();
                const failed = results.find((result) => result.status === 'rejected');
                if (failed?.status === 'rejected') throw failed.reason;
                for (const [handle, stage] of stages) if (handle.active) handle.validate(stage);
                const undo: (() => void)[] = [];
                try {
                    for (const [handle, stage] of stages) if (handle.active) handle.apply(stage, undo);
                } catch (error) {
                    for (const rollback of undo.reverse()) {
                        try {
                            rollback();
                        } catch (cleanup) {
                            reportError(cleanup);
                        }
                    }
                    throw error;
                }
                this.selected = locale;
                committed = true;
                detach();
                if (this.pending === pending) this.pending = undefined;
                const old: Scope[] = [];
                for (const [handle, stage] of stages) {
                    if (handle.active) {
                        const previous = handle.accept(stage);
                        if (previous) old.push(previous);
                    } else old.push(stage.scope);
                }
                await this.cleanup(old);
            } catch (error) {
                await this.cleanup(Array.from(stages.values()).map((stage) => stage.scope));
                throw error;
            } finally {
                finishing = true;
                detach();
                if (this.pending === pending) this.pending = undefined;
                await scope.close();
            }
        });
        pending.done = work;
        this.track(work);
        return untilCancelled(work, scope.signal).catch((error) => {
            if (committed || finishing) return work;
            throw error;
        });
    }
    /** @internal */
    async read(definition: LocalizationDefinition, locale: string, owner: Lifetime): Promise<LocaleReader> {
        const load = async (selected: string) => {
            const route = definition.catalogs[selected];
            const id = JSON.stringify([
                definition.namespace,
                definition.contract,
                selected,
                route.bundle,
                route.path,
                route.revision,
            ]);
            this.requests.set(id, { definition, locale: selected });
            return (await this.catalogs.acquire(id, owner)).catalog;
        };
        const fallback = await load(this.release!.defaultLocale);
        owner.signal.throwIfAborted();
        // 仅未声明目录才回退；已声明目录下载失败必须向上传递。
        const current = locale === fallback.locale || !has(definition.catalogs, locale) ? fallback : await load(locale);
        owner.signal.throwIfAborted();
        if (current !== fallback && !this.compatibleCatalogs.get(current)?.has(fallback)) {
            compatible(current, fallback);
            let checked = this.compatibleCatalogs.get(current);
            if (!checked) this.compatibleCatalogs.set(current, (checked = new WeakSet()));
            checked.add(fallback);
        }
        return new LocaleReader(locale, current, fallback);
    }
    private track(work: Promise<unknown>): void {
        const observed = work.then(
            () => {},
            () => {},
        );
        if (!this.scope.signal.aborted) void this.scope.track(observed, 'i18n.work');
    }
    /** @internal */
    retire(scope: Scope): void {
        this.track(this.cleanup([scope]));
    }
    private async cleanup(scopes: readonly Scope[]): Promise<void> {
        for (const result of await Promise.allSettled(scopes.map((scope) => scope.close())))
            if (result.status === 'rejected')
                reportError(
                    new FrameworkError('I18N_PREVIOUS_CLEANUP_FAILED', '多语言资源回收异常', { error: result.reason }),
                );
    }
}
