/**
 * 带稳定错误码及诊断详情的框架错误。业务判断优先读取 code，不依赖可变的 message 文案。
 */
export class FrameworkError extends Error {
    /**
     * 稳定错误码，例如 CONFIG_ROW_NOT_FOUND、TIME_NOT_SYNCED。
     */
    readonly code: string;
    /**
     * 只读类型的附加诊断信息，可能包含原始 error 或清理失败列表；运行时不会深复制或冻结。
     */
    readonly details: Readonly<Record<string, unknown>>;
    /**
     * 创建带错误码的诊断错误。
     * @param code - 稳定错误码。
     * @param message - 可阅读的定位说明。
     * @param details - 可选附加上下文，默认空对象；不要在其中记录敏感凭据。
     */
    constructor(code: string, message: string, details: Record<string, unknown> = {}) {
        super(message);
        this.name = 'FrameworkError';
        this.code = code;
        this.details = details;
    }
}
/**
 * 所有者结束或请求被替代时的正常取消错误，code 固定为 OPERATION_CANCELLED。
 * 框架任务入口会区分正常取消与业务失败；自行 catch 时也可用 instanceof 区分。
 */
export class OperationCancelled extends FrameworkError {
    /**
     * 创建取消原因。
     * @param message - 可选原因说明，默认表示所有者已经结束。
     */
    constructor(message = 'The owner has ended') {
        super('OPERATION_CANCELLED', message);
    }
}
/**
 * 断言必须成立的框架条件，并使 TypeScript 在后续代码中收窄类型。
 * @param condition - 要求为真值的条件。
 * @param code - 失败时的稳定错误码。
 * @param message - 失败时的定位说明。
 * @throws FrameworkError condition 为假值时抛出。
 */
export function invariant(condition: unknown, code: string, message: string): asserts condition {
    if (!condition) throw new FrameworkError(code, message);
}
/**
 * 同步错误上报回调；可接入项目日志系统，应避免自身再次抛错。
 */
export type ErrorReporter = (error: unknown) => void;
/**
 * 默认错误上报器，通过 console.error 输出带 [YZForge] 前缀的错误。
 */
export const reportError: ErrorReporter = (error) => console.error('[YZForge]', error);
