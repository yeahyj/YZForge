/** 日志所需的最小配置；渠道、版本等前缀由应用装配。 */
export interface LogOptions {
    readonly level: 'debug' | 'info' | 'warn' | 'error' | 'silent';
    readonly prefix: string;
}

/** 受当前配置日志级别控制的业务日志入口；既有 console 调用不会被全局替换。 */
export class GameLog {
    private readonly threshold: number;
    private readonly prefix: string;
    constructor(options: LogOptions) {
        this.threshold = ['debug', 'info', 'warn', 'error', 'silent'].indexOf(options.level);
        this.prefix = options.prefix;
    }
    /** 开发调试信息。 */
    debug(message: string, ...values: unknown[]): void {
        if (this.threshold <= 0) console.debug(this.prefix, message, ...values);
    }
    /** 常规运行信息。 */
    info(message: string, ...values: unknown[]): void {
        if (this.threshold <= 1) console.info(this.prefix, message, ...values);
    }
    /** 可恢复异常。 */
    warn(message: string, ...values: unknown[]): void {
        if (this.threshold <= 2) console.warn(this.prefix, message, ...values);
    }
    /** 错误信息；不要将登录凭证或隐私数据作为参数。 */
    error(message: string, ...values: unknown[]): void {
        if (this.threshold <= 3) console.error(this.prefix, message, ...values);
    }
}
