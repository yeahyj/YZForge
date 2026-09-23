// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Label, Button } from 'cc';
import { GameComponent } from '../../../../../../framework/core/game-component';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('showcase.ComponentTabPartBinding')
export class ComponentTabPartBinding extends GameComponent {
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblTitle: Label | null = null;
    /**
     * 自动绑定节点 lbl_title 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失，需检查命名、组件和绑定结果。
     */
    protected get lblTitle(): Label {
        return this.requireBinding(this._bindLblTitle, 'lbl_title');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblCount: Label | null = null;
    /**
     * 自动绑定节点 lbl_count 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失，需检查命名、组件和绑定结果。
     */
    protected get lblCount(): Label {
        return this.requireBinding(this._bindLblCount, 'lbl_count');
    }
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Button, visible: false })
    private _bindBtnIncrement: Button | null = null;
    /**
     * 自动绑定节点 btn_increment 的 Button；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失，需检查命名、组件和绑定结果。
     */
    protected get btnIncrement(): Button {
        return this.requireBinding(this._bindBtnIncrement, 'btn_increment');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.lblTitle;
        void this.lblCount;
        void this.btnIncrement;
    }
}
