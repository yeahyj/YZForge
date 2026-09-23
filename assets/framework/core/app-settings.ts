import { _decorator, Component } from 'cc';
import type { GameConfig } from '../platform/game-config';

/** 启动配置组件基类；不参与业务组件绑定，也不自行执行引擎生命周期。 */
@_decorator.ccclass('yzforge.AppSettings')
export class AppSettings extends Component {
    /** 由项目启动配置组件返回生成快照；框架不引用项目的生成文件。 */
    resolve(): GameConfig {
        throw Error('Provide the generated game configuration in the project settings component');
    }
}
