import type { AssetKey, AssetKind } from '../assets/asset-types';
import { untilCancelled } from '../core/cancellation';
import { FrameworkError, invariant, reportError } from '../core/errors';
import { runTask, Scope, type Lifetime } from '../core/scope';

/** 语言目录指向现有资源包中的 JSON；不会静态引用或提前加载图片、字体、音频。 */
export interface LocalizationOptions {
    readonly defaultLocale: string;
    readonly catalogs: Readonly<Record<string, AssetKey<'JsonAsset'>>>;
}
export type TextParameters = Readonly<Record<string, string | number>>;
export interface LocaleCatalog {
    readonly formatVersion: 1;
    readonly locale: string;
    readonly texts: Readonly<Record<string, string>>;
    readonly assets?: Readonly<Record<string, AssetKey>>;
}
type Snapshot = { locale: string; catalog: LocaleCatalog; scope: Scope };
type Listener = { active: boolean; owner: Lifetime; callback: (locale: string) => void; off(): void };
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const kinds: readonly string[] = [
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
const parameterPattern = /\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g;
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
/** 校验外部语言目录并复制冻结；同一文件中的资源只是逻辑 Key，不在此加载。 */
export function parseLocaleCatalog(input: unknown, locale: string): LocaleCatalog {
    invariant(
        object(input) && input.formatVersion === 1 && input.locale === locale && object(input.texts),
        'I18N_CATALOG_INVALID',
        `语言目录格式或语言标识不匹配：${locale}`,
    );
    const texts: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(input.texts)) {
        invariant(
            key.length > 0 && typeof value === 'string',
            'I18N_TEXT_INVALID',
            `文案必须为字符串：${locale}/${key}`,
        );
        texts[key] = value;
    }
    invariant(input.assets === undefined || object(input.assets), 'I18N_ASSETS_INVALID', locale);
    const assets: Record<string, AssetKey> = Object.create(null) as Record<string, AssetKey>;
    for (const [key, value] of Object.entries(input.assets ?? {})) {
        invariant(
            key.length > 0 &&
                object(value) &&
                typeof value.id === 'string' &&
                value.id.length > 0 &&
                typeof value.type === 'string' &&
                kinds.includes(value.type),
            'I18N_ASSET_INVALID',
            `资源 Key 无效：${locale}/${key}`,
        );
        assets[key] = Object.freeze({ id: value.id, type: value.type as AssetKind });
    }
    return Object.freeze({ formatVersion: 1, locale, texts: Object.freeze(texts), assets: Object.freeze(assets) });
}
function parameters(text: string): string {
    const names = new Set<string>();
    text.replace(parameterPattern, (token, name: string | undefined) => {
        if (name) names.add(name);
        return token;
    });
    return Array.from(names).sort().join(',');
}
function compatible(catalog: LocaleCatalog, fallback: LocaleCatalog): void {
    for (const [key, value] of Object.entries(catalog.texts))
        if (has(fallback.texts, key))
            invariant(
                parameters(value) === parameters(fallback.texts[key]),
                'I18N_PARAMETERS_MISMATCH',
                `翻译参数与默认语言不一致：${catalog.locale}/${key}`,
            );
    for (const [key, value] of Object.entries(catalog.assets ?? {}))
        if (has(fallback.assets ?? {}, key))
            invariant(
                value.type === fallback.assets![key].type,
                'I18N_ASSET_TYPE',
                `翻译资源类型与默认语言不一致：${catalog.locale}/${key}`,
            );
}

/**
 * 按需加载语言 JSON，文本查询同步，切换采用最新请求并在完整加载后提交。
 * 当前语言缺少条目时回退默认语言；图片等通过资源 Key 交给原有资源生命周期管理。
 */
