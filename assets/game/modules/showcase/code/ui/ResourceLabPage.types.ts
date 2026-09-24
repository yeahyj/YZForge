// 界面参数与结果合同；公开范围由 module.json 的 visibility 决定。需要数据时将 void 替换为明确的只读对象类型。
/** ui.open/pushPage 的参数类型，在 onShow 中通过 show.params 读取。 */
export type ResourceLabPageParams = void;
/** show.finish 提交的业务结果类型，调用方在 handle.result 的 completed 分支读取。 */
export type ResourceLabPageResult = void;
