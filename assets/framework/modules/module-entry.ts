import { _decorator, Component, instantiate } from 'cc';
import { Assets, destroyNode } from '../assets/asset-manager';
import { invariant } from '../core/errors';
import { Scope } from '../core/scope';
import { ModuleDefinition, ModuleFactory } from './module-manager';
const { ccclass } = _decorator;
/**
 * @internal
 * 本地按需代码包的入口组件，由工作台生成。仅提供模块工厂，不通过引擎生命周期启动业务。
 */
@ccclass('yzforge.ModuleEntry')
export class ModuleEntry extends Component {
    /**
     * @internal
     * 入口对应的稳定模块 ID，生成的子类必须重写；加载器与 ModuleDefinition.id 核对。
     */
    get moduleId(): string {
        throw Error('ModuleEntry must declare moduleId');
    }
    /**
     * @internal
     * 已注册的模块业务工厂，生成的子类必须重写；读取工厂本身不会执行初始化。
     */
    get factory(): ModuleFactory {
        throw Error('ModuleEntry must provide factory');
    }
}
/**
 * @internal
 * 创建本地代码包工厂加载器：先注册脚本，再读取入口预制体上的 ModuleEntry.factory。
 * @param assets - 共享资源管理器。
 * @returns 接收模块定义与代码 Scope 的异步函数，只返回工厂，不调用工厂。
 * @throws FrameworkError 远程 HTTP(S) 可执行代码包、入口缺失或模块 ID 不匹配。
 */
export function bundleFactoryLoader(assets: Assets) {
    return async (definition: ModuleDefinition, scope: Scope): Promise<ModuleFactory> => {
        if (definition.factory) return definition.factory;
        invariant(definition.codeBundle && definition.entryPath, 'MODULE_ENTRY_MISSING', definition.id);
        const bundle = assets.release.bundles[definition.codeBundle];
        invariant(
            bundle && !/^https?:/.test(bundle.location ?? ''),
            'REMOTE_CODE_FORBIDDEN',
            'Executable code bundles must be locally delivered',
        );
        await assets.prepareBundle(definition.codeBundle);
        const prefab = await assets.loadPath(definition.codeBundle, definition.entryPath, 'Prefab', scope);
        scope.signal.throwIfAborted();
        const node = instantiate(prefab);
        node.active = false;
        scope.defer(() => destroyNode(node));
        const entry = node.getComponent(ModuleEntry);
        invariant(entry && entry.moduleId === definition.id, 'MODULE_ENTRY_INVALID', definition.id);
        return entry.factory;
    };
}
