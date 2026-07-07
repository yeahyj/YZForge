export type Constructor<T> = new (...args: any[]) => T;

export type MaybePromise<T> = T | Promise<T>;

export function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
    return Boolean(value) && typeof (value as PromiseLike<T>).then === 'function';
}
