import { Component, isValid, js, Label, Sprite } from 'cc';
import { MarqueeLabel } from '../components/marquee/marquee-label';
import type { CountdownLabel } from '../components/countdown/countdown-label';
import type { ScopedAssets } from '../../assets/asset-manager';
import type { AssetKind, BundleRef } from '../../assets/asset-types';
import { invariant, reportError } from '../../core/errors';
import type { Lifetime } from '../../core/scope';
import {
    Localization,
    LocaleHandle,
    LocaleReader,
    type LocaleBinding,
    type TextArguments,
    type LocalizedAssetKey,
    type TextKey,
    type TextParameters,
} from '../../localization/localization';

export interface LocalizedBinding {
    refresh(): void;
    dispose(): void;
}
export interface LocalizedTextBinding<P extends string> extends LocalizedBinding {
    /** 参数变更立即刷新已显示的文字，切换提交也会读取最新值。 */
    update(values: Readonly<Record<P, string | number>>): void;
}
type Parameters<P extends string> =
    Readonly<Record<P, string | number>> | ((reader: LocaleReader) => Readonly<Record<P, string | number>>);
type Slot = { dispose(): void };
type TextTarget = Label | MarqueeLabel;
type CountdownToken = 'hh' | 'mm' | 'ss' | 'seconds';
const texts = new WeakMap<TextTarget, Slot>();
const sprites = new WeakMap<Sprite, Slot>();
function instanceOf(target: Component, name: string): boolean {
    const type = js.getClassByName(name);
    return !!type && target instanceof type;
}

