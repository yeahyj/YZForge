import type { ModuleRef } from '../../../framework/modules/module-manager';
import type { Scope } from '../../../framework/core/scope';
/** 演示账号状态快照；订阅方按只读使用。 */
export interface WalletSnapshot {
    /** 当前金币数，为非负安全整数。 */
    readonly coins: number;
}
/** 模块公开 API 合同；跨模块调用依赖此合同，不直接导入 code 中的私有实现。 */
export interface ProfileApi {
    /** 当前模块的稳定 ID。 */
    readonly moduleId: string;
    /** 读取当前状态，不加载其他业务模块。 */
    snapshot(): WalletSnapshot;
    /** 本地演示命令；正数增加、负数扣除，保存成功后发布变化。联网经济由项目服务端处理。 */
    changeCoins(delta: number): WalletSnapshot;
    /** 先收到当前状态，后续收到变化；owner 结束自动解绑，返回值可提前取消。 */
    subscribe(callback: (state: WalletSnapshot) => void, owner: Scope): () => void;
}
/** 轻量模块引用；await app.modules.use(此引用, owner) 后通过 handle.api 使用业务能力。 */
export const ProfileModule: ModuleRef<ProfileApi> = { id: 'profile' };
