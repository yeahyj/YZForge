// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator, Label } from 'cc';
import { GameComponent } from '../../../../../../framework/core/game-component';
const { ccclass, property } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('lobby.WalletPartBinding')
export class WalletPartBinding extends GameComponent {
    /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
    @property({ type: Label, visible: false })
    private _bindLblBalance: Label | null = null;
    /**
     * 自动绑定节点 lbl_balance 的 Label；节点改名或增删后通过工作台更新绑定。
     * @throws FrameworkError 引用缺失，需检查命名、组件和绑定结果。
     */
    protected get lblBalance(): Label {
        return this.requireBinding(this._bindLblBalance, 'lbl_balance');
    }
    /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
    protected validateBindings(): void {
        void this.lblBalance;
    }
}
