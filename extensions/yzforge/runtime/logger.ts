export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerSink {
    log(level: LogLevel, scope: string, message: string, data?: unknown): void;
}

export class ConsoleLoggerSink implements LoggerSink {
    public log(level: LogLevel, scope: string, message: string, data?: unknown): void {
        const prefix = scope ? `[YZForge:${scope}]` : '[YZForge]';
        const args = data === undefined ? [prefix, message] : [prefix, message, data];
        if (level === 'debug') {
            console.debug(...args);
        } else if (level === 'warn') {
            console.warn(...args);
        } else if (level === 'error') {
            console.error(...args);
        } else {
            console.log(...args);
        }
    }
}

export class Logger {
    public constructor(
        private readonly sink: LoggerSink = new ConsoleLoggerSink(),
        private readonly scope = '',
    ) {}

    public child(scope: string): Logger {
        const nextScope = this.scope ? `${this.scope}/${scope}` : scope;
        return new Logger(this.sink, nextScope);
    }

    public debug(message: string, data?: unknown): void {
        this.sink.log('debug', this.scope, message, data);
    }

    public info(message: string, data?: unknown): void {
        this.sink.log('info', this.scope, message, data);
    }

    public warn(message: string, data?: unknown): void {
        this.sink.log('warn', this.scope, message, data);
    }

    public error(message: string, data?: unknown): void {
        this.sink.log('error', this.scope, message, data);
    }
}
