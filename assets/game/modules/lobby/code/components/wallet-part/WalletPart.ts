import { _decorator } from 'cc';
import { WalletPartBinding } from './generated/WalletPartBinding';
const { ccclass } = _decorator;
/** 通用渲染部件：父页面传入余额；自身不查找 Service，也不处理奖励业务。 */
@ccclass('lobby.WalletPart')
export class WalletPart extends WalletPartBinding {
    /** 同步渲染父对象提供的展示数据，自动绑定 lbl_balance，无需手动拖拽。 */
    render(coins: number): void {
        this.lblBalance.string = `共享账号服务 · 当前余额 ${coins} 金币`;
    }
}
