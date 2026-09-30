/** 运行状态的值快照，不包含节点、管理器或可修改的业务对象。 */
export interface RuntimeSummary {
    /** 当前页面栈的逻辑 ID，按栈底到栈顶排列。 */
    readonly pages: readonly string[];
    /** 有业务运行记录的模块 ID，可能包含正在清理的模块。 */
    readonly modules: readonly string[];
    /** 资源管理器当前记录的 Bundle ID。 */
    readonly bundles: readonly string[];
    /** 当前仍有持有者的资源条目数，不是内存字节数。 */
    readonly resourceCount: number;
    /** 当前仍有持有者的配置数据条目数。 */
    readonly configCount: number;
    /** 没有业务持有、底层仍在收尾的配置数，不等于引用泄漏。 */
    readonly configDrainingCount: number;
}

/** 供调试界面读取的能力；查询不会加载资源、初始化模块或延长模块寿命。 */
export interface RuntimeDiagnostics {
    /** 按需读取当前快照，返回的数组与对象均不可修改。 */
    snapshot(): RuntimeSummary;
    /** 查询指定模块的代码与业务状态；代码已准备不表示业务实例仍存活。 */
    module(id: string): { readonly codeReady: boolean; readonly businessReady: boolean };
}
