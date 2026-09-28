import { _decorator, Component, assetManager, Asset, isValid, SpriteFrame } from 'cc';
import { EDITOR } from 'cc/env';
import { OperationCancelled, reportError } from '../core/errors';
import { runTask } from '../core/scope';
import { ComponentScope, type ComponentContext } from '../ui/components/component-scope';
const { ccclass, property, executeInEditMode } = _decorator;
type EditorBridge = {
    Message: {
        request(
            extension: string,
            method: string,
            action: string,
            args: unknown,
        ): Promise<{ text?: string; uuid?: string; locale: string }>;
    };
};

/** @internal 原生声明组件共用生命周期和只读检查器预览，预览资源不写入场景或预制体。 */
@ccclass('yzforge.LocalizedComponent')
@executeInEditMode
export class LocalizedComponent extends Component {
    @property({ displayName: '业务资源包', tooltip: '业务命名空间，例如 showcase/default；不填具体语言包。' })
    namespace = '';
    @property({ displayName: '语言键', tooltip: '多语言工作簿中的 key，例如 example.welcome。' })
    key = '';
    @property({
        displayName: '预览语言',
        serializable: false,
        tooltip: '只影响检查器只读预览；例如 zh-CN、en。留空使用默认语言。',
    })
    previewLocale = '';
    @property({
        displayName: '更新预览',
        tooltip: '修改语言键或预览语言后勾选，结果显示在下面，不修改原 Label / Sprite。',
    })
    get refreshPreview(): boolean {
        return false;
    }
    set refreshPreview(value: boolean) {
        if (value && EDITOR) void this.updatePreview();
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
        if (!context.i18n || !this.namespace || !this.key) return;
        void runTask(context.scope, () => this.localize(context)).catch((error) => {
            if (!(error instanceof OperationCancelled)) reportError(error);
        });
    });
    private previewVersion = 0;
    private previewAsset?: Asset;
    protected previewKind(): 'text' | 'sprite' {
        return 'text';
    }
    protected previewParameters(): Record<string, string> {
        return {};
    }
    protected async localize(_context: ComponentContext): Promise<void> {}
    /** @internal 框架注入宿主后才准备语言资源；编辑器预览独立于运行时。 */
    onEnable(): void {
        if (!EDITOR) this.lifetime.enable();
    }
    /** @internal 停用取消加载和绑定。 */
    onDisable(): void {
        this.lifetime.disable();
        this.clearPreview();
    }
    /** @internal 销毁归还预览与运行时资源。 */
    onDestroy(): void {
        this.lifetime.destroy();
        this.clearPreview();
    }
    onFocusInEditor(): void {
        if (EDITOR && this.namespace && this.key) void this.updatePreview();
    }
    onLostFocusInEditor(): void {
        this.clearPreview();
    }
    private clearPreview(): void {
        this.previewVersion++;
        this.previewImage = null;
        this.previewAsset?.decRef();
        this.previewAsset = undefined;
    }
    private async updatePreview(): Promise<void> {
        if (!EDITOR) return;
        this.clearPreview();
        const version = this.previewVersion;
        try {
            const editor = (globalThis as unknown as { Editor?: EditorBridge }).Editor;
            if (!editor) throw Error('检查器预览只能在 Creator 编辑器中使用');
            const result = await editor.Message.request('yzforge-editor', 'dispatch', 'previewLocalizedBinding', {
                namespace: this.namespace,
                key: this.key,
                locale: this.previewLocale,
                kind: this.previewKind(),
                parameters: this.previewParameters(),
            });
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
            }
            this.previewText = `${result.locale} · ${result.text ?? this.key}`;
        } catch (error) {
            if (version === this.previewVersion && isValid(this, true))
                this.previewText = error instanceof Error ? error.message : String(error);
        }
    }
}
