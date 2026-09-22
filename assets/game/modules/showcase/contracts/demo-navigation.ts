/** 示例应用的页面目的地；稳定业务名称由启动层映射成生成的 ViewKey。 */
export type DemoPage = 'home' | 'workflow' | 'ui' | 'data' | 'time' | 'async' | 'storage' | 'guide' | 'legacy';

/** 页面只接收导航能力；导航会话在启动层持有，页面挂起不会关闭下一页。 */
export interface DemoNavigation {
    /** 压入目标页面；打开期间保留首次目标，后续调用等待同一次导航。页面内部返回用 show.back()。 */
    open(page: DemoPage): Promise<void>;
    /** 读取演示需要的诊断值，不暴露管理器内部节点和集合。 */
    inspect(): {
        readonly pages: readonly string[];
        readonly modules: readonly string[];
        readonly bundles: readonly string[];
        readonly resourceCount: number;
        readonly configCount: number;
        /** 没有业务持有但底层尚未完成的配置加载条目，不等同于引用泄漏。 */
        readonly configDrainingCount: number;
        readonly workshopCodeReady: boolean;
        readonly workshopBusinessReady: boolean;
    };
}

/** 每个示例页面的打开参数；业务启动层显式传入同一导航会话。 */
export interface LabParams {
    readonly navigation: DemoNavigation;
}
