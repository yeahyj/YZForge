import {
    _decorator,
    Component,
    assetManager,
    Asset,
    isValid,
    SpriteFrame,
    Enum,
    CCClass,
    UIRenderer,
    Node,
    Label,
    Sprite,
} from 'cc';
import { EDITOR } from 'cc/env';
import { runTask } from '../core/scope';
import { ComponentScope, type ComponentContext } from '../ui/components/component-scope';
import { previewLocalizedRenderer } from './editor-localization-preview';
const { ccclass, property, executeInEditMode } = _decorator;
const PreviewLanguages = Enum({ 项目默认: 0 });
let previewLocales: string[] = [];
type EditorBridge = {
    Message: {
        request(extension: string, method: string, action: string, args: unknown): Promise<unknown>;
    };
};

/** @internal 原生声明组件共用生命周期与画面预览，预览资源不写入场景或预制体。 */
@ccclass('yzforge.LocalizedComponent')
@executeInEditMode
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
        this.requestPreview();
    }
    @property({ displayName: '跨包引用', tooltip: '普通预制体自动识别所属业务包；仅引用其他包的词条时开启。' })
    get crossBundle(): boolean {
        return this.editOverride || !!this.namespace;
    }
    set crossBundle(value: boolean) {
        this.editOverride = value;
        if (!value) this.namespace = '';
        this.requestPreview();
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
        this.requestPreview();
    }
    @property({
        type: PreviewLanguages,
        displayName: '预览语言',
        tooltip: '选项来自项目支持语言；直接预览 Label/Sprite，保持节点尺寸，保存时保留原始属性。',
    })
    get previewLocale(): number {
        return this.previewLanguage ? previewLocales.indexOf(this.previewLanguage) + 1 : 0;
    }
    set previewLocale(value: number) {
        this.previewLanguage = previewLocales[value - 1] ?? '';
        this.requestPreview();
    }
    @property({ displayName: '预览结果', readonly: true, serializable: false, multiline: true })
    previewText = '';
    @property({
        type: SpriteFrame,
        displayName: '预览图片',
        readonly: true,
        serializable: false,
        visible(this: LocalizedComponent) {
            return this.previewKind() === 'sprite';
        },
    })
    previewImage: SpriteFrame | null = null;
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
    private editorFocused = false;
    private optionsVersion = 0;
    private previewLanguage = '';
    private signature = '';
    private previewVersion = 0;
    private previewAsset?: Asset;
    private restorePreview?: () => void;
    protected previewKind(): 'text' | 'sprite' {
        return 'text';
    }
    protected previewParameters(): Record<string, string> {
        return {};
    }
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
    /** @internal 框架注入宿主后才准备语言资源；编辑器预览独立于运行时。 */
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
        this.onLostFocusInEditor();
    }
    /** @internal 销毁归还预览与运行时资源。 */
    onDestroy(): void {
        this.lifetime.destroy();
        this.showRenderer();
        this.rendererState = undefined;
        this.onLostFocusInEditor();
    }
    onFocusInEditor(): void {
        if (!EDITOR) return;
        this.editorFocused = true;
        void this.configurePreview();
    }
    onLostFocusInEditor(): void {
        this.editorFocused = false;
        ++this.optionsVersion;
        this.clearPreview();
    }
    /** 固定参数的原生编辑和撤销也自动刷新；选中期间只比较字段，不轮询资源。 */
    update(): void {
        if (EDITOR && this.editorFocused && this.signature !== this.previewSignature()) this.requestPreview();
    }
    private previewSignature(): string {
        try {
            return JSON.stringify([this.namespace, this.key, this.previewLanguage, this.previewParameters()]);
        } catch (error) {
            return String(error);
        }
    }
    private editor(): EditorBridge {
        const editor = (globalThis as unknown as { Editor?: EditorBridge }).Editor;
        if (!editor) throw Error('检查器预览只能在 Creator 编辑器中使用');
        return editor;
    }
    private async configurePreview(): Promise<void> {
        const version = ++this.optionsVersion;
        try {
            const options = (await this.editor().Message.request(
                'yzforge-editor',
                'dispatch',
                'localizedBindingOptions',
                {},
            )) as { locales: string[]; defaultLocale: string };
            if (version !== this.optionsVersion || !isValid(this, true)) return;
            previewLocales = options.locales;
            if (!previewLocales.includes(this.previewLanguage)) this.previewLanguage = '';
            CCClass.Attr.setClassAttr(this.constructor, 'previewLocale', 'enumList', [
                { name: `项目默认（${options.defaultLocale}）`, value: 0 },
                ...previewLocales.map((locale, index) => ({ name: locale, value: index + 1 })),
            ]);
            await this.updatePreview();
        } catch (error) {
            if (version === this.optionsVersion && isValid(this, true)) this.previewText = String(error);
        }
    }
    private requestPreview(): void {
        if (EDITOR && this.editorFocused) void this.updatePreview();
    }
    private clearPreview(): void {
        this.previewVersion++;
        this.restorePreview?.();
        this.restorePreview = undefined;
        this.previewImage = null;
        this.previewAsset?.decRef();
        this.previewAsset = undefined;
    }
    private async updatePreview(): Promise<void> {
        if (!EDITOR) return;
        this.signature = this.previewSignature();
        this.clearPreview();
        const version = this.previewVersion;
        try {
            const result = (await this.editor().Message.request(
                'yzforge-editor',
                'dispatch',
                'previewLocalizedBinding',
                {
                    source: this.sourceAsset(),
                    namespace: this.namespace,
                    key: this.key,
                    locale: this.previewLanguage,
                    kind: this.previewKind(),
                    parameters: this.previewParameters(),
                },
            )) as { text?: string; uuid?: string; locale: string };
            if (version !== this.previewVersion || !isValid(this, true)) return;
            if (result.uuid) {
                const asset = await new Promise<Asset>((resolve, reject) =>
                    assetManager.loadAny(result.uuid!, (error: Error | null, value: Asset) =>
                        error ? reject(error) : resolve(value),
                    ),
                );
                asset.addRef();
                if (version !== this.previewVersion || !isValid(this, true)) {
                    asset.decRef();
                    return;
                }
                if (!(asset instanceof SpriteFrame)) {
                    asset.decRef();
                    throw Error('预览资源不是 SpriteFrame');
                }
                this.previewAsset = asset;
                this.previewImage = asset;
                const target = this.getComponent(Sprite);
                if (target) this.restorePreview = previewLocalizedRenderer(target, asset);
            } else if (this.key && result.text !== undefined) {
                const target = this.getComponent(Label);
                if (target) this.restorePreview = previewLocalizedRenderer(target, result.text);
            }
            this.previewText = `${result.locale} · ${result.text ?? this.key}`;
        } catch (error) {
            if (version === this.previewVersion && isValid(this, true)) {
                this.clearPreview();
                this.previewText = error instanceof Error ? error.message : String(error);
            }
        }
    }
}
