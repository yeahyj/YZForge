import { _decorator, isValid, Sprite, SpriteFrame } from 'cc';
import { EDITOR } from 'cc/env';
import type { ScopedAssets } from '../../../assets/asset-manager';
import type { AssetKey } from '../../../assets/asset-types';
import { invariant, reportError } from '../../../core/errors';
import { type Lifetime, type Scope, runTask } from '../../../core/scope';
import { OperationCancelled } from '../../../core/errors';
import { ComponentScope, type ComponentContext } from '../component-scope';
const { ccclass, property, disallowMultiple, menu } = _decorator;

/** 图片显示状态；旧请求不会覆盖较新的图片或状态。 */
export type AsyncSpriteState = 'empty' | 'loading' | 'ready' | 'error';
/** 一次图片绑定的操作入口。 */
export interface AsyncSpriteHandle {
    /** 加载并显示；传 null 清空。被替代或取消时拒绝，调用方须处理 Promise。 */
    set(key: AssetKey<'SpriteFrame'> | string | null): Promise<void>;
    /** 当前状态，只代表本次绑定。 */
    readonly state: AsyncSpriteState;
    /** 清空显示并归还资源；不关闭后来的绑定。 */
    dispose(): Promise<void>;
}
/** 原生 Sprite 的扩展；继承 spriteFrame、尺寸模式等属性，动态加载复用框架 Assets。 */
@ccclass('yzforge.AsyncSprite')
@menu('YZForge/UI/异步图片')
@disallowMultiple
export class AsyncSprite extends Sprite {
    private readonly lifetime = new ComponentScope(this, (context) => this.onAutomaticActivate(context));
    /** 填当前模块的逻辑资源名即可自动加载；留空保留 Sprite 原图。 */
    @property({
        displayName: '初始图片资源名',
        tooltip: '例如 icons/alpha/token；使用所属业务模块的默认资源包，也可填完整逻辑 ID。',
    })
    source = '';
    /** 加载期间显示的静态预制体引用；为空则暂不显示图片。 */
    @property({ type: SpriteFrame, displayName: '加载占位图' }) placeholder: SpriteFrame | null = null;
    /** 当前请求失败时显示的静态预制体引用；为空则清空。 */
    @property({ type: SpriteFrame, displayName: '加载失败图' }) failure: SpriteFrame | null = null;
    private onAutomaticActivate(activation: ComponentContext): void {
        if (this.source.trim() && activation.assets)
            void this.bind(activation.scope, activation.assets)
                .set(this.source)
                .catch((error) => {
                    if (!(error instanceof OperationCancelled)) reportError(error);
                });
    }
    /**
     * 按逻辑资源名换图，传 null 清空；框架 UI/Part 自动注入所属模块的 Assets。
     * 普通独立场景也可使用原生 spriteFrame；逻辑资源加载须 app.bindScene 或显式 bind。
     */
    setSource(key: AssetKey<'SpriteFrame'> | string | null): Promise<void> {
        if (key === null) return this.clear();
        const activation = this.lifetime.requireContext();
        invariant(
            activation.assets,
            'UI_COMPONENT_ASSETS',
            '逻辑资源加载需要所属业务模块，请通过框架实例化或 app.bindScene',
        );
        return this.bind(activation.scope, activation.assets).set(key);
    }
    /** 可直接接入 Button.clickEvents，自定义事件数据填写图片逻辑名称。 */
    loadFromEvent(_event: unknown, source: string): void {
        void this.setSource(source).catch((error) => {
            if (!(error instanceof OperationCancelled)) reportError(error);
        });
    }
    /**
     * 接管 Sprite.spriteFrame；结束时设为 null。支持在条目首次激活前 bind。
     * @param owner 图片实际显示期限，列表条目传 item.scope。
     * @param assets 当前业务的资源入口；每次请求创建独立的持有期限。
     */
    bind(owner: Lifetime, assets: ScopedAssets): AsyncSpriteHandle {
        let request: Scope | undefined,
            version = 0,
            state: AsyncSpriteState = 'empty';
        const scope = this.lifetime.begin(owner, 'async-sprite', () => {
            version++;
            if (isValid(this, true)) this.spriteFrame = null;
            state = 'empty';
        });
        this.spriteFrame = null;
        const set = async (key: AssetKey<'SpriteFrame'> | string | null) => {
            scope.signal.throwIfAborted();
            const currentVersion = ++version;
            if (request) void request.close().catch(reportError);
            request = undefined;
            this.spriteFrame = key === null ? null : this.placeholder;
            state = key === null ? 'empty' : 'loading';
            if (key === null) return;
            const held = (request = scope.child('image'));
            const current = () => this.lifetime.current(scope) && version === currentVersion;
            try {
                await runTask(
                    held,
                    async (task) => {
                        const scoped = assets.in(task.scope);
                        const frame =
                            typeof key === 'string' ? await scoped.load(key, 'SpriteFrame') : await scoped.load(key);
                        task.signal.throwIfAborted();
                        task.commit(() => {
                            this.spriteFrame = frame;
                            state = 'ready';
                        });
                    },
                    current,
                    'async-sprite:load',
                );
            } catch (error) {
                try {
                    await held.close();
                } finally {
                    if (current()) {
                        this.spriteFrame = this.failure;
                        state = 'error';
                    }
                }
                throw error;
            }
        };
        return Object.freeze({
            set,
            get state() {
                return state;
            },
            dispose: () => scope.close(),
        });
    }
    /** 清空图片并等待旧加载、资源归还；不改变初始资源名配置。 */
    clear(): Promise<void> {
        const pending = this.lifetime.clear();
        if (isValid(this, true)) this.spriteFrame = null;
        return pending;
    }
    /** @internal 保留原生 Sprite 渲染生命周期。 */
    onEnable(): void {
        super.onEnable();
        if (!EDITOR) this.lifetime.enable();
    }
    /** @internal 取消图片请求并归还资源。 */
    onDisable(): void {
        this.lifetime.disable();
        super.onDisable();
    }
    /** @internal 等待中的请求不能写入已销毁的 Sprite。 */
    onDestroy(): void {
        this.lifetime.destroy();
        super.onDestroy();
    }
}
