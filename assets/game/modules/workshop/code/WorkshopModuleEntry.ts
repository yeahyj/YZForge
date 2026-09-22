import { _decorator } from 'cc';
import { ModuleEntry } from '../../../../framework/modules/module-entry';
import { createWorkshopModule } from './WorkshopModule';
const { ccclass } = _decorator;
/** @internal 本地按需代码包入口；加载器读取工厂，业务不使用引擎生命周期启动模块。 */
@ccclass('workshop.WorkshopModuleEntry')
export class WorkshopModuleEntry extends ModuleEntry {
    /** @internal 与 module.json 对应的模块 ID。 */
    get moduleId(): string {
        return 'workshop';
    }
    /** @internal 返回工厂函数，读取此属性不会执行业务初始化。 */
    get factory() {
        return createWorkshopModule;
    }
}