export class Localization {
    private readonly scope: Scope;
    private readonly options?: LocalizationOptions;
    private readonly listeners = new Set<Listener>();
    private current?: Snapshot;
    private fallback?: LocaleCatalog;
    private fallbackLoading?: Promise<LocaleCatalog>;
    private pending?: Scope;
    private initialization?: Promise<void>;
    /**
     * App 注入 assets.load；独立测试可注入纯 JSON 加载器。
     * 不配置时不加载语言资源；首次配置由 AppOptions.localization 提供。
     */
    constructor(
        owner: Lifetime,
        private readonly load: (key: AssetKey<'JsonAsset'>, owner: Lifetime) => Promise<unknown>,
        options?: LocalizationOptions,
    ) {
        if (options) {
            invariant(
                typeof options.defaultLocale === 'string' &&
                    object(options.catalogs) &&
                    has(options.catalogs, options.defaultLocale),
                'I18N_OPTIONS_INVALID',
                '默认语言必须登记目录',
            );
            const catalogs: Record<string, AssetKey<'JsonAsset'>> = Object.create(null) as Record<
                string,
                AssetKey<'JsonAsset'>
            >;
            for (const [locale, key] of Object.entries(options.catalogs)) {
                invariant(
                    /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(locale) &&
                        key?.type === 'JsonAsset' &&
                        typeof key.id === 'string' &&
                        key.id.length > 0,
                    'I18N_OPTIONS_INVALID',
                    `语言或目录 Key 无效：${locale}`,
                );
                catalogs[locale] = Object.freeze({ id: key.id, type: 'JsonAsset' });
            }
            this.options = Object.freeze({ defaultLocale: options.defaultLocale, catalogs: Object.freeze(catalogs) });
        }
        this.scope = owner.child('localization');
        this.scope.signal.onAbort(() => {
            for (const listener of Array.from(this.listeners)) listener.off();
        });
        this.scope.defer(() => {
            this.current = undefined;
            this.fallback = undefined;
            this.fallbackLoading = undefined;
        });
    }
    /** 当前已成功提交的语言；尚未初始化时为 undefined。 */
    get locale(): string | undefined {
        return this.current?.locale;
    }
    /** 已登记语言的稳定快照。 */
    get locales(): readonly string[] {
        return Object.freeze(Object.keys(this.options?.catalogs ?? {}));
    }
    /** App 创建期间加载默认语言；无配置时不执行，失败可重新调用。 */
    initialize(): Promise<void> {
        if (!this.options || this.current) return Promise.resolve();
        return (this.initialization ??= this.setLocale(this.options.defaultLocale, this.scope.lifetime).finally(() => {
            this.initialization = undefined;
        }));
    }
    /**
     * 加载并切换语言。未提交的连续请求只接受最后一次；提交前取消/失败保留现有语言。
     * 提交后旧目录的清理异常单独上报，不撤销成功结果；返回仍等待清理结束。
     * owner 只管理本次切换，成功后的语言由应用持有；不自动写存档或读取设备语言。
     */
    setLocale(locale: string, owner: Lifetime): Promise<void> {
        this.scope.signal.throwIfAborted();
        owner.signal.throwIfAborted();
        invariant(this.options && has(this.options.catalogs, locale), 'I18N_LOCALE_UNKNOWN', `语言未登记：${locale}`);
        this.pending?.cancel();
        this.pending = undefined;
        if (this.current?.locale === locale) return Promise.resolve();
        const scope = this.scope.child(`locale:${locale}`);
        this.pending = scope;
        const detach = owner.signal.onAbort(() => scope.cancel());
        let committed = false,
            failureCleanup = false;
        const job = runTask(
            this.scope,
            async () => {
                scope.signal.throwIfAborted();
                const fallback = await untilCancelled(this.defaultCatalog(), scope.signal);
                const catalog =
                    locale === this.options!.defaultLocale
                        ? fallback
                        : parseLocaleCatalog(await this.load(this.options!.catalogs[locale], scope.lifetime), locale);
                scope.signal.throwIfAborted();
                compatible(catalog, fallback);
                const previous = this.current;
                this.current = { locale, catalog, scope };
                committed = true;
                this.pending = undefined;
                detach();
                for (const listener of Array.from(this.listeners)) {
                    if (this.current.scope !== scope || this.scope.signal.aborted) break;
                    if (listener.active && !listener.owner.signal.aborted) {
                        try {
                            this.notify(listener, locale);
                        } catch (error) {
                            reportError(error);
                        }
                    }
                }
                try {
                    await previous?.scope.close();
                } catch (error) {
                    // 新语言已经提交并通知，旧目录的回收异常不能再冒充切换失败。
                    reportError(
                        new FrameworkError('I18N_PREVIOUS_CLEANUP_FAILED', '语言已切换，旧目录回收异常', {
                            locale,
                            previousLocale: previous?.locale,
                            error,
                        }),
                    );
                }
            },
            undefined,
            'i18n.switch',
        );
        const completed = job
            .catch(async (error) => {
                failureCleanup = true;
                if (!committed) {
                    scope.cancel();
                    try {
                        await scope.close();
                    } catch (cleanup) {
                        throw new FrameworkError('I18N_CLEANUP_FAILED', '语言切换失败且回收异常', { error, cleanup });
                    }
                }
                throw error;
            })
            .finally(() => {
                detach();
                if (this.pending === scope) this.pending = undefined;
            });
        // 即使调用者立即取消，应用关闭仍等候底层加载及其资源回收。
        void this.scope.track(
            completed.then(
                () => {},
                () => {},
            ),
            'i18n.cleanup',
        );
        return untilCancelled(completed, scope.signal).catch((error) => {
            // 提交之后不再撤销成功结果；提交前的外部取消仍及时返回。
            // 失败后的内部取消也不能掩盖原始目录错误。
            if (committed || failureCleanup) return completed;
            throw error;
        });
    }
    /** 同步取文案，缺失时返回 Key；支持 {name} 参数，{{ 和 }} 表示字面大括号。 */
    t(key: string, values: TextParameters = {}): string {
        const current = this.ready();
        const text = has(current.texts, key) ? current.texts[key] : this.fallback!.texts[key];
        if (text === undefined) return key;
        return text.replace(parameterPattern, (token, name: string | undefined) => {
            if (!name) return token === '{{' ? '{' : '}';
            const value = has(values, name) ? values[name] : undefined;
            invariant(
                typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)),
                'I18N_PARAMETER_MISSING',
                `文案参数缺失或无效：${key}/${name}`,
            );
            return String(value);
        });
    }
    /** 判断当前语言或默认语言是否包含文案；空字符串也视为有效翻译。 */
    has(key: string): boolean {
        const current = this.ready();
        return has(current.texts, key) || has(this.fallback!.texts, key);
    }
    /** 返回当前语言或默认语言中的资源 Key；资源本身由 show.assets 等实际使用者加载。 */
    asset<K extends AssetKind>(name: string, type: K): AssetKey<K> {
        const current = this.ready();
        const key = has(current.assets ?? {}, name) ? current.assets![name] : this.fallback!.assets?.[name];
        invariant(key, 'I18N_ASSET_MISSING', `语言资源未登记：${name}`);
        invariant(key.type === type, 'I18N_ASSET_TYPE', `语言资源类型不匹配：${name}/${type}`);
        return key as AssetKey<K>;
    }
    /** 立即通知当前语言，之后只在成功切换时通知；随 owner 或应用结束自动解绑。 */
    subscribe(callback: (locale: string) => void, owner: Lifetime): () => void {
        this.scope.signal.throwIfAborted();
        owner.signal.throwIfAborted();
        let detach = () => {};
        const listener: Listener = {
            callback,
            owner,
            active: true,
            off: () => {
                if (!listener.active) return;
                listener.active = false;
                this.listeners.delete(listener);
                detach();
            },
        };
        this.listeners.add(listener);
        detach = owner.signal.onAbort(listener.off);
        try {
            if (this.current) this.notify(listener, this.current.locale);
        } catch (error) {
            listener.off();
            throw error;
        }
        return listener.off;
    }
    private notify(listener: Listener, locale: string): void {
        const result: unknown = listener.callback(locale);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            void Promise.resolve(result).catch(reportError);
            throw new FrameworkError('I18N_LISTENER_ASYNC', '语言订阅须同步；异步资源更新请登记到 show.run/actions');
        }
    }
    private ready(): LocaleCatalog {
        this.scope.signal.throwIfAborted();
        invariant(this.current && this.fallback, 'I18N_NOT_READY', '请配置并初始化多语言后查询');
        return this.current.catalog;
    }
    private defaultCatalog(): Promise<LocaleCatalog> {
        if (this.fallbackLoading) return this.fallbackLoading;
        const scope = this.scope.child('default-locale');
        const locale = this.options!.defaultLocale;
        const work = runTask(
            this.scope,
            async () => {
                const catalog = parseLocaleCatalog(
                    await this.load(this.options!.catalogs[locale], scope.lifetime),
                    locale,
                );
                scope.signal.throwIfAborted();
                this.fallback = catalog;
                return catalog;
            },
            undefined,
            'i18n.default',
        );
        this.fallbackLoading = work.catch(async (error) => {
            this.fallbackLoading = undefined;
            await scope.close();
            throw error;
        });
        return this.fallbackLoading;
    }
}
