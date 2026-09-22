import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { LabParams } from '../../contracts/demo-navigation';
import { StorageLab, LabWallet } from '../services/StorageLab';
import { StorageLabPageBinding } from './generated/StorageLabPageBinding';
const { ccclass } = _decorator;
/** 存档故障只作用于独立内存后端；任务奖励页另行展示平台真实持久化。 */
@ccclass('showcase.StorageLabPage')
export class StorageLabPage extends StorageLabPageBinding {
    protected onShow(show: ViewShowContext<LabParams, void>): void {
        const lab = new StorageLab();
        const output = (text: string) =>
            show.commit(() => {
                this.lblOutput.string = '独立内存实验 · 不修改账号存档\n' + text;
            });
        const bind = (button: Button, work: () => string) =>
            show.listen(
                button.node,
                Button.EventType.CLICK,
                () => {
                    output(work());
                },
                (error) => output(String(error)),
            );
        show.listen(this.btnBack.node, Button.EventType.CLICK, () => show.back());
        bind(this.btnSave, () => {
            const value = lab.storage.get(LabWallet)?.coins ?? 0;
            lab.storage.set(LabWallet, { coins: value + 10 });
            return `已保存 ${value + 10} 金币；再次保存会备份上次有效记录。`;
        });
        bind(this.btnRead, () => JSON.stringify(lab.storage.read(LabWallet)));
        bind(this.btnAccount, () => {
            lab.storage.in('A').set(LabWallet, { coins: 1 });
            lab.storage.in('B').set(LabWallet, { coins: 9 });
            return `账号 A：${lab.storage.in('A').get(LabWallet)?.coins}\n账号 B：${lab.storage.in('B').get(LabWallet)?.coins}\n相同 Key，不同 namespace，互不覆盖。`;
        });
        bind(this.btnBackup, () => lab.corrupt());
        bind(this.btnFailure, () => lab.failWrite());
        bind(this.btnVersion, () => lab.upgrade());
        bind(this.btnFuture, () => lab.future());
        bind(this.btnReset, () => {
            lab.reset();
            return '已清空本页实验，可以重新开始。';
        });
        output(
            '保存 / 读取 / 账号隔离 / 备份恢复\n写入失败 / 存档版本升级 / 高版本保护\n任务奖励页的真实存档会跨页面与重启保留。',
        );
    }
}