/** show/activation/列表项期限内的入口；in 可用于独立的实例借用期限。 */
export class ScopedLocalization {
    constructor(
        private readonly manager: Localization,
        private readonly assets: ScopedAssets,
        private readonly owner: Lifetime,
        private readonly current: () => boolean = () => true,
    ) {}
    get locale(): string | undefined {
        return this.manager.locale;
    }
    get locales(): readonly string[] {
        return this.manager.locales;
    }
    in(owner: Lifetime): ScopedLocalization {
        return new ScopedLocalization(this.manager, this.assets.in(owner), owner, this.current);
    }
    async use(bundle: BundleRef): Promise<LocalizedBundle> {
        const handle = await this.manager.use(bundle, this.owner);
        return new LocalizedBundle(handle, this.assets, this.current);
    }
    /** 供原生组件解析保存的业务包命名空间。 */
    useNamespace(namespace: string): Promise<LocalizedBundle> {
        return this.use(this.manager.bundle(namespace));
    }
    /** 原生组件使用源预制体/场景的业务包，而非调用方模块。 */
    sourceNamespace(source: string): string {
        return this.manager.sourceNamespace(source);
    }
    setLocale(locale: string): Promise<void> {
        return this.manager.setLocale(locale, this.owner);
    }
}
/** 一份已经准备好的业务语言目录，UI 绑定与资源持有均跟随使用期限。 */
export class LocalizedBundle {
    constructor(
        private readonly handle: LocaleHandle,
        private readonly assets: ScopedAssets,
        private readonly current: () => boolean,
    ) {}
    get locale(): string {
        return this.handle.locale;
    }
    textKey(name: string): TextKey<string> {
        return this.handle.reader.textKey(name);
    }
    assetKey<K extends AssetKind>(name: string, type: K): LocalizedAssetKey<K> {
        return this.handle.reader.assetKey(name, type);
    }
    t<P extends string>(key: TextKey<P>, ...args: TextArguments<NoInfer<P>>): string {
        return this.handle.reader.text(key, args[0]).text;
    }
    asset<K extends AssetKind>(key: LocalizedAssetKey<K>) {
        return this.handle.asset(key);
    }
    async bindText<P extends string>(
        target: TextTarget,
        key: TextKey<P>,
        ...args: [P] extends [never] ? [values?: Parameters<P>] : [values: Parameters<NoInfer<P>>]
    ): Promise<LocalizedTextBinding<P>> {
        invariant(isValid(target, true), 'I18N_TARGET_INVALID', '文字组件已销毁');
        invariant(
            !instanceOf(target, 'yzforge.CountdownLabel'),
            'I18N_TARGET_CONFLICT',
            '倒计时请使用 bindCountdownFormat',
        );
        invariant(
            !(
                target instanceof Label &&
                (target.node.getComponent(MarqueeLabel) || target.node.parent?.getComponent(MarqueeLabel))
            ),
            'I18N_TARGET_CONFLICT',
            '滚动文字请绑定 MarqueeLabel 公开组件，不要绑定内部 Label',
        );
        return this.bindTextTarget(target, key, args[0]);
    }
    /** 只绑定计时显示模板，不重启计时。hh/mm/ss/seconds 由倒计时填入；其他参数可传回调。 */
    async bindCountdownFormat<P extends string>(
        target: CountdownLabel,
        key: TextKey<P>,
        ...args: [Exclude<P, CountdownToken>] extends [never]
            ? [values?: Parameters<Exclude<P, CountdownToken>>]
            : [values: Parameters<Exclude<NoInfer<P>, CountdownToken>>]
    ): Promise<LocalizedBinding> {
        invariant(isValid(target, true), 'I18N_TARGET_INVALID', '倒计时组件已销毁');
        invariant(instanceOf(target, 'yzforge.CountdownLabel'), 'I18N_TARGET_INVALID', '目标必须是 CountdownLabel');
        const values = args[0];
        return this.bindTextTarget(
            target,
            key,
            (reader) =>
                ({
                    ...(typeof values === 'function' ? values(reader) : values),
                    hh: '{hh}',
                    mm: '{mm}',
                    ss: '{ss}',
                    seconds: '{seconds}',
                }) as Readonly<Record<P, string | number>>,
            true,
        );
    }
    private async bindTextTarget<P extends string>(
        target: TextTarget,
        key: TextKey<P>,
        values: Parameters<P> | undefined,
        format = false,
    ): Promise<LocalizedTextBinding<P>> {
        invariant(isValid(target, true), 'I18N_TARGET_INVALID', '文字组件已销毁');
        const countdown = format ? (target as CountdownLabel) : undefined;
        const read = () => ({
            text: countdown ? countdown.textFormat : target.string,
            font: target.font,
            system: target instanceof Label ? target.useSystemFont : !target.font,
        });
        const write = (state: ReturnType<typeof read>) => {
            target.font = state.font;
            if (target instanceof Label) target.useSystemFont = state.system;
            if (countdown) countdown.setTextFormat(state.text);
            else target.string = state.text;
            if (target instanceof MarqueeLabel) target.refresh();
        };
        const get = (reader: LocaleReader): TextParameters =>
            typeof values === 'function' ? values(reader) : (values ?? {});
        texts.get(target)?.dispose();
        const original = read();
        const releaseFormat = countdown?.retainTextFormat();
        const binding = await this.bind(
            target,
            texts,
            () => {
                releaseFormat?.();
                write(original);
            },
            async (reader, owner) => {
                const resolved = reader.text(key, get(reader));
                const font = resolved.font ? await this.assets.in(owner).load(resolved.font) : original.font;
                let text = resolved.text;
                return {
                    validate: () => {
                        text = reader.text(key, get(reader)).text;
                    },
                    commit: () => {
                        const before = read();
                        write({ text, font, system: resolved.font ? false : original.system });
                        return () => {
                            if (isValid(target, true)) write(before);
                        };
                    },
                };
            },
        ).catch((error: unknown) => {
            releaseFormat?.();
            throw error;
        });
        return {
            ...binding,
            update: (next) => {
                const previous = values;
                values = next;
                try {
                    binding.refresh();
                } catch (error) {
                    values = previous;
                    throw error;
                }
            },
        };
    }
    async bindSprite(target: Sprite, key: LocalizedAssetKey<'SpriteFrame'>): Promise<LocalizedBinding> {
        invariant(isValid(target, true), 'I18N_TARGET_INVALID', 'Sprite 已销毁');
        invariant(
            !instanceOf(target, 'yzforge.AsyncSprite'),
            'I18N_TARGET_CONFLICT',
            '语言图片请使用 Sprite；AsyncSprite 自行管理图片加载',
        );
        sprites.get(target)?.dispose();
        const original = target.spriteFrame;
        return this.bind(
            target,
            sprites,
            () => {
                target.spriteFrame = original;
            },
            async (reader, owner) => {
                const frame = await this.assets.in(owner).load(reader.asset(key));
                return {
                    validate: () => {},
                    commit: () => {
                        const previous = target.spriteFrame;
                        target.spriteFrame = frame;
                        return () => {
                            if (isValid(target, true)) target.spriteFrame = previous;
                        };
                    },
                };
            },
        );
    }
    private async bind<T extends Component>(
        target: T,
        slots: WeakMap<T, Slot>,
        restore: () => void,
        prepare: LocaleBinding['prepare'],
    ): Promise<LocalizedBinding> {
        const scope = this.handle.scope.child('ui-binding');
        let live = true;
        let bound: LocalizedBinding | undefined;
        const slot: Slot = {
            dispose: () => {
                if (!live) return;
                live = false;
                if (slots.get(target) === slot) {
                    slots.delete(target);
                    if (isValid(target, true)) restore();
                }
                bound?.dispose();
                void scope.close().catch(reportError);
            },
        };
        slots.set(target, slot);
        scope.defer(scope.signal.onAbort(slot.dispose));
        const active = () => live && this.current() && isValid(target, true) && slots.get(target) === slot;
        try {
            bound = await this.handle.bind({ active, prepare }, scope.lifetime);
            return { refresh: () => bound?.refresh(), dispose: slot.dispose };
        } catch (error) {
            slot.dispose();
            throw error;
        }
    }
}
