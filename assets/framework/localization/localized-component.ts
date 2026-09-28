import { _decorator, Component, type Asset, isValid, UIRenderer, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { runTask } from '../core/scope';
import { ComponentScope, type ComponentContext } from '../ui/components/component-scope';
const { ccclass, property } = _decorator;

/** @internal 原生多语言绑定。编辑器中的内容更新由工作台负责。 */
@ccclass('yzforge.LocalizedComponent')
export class LocalizedComponent extends Component {
    /** 空串自动解析源资源归属；旧字段继续兼容显式跨包引用。 */
    @property({ visible: false })
    namespace = '';
    @property({ visible: false })
    key = '';
    @property({ displayName: '语言键', tooltip: '当前预制体所属业务包的语言键，例如 example.welcome。' })
    get languageKey(): string {
        return this.key;
    }
    set languageKey(value: string) {
        this.key = value;
    }
    @property({ displayName: '跨包引用', tooltip: '普通预制体自动识别所属业务包；仅引用其他包的词条时开启。' })
    get crossBundle(): boolean {
        return this.editOverride || !!this.namespace;
    }
    set crossBundle(value: boolean) {
        this.editOverride = value;
        if (!value) this.namespace = '';
    }
    @property({
        displayName: '词条来源',
        tooltip: '其他业务包，例如 common/default。',
        visible(this: LocalizedComponent) {
            return this.crossBundle;
        },
    })
    get sourceOverride(): string {
        return this.namespace;
    }
    set sourceOverride(value: string) {
        this.namespace = value.trim();
    }
    protected readonly lifetime = new ComponentScope(this, (context) => {
        if (!context.i18n || !this.key) return;
        this.hideRenderer();
        context.scope.signal.onAbort(() => this.hideRenderer());
        // 交给组件就绪屏障；页面显示前等待首份语言内容，失败向打开方传播。
        return runTask(context.scope, async () => {
            await this.localize(context);
            context.scope.signal.throwIfAborted();
            if (this.lifetime.context === context) this.showRenderer();
        });
    });
    private rendererState?: { renderer: UIRenderer; enabled: boolean };
    private editOverride = false;
    protected async localize(_context: ComponentContext): Promise<void> {}
    protected resolveNamespace(context: ComponentContext): string {
        return this.namespace || context.i18n!.sourceNamespace(this.sourceAsset());
    }
    /** 最近的源预制体优先，普通场景使用 Scene UUID，不采用调用方模块。 */
    private sourceAsset(): string {
        for (let node: Node | null = this.node; node; node = node.parent) {
            // Creator 3.8 的运行时保留此信息，但公开声明未导出 prefab getter。
            const source = (node as Node & { readonly prefab?: { readonly asset?: Asset } }).prefab?.asset?.uuid;
            if (source) return source;
        }
        return this.node.scene?.uuid ?? '';
    }
    private hideRenderer(): void {
        if (!this.key) return;
        const renderer = this.rendererState?.renderer ?? this.getComponent(UIRenderer);
        if (!renderer || !isValid(renderer, true)) return;
        this.rendererState ??= { renderer, enabled: renderer.enabled };
        renderer.enabled = false;
    }
    private showRenderer(): void {
        const state = this.rendererState;
        if (state && isValid(state.renderer, true)) state.renderer.enabled = state.enabled;
    }
    /** @internal 框架注入宿主后才准备语言资源。 */
    onEnable(): void {
        if (!EDITOR) {
            this.hideRenderer();
            this.lifetime.enable();
        }
    }
    /** @internal 停用取消加载和绑定。 */
    onDisable(): void {
        this.lifetime.disable();
        this.showRenderer();
        this.rendererState = undefined;
    }
    /** @internal 销毁归还运行时资源。 */
    onDestroy(): void {
        this.lifetime.destroy();
        this.showRenderer();
        this.rendererState = undefined;
    }
}
